import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { sourceMetadataRuntime } from '../db/schema-source-runtime';
import { pollTargets, sources, sports, venueSports, venues } from '../db/schema';
import type { PollingOrchestrator, PollingRunResult } from './orchestrator';
import type { PollingDemandResult } from './demand';
import type { SourceSynchronizationService } from '../sources/sync-service';

const DEFAULT_SOURCE_CODE = 'taipei-sports-center';
const DEFAULT_METADATA_REFRESH_MS = 6 * 60 * 60 * 1000;
const METADATA_FAILURE_RETRY_MS = 15 * 60 * 1000;

export type MetadataState = {
  active: boolean;
  nextAttemptAt: Date | null;
};

export type MetadataRefreshBatchResult = {
  due: number;
  refreshed: number;
  failed: number;
  failedSourceCodes: string[];
};

type MetadataRefreshCoordinatorInput = {
  sourceCodes: readonly string[];
  now: Date;
  readState(sourceCode: string): Promise<MetadataState | null>;
  syncMetadata(sourceCode: string): Promise<unknown>;
  markSuccess(sourceCode: string): Promise<void>;
  markFailure(sourceCode: string): Promise<void>;
};

type PollingDemandReconciler = {
  reconcile(now?: Date): Promise<PollingDemandResult>;
};

export function metadataRefreshDue(state: MetadataState | null, now: Date): boolean {
  if (!state) return true;
  if (!state.active) return false;
  return !state.nextAttemptAt || state.nextAttemptAt <= now;
}

/**
 * Refreshes each registered source independently.
 *
 * A provider-specific metadata failure must not prevent another source from
 * refreshing, and it must not block polling of already-normalized targets.
 * Failure-runtime persistence is best effort because the source adapter may
 * fail before its anchor/runtime row exists. Successful refresh cadence state,
 * however, is authoritative and must persist or the stage fails rather than
 * hammering metadata again on the next Cron wake-up.
 */
export async function refreshDueMetadataSources(
  input: MetadataRefreshCoordinatorInput,
): Promise<MetadataRefreshBatchResult> {
  const result: MetadataRefreshBatchResult = {
    due: 0,
    refreshed: 0,
    failed: 0,
    failedSourceCodes: [],
  };

  for (const sourceCode of input.sourceCodes) {
    const state = await input.readState(sourceCode);
    if (!metadataRefreshDue(state, input.now)) continue;
    result.due += 1;

    try {
      await input.syncMetadata(sourceCode);
    } catch {
      result.failed += 1;
      result.failedSourceCodes.push(sourceCode);
      await input.markFailure(sourceCode).catch(() => undefined);
      continue;
    }

    // Do not hide a database/runtime persistence failure after a successful
    // provider refresh. Without the persisted next-attempt boundary, the next
    // Cron wake-up could immediately repeat the expensive metadata discovery.
    await input.markSuccess(sourceCode);
    result.refreshed += 1;
  }

  return result;
}

/**
 * Sole owner of provider metadata refresh cadence. PollingOrchestrator only
 * consumes already-normalized targets; an empty target set must never trigger
 * an implicit metadata call that bypasses source_metadata_runtime backoff.
 *
 * The source list comes from the adapter registry at composition time. Taipei
 * is only the default for backwards-safe construction; adding another adapter
 * must not require new hard-coded metadata-stage branches.
 */
export class MetadataRefreshingPollingStage {
  constructor(
    private readonly database: Database,
    private readonly synchronizer: Pick<SourceSynchronizationService, 'syncMetadata'>,
    private readonly demand: PollingDemandReconciler,
    private readonly polling: Pick<PollingOrchestrator, 'run'>,
    private readonly sourceCodes: readonly string[] = [DEFAULT_SOURCE_CODE],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(): Promise<PollingRunResult & {
    metadataRefreshed: boolean;
    metadataSourcesDue: number;
    metadataSourcesRefreshed: number;
    metadataSourcesFailed: number;
    metadataFailedSourceCodes: string[];
    invalidTargetsDisabled: number;
    demandTargetsUpdated: number;
    watchedTargets: number;
  }> {
    const now = this.now();
    const metadata = await refreshDueMetadataSources({
      sourceCodes: this.sourceCodes,
      now,
      readState: (sourceCode) => this.getMetadataState(sourceCode),
      syncMetadata: async (sourceCode) => {
        await this.synchronizer.syncMetadata(sourceCode);
      },
      markSuccess: (sourceCode) => this.setMetadataRuntime(sourceCode, {
        lastSuccessfulAt: now,
        nextAttemptAt: new Date(now.getTime() + DEFAULT_METADATA_REFRESH_MS),
        lastErrorCode: null,
      }, now),
      markFailure: (sourceCode) => this.setMetadataRuntime(sourceCode, {
        nextAttemptAt: new Date(now.getTime() + METADATA_FAILURE_RETRY_MS),
        lastErrorCode: 'SOURCE_METADATA_REFRESH_FAILED',
      }, now),
    });

    // Even when one provider's metadata refresh failed, keep using the last
    // successfully normalized catalog. Availability freshness still fails
    // closed independently through poll_targets.last_success_at.
    const invalidTargetsDisabled = await this.disableInvalidPollTargets(now);
    const demand = await this.demand.reconcile(now);
    const result = await this.polling.run();
    return {
      ...result,
      metadataRefreshed: metadata.refreshed > 0,
      metadataSourcesDue: metadata.due,
      metadataSourcesRefreshed: metadata.refreshed,
      metadataSourcesFailed: metadata.failed,
      metadataFailedSourceCodes: metadata.failedSourceCodes,
      invalidTargetsDisabled,
      demandTargetsUpdated: demand.targetsUpdated,
      watchedTargets: demand.watchedTargets,
    };
  }

  private async getMetadataState(sourceCode: string): Promise<MetadataState | null> {
    const [state] = await this.database
      .select({
        active: sources.active,
        nextAttemptAt: sourceMetadataRuntime.nextAttemptAt,
      })
      .from(sources)
      .leftJoin(sourceMetadataRuntime, eq(sourceMetadataRuntime.sourceId, sources.id))
      .where(eq(sources.code, sourceCode))
      .limit(1);
    return state ?? null;
  }

  private async setMetadataRuntime(
    sourceCode: string,
    patch: {
      lastSuccessfulAt?: Date;
      nextAttemptAt: Date;
      lastErrorCode: string | null;
    },
    now: Date,
  ): Promise<void> {
    const [source] = await this.database
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.code, sourceCode))
      .limit(1);
    if (!source) return;

    await this.database
      .insert(sourceMetadataRuntime)
      .values({
        sourceId: source.id,
        lastSuccessfulAt: patch.lastSuccessfulAt ?? null,
        nextAttemptAt: patch.nextAttemptAt,
        lastErrorCode: patch.lastErrorCode,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sourceMetadataRuntime.sourceId,
        set: {
          ...(patch.lastSuccessfulAt ? { lastSuccessfulAt: patch.lastSuccessfulAt } : {}),
          nextAttemptAt: patch.nextAttemptAt,
          lastErrorCode: patch.lastErrorCode,
          updatedAt: now,
        },
      });
  }

  private async disableInvalidPollTargets(now: Date): Promise<number> {
    const invalid = await this.database
      .select({ id: pollTargets.id })
      .from(pollTargets)
      .innerJoin(sources, eq(sources.id, pollTargets.sourceId))
      .innerJoin(venues, eq(venues.id, pollTargets.venueId))
      .innerJoin(sports, eq(sports.id, pollTargets.sportId))
      .leftJoin(
        venueSports,
        and(
          eq(venueSports.venueId, pollTargets.venueId),
          eq(venueSports.sportId, pollTargets.sportId),
        ),
      )
      .where(and(
        eq(pollTargets.enabled, true),
        or(
          eq(sources.active, false),
          eq(venues.active, false),
          eq(sports.active, false),
          isNull(venueSports.id),
          eq(venueSports.active, false),
        ),
      ));

    if (invalid.length === 0) return 0;
    const updated = await this.database
      .update(pollTargets)
      .set({
        enabled: false,
        lastErrorCode: 'SOURCE_MAPPING_INACTIVE',
        updatedAt: now,
      })
      .where(and(
        eq(pollTargets.enabled, true),
        inArray(pollTargets.id, invalid.map((row) => row.id)),
      ))
      .returning({ id: pollTargets.id });
    return updated.length;
  }
}
