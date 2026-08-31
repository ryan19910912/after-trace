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

type MetadataState = {
  active: boolean;
  nextAttemptAt: Date | null;
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
 * Sole owner of provider metadata refresh cadence. PollingOrchestrator only
 * consumes already-normalized targets; an empty target set must never trigger
 * an implicit metadata call that bypasses source_metadata_runtime backoff.
 */
export class MetadataRefreshingPollingStage {
  constructor(
    private readonly database: Database,
    private readonly synchronizer: Pick<SourceSynchronizationService, 'syncMetadata'>,
    private readonly demand: PollingDemandReconciler,
    private readonly polling: Pick<PollingOrchestrator, 'run'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(): Promise<PollingRunResult & {
    metadataRefreshed: boolean;
    invalidTargetsDisabled: number;
    demandTargetsUpdated: number;
    watchedTargets: number;
  }> {
    const now = this.now();
    const sourceCode = DEFAULT_SOURCE_CODE;
    const [state] = await this.database
      .select({
        sourceId: sources.id,
        active: sources.active,
        nextAttemptAt: sourceMetadataRuntime.nextAttemptAt,
      })
      .from(sources)
      .leftJoin(sourceMetadataRuntime, eq(sourceMetadataRuntime.sourceId, sources.id))
      .where(eq(sources.code, sourceCode))
      .limit(1);

    let metadataRefreshed = false;
    if (metadataRefreshDue(state ? { active: state.active, nextAttemptAt: state.nextAttemptAt } : null, now)) {
      try {
        await this.synchronizer.syncMetadata(sourceCode);
        metadataRefreshed = true;
        await this.setMetadataRuntime(sourceCode, {
          lastSuccessfulAt: now,
          nextAttemptAt: new Date(now.getTime() + DEFAULT_METADATA_REFRESH_MS),
          lastErrorCode: null,
        }, now);
      } catch (error) {
        // syncMetadata keeps the source anchor before provider discovery, so
        // the runtime row can normally be persisted even on the first failed
        // refresh. The polling layer will not bypass this retry boundary.
        await this.setMetadataRuntime(sourceCode, {
          nextAttemptAt: new Date(now.getTime() + METADATA_FAILURE_RETRY_MS),
          lastErrorCode: 'SOURCE_METADATA_REFRESH_FAILED',
        }, now).catch(() => undefined);
        throw error;
      }
    }

    const invalidTargetsDisabled = await this.disableInvalidPollTargets(now);
    const demand = await this.demand.reconcile(now);
    const result = await this.polling.run();
    return {
      ...result,
      metadataRefreshed,
      invalidTargetsDisabled,
      demandTargetsUpdated: demand.targetsUpdated,
      watchedTargets: demand.watchedTargets,
    };
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
