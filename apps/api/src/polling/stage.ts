import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { pollTargets, sources, sports, venueSports, venues } from '../db/schema';
import type { PollingOrchestrator, PollingRunResult } from './orchestrator';
import type { PollingDemandResult } from './demand';
import type { SourceSynchronizationService } from '../sources/sync-service';

const DEFAULT_SOURCE_CODE = 'taipei-sports-center';
const DEFAULT_METADATA_REFRESH_MS = 6 * 60 * 60 * 1000;

type MetadataState = {
  active: boolean;
  updatedAt: Date;
};

type PollingDemandReconciler = {
  reconcile(now?: Date): Promise<PollingDemandResult>;
};

export function metadataRefreshDue(
  state: MetadataState | null,
  now: Date,
  refreshMs = DEFAULT_METADATA_REFRESH_MS,
): boolean {
  if (!state || !state.active) return true;
  return state.updatedAt.getTime() <= now.getTime() - Math.max(60_000, refreshMs);
}

/**
 * Keeps provider metadata and poll targets aligned without calling metadata
 * endpoints every minute. Provider venue/sport mappings are refreshed on a
 * bounded cadence, invalid targets are disabled, and current Radar demand is
 * reapplied before availability polling proceeds.
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
      .select({ active: sources.active, updatedAt: sources.updatedAt })
      .from(sources)
      .where(eq(sources.code, sourceCode))
      .limit(1);

    let metadataRefreshed = false;
    if (metadataRefreshDue(state ?? null, now)) {
      await this.synchronizer.syncMetadata(sourceCode);
      metadataRefreshed = true;
    }

    const invalidTargetsDisabled = await this.disableInvalidPollTargets(now);
    const demand = await this.demand.reconcile(now);
    const result = await this.polling.run({ sourceCode });
    return {
      ...result,
      metadataRefreshed: metadataRefreshed || result.bootstrappedMetadata,
      invalidTargetsDisabled,
      demandTargetsUpdated: demand.targetsUpdated,
      watchedTargets: demand.watchedTargets,
    };
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
