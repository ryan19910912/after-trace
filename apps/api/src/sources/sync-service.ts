import type { SourceAdapterRegistry } from './registry';
import type { AvailabilitySyncRepository, PollTargetContext } from './sync-repository';
import {
  AvailabilitySourceError,
  type SourceSport,
  type SourceVenue,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
const MAX_SYNC_WINDOW_DAYS = 31;
const DEFAULT_LAUNCH_SPORT_CODES = ['badminton'] as const;

export type MetadataSyncResult = {
  sourceCode: string;
  venues: number;
  venueSports: number;
  pollTargets: number;
};

export type PollSyncResult = {
  pollTargetId: number;
  datesChecked: number;
  bookableDates: number;
  slotsSeen: number;
  staleSlotsCleared: number;
};

type VenueMetadataSnapshot = {
  venue: SourceVenue;
  sports: SourceSport[];
};

export class PollTargetClaimLostError extends Error {
  readonly code = 'POLL_TARGET_CLAIM_LOST';

  constructor(pollTargetId: number) {
    super(`Poll target ${pollTargetId} claim is no longer active`);
    this.name = 'PollTargetClaimLostError';
  }
}

export class SourceSynchronizationService {
  private readonly enabledSportCodes: ReadonlySet<string>;

  constructor(
    private readonly repository: AvailabilitySyncRepository,
    private readonly registry: SourceAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
    enabledSportCodes: readonly string[] = DEFAULT_LAUNCH_SPORT_CODES,
  ) {
    this.enabledSportCodes = new Set(enabledSportCodes);
  }

  async syncMetadata(sourceCode: string): Promise<MetadataSyncResult> {
    const adapter = this.registry.get(sourceCode);

    // Keep the source anchor current before provider discovery so the metadata
    // stage can persist retry/backoff state even on the first failed refresh.
    // Venue/sport truth is still staged and is not mutated until every provider
    // metadata read succeeds.
    const sourceId = await this.repository.upsertSource({
      code: adapter.code,
      name: adapter.name,
      baseUrl: adapter.baseUrl,
      minPollIntervalSeconds: adapter.minPollIntervalSeconds,
    });

    // Read a complete provider snapshot before mutating normalized venue/sport
    // state. Provider metadata calls can fail partway through a venue list; if
    // persistence is interleaved with those calls, a transient upstream error
    // can leave the public/Radar truth half-refreshed until the retry succeeds.
    const sourceVenues = await adapter.listVenues();
    if (sourceVenues.length === 0) {
      throw new Error(`Source ${sourceCode} returned an empty venue snapshot`);
    }

    const snapshot: VenueMetadataSnapshot[] = [];
    for (const venue of sourceVenues) {
      const sports = (await adapter.listSports(venue.externalVenueId))
        .filter((sport) => this.enabledSportCodes.has(sport.code));
      snapshot.push({ venue, sports });
    }

    const externalVenueIds: string[] = [];
    let venueSportsCount = 0;
    let pollTargetCount = 0;

    for (const venueSnapshot of snapshot) {
      const sourceVenue = venueSnapshot.venue;
      externalVenueIds.push(sourceVenue.externalVenueId);
      const venueId = await this.repository.upsertVenue(sourceId, sourceVenue);
      const activeSportIds: number[] = [];

      for (const sourceSport of venueSnapshot.sports) {
        const sportId = await this.repository.upsertSport(sourceSport);
        activeSportIds.push(sportId);
        await this.repository.upsertVenueSport(venueId, sportId, sourceSport.externalCategoryId);
        await this.repository.ensurePollTarget({
          sourceId,
          venueId,
          sportId,
          intervalSeconds: Math.max(DEFAULT_POLL_INTERVAL_SECONDS, adapter.minPollIntervalSeconds),
        });
        venueSportsCount += 1;
        pollTargetCount += 1;
      }

      await this.repository.deactivateMissingVenueSports(venueId, activeSportIds);
    }

    await this.repository.deactivateMissingVenues(sourceId, externalVenueIds);
    return {
      sourceCode,
      venues: sourceVenues.length,
      venueSports: venueSportsCount,
      pollTargets: pollTargetCount,
    };
  }

  async syncPollTarget(input: {
    pollTargetId: number;
    startDate: string;
    endDate: string;
    claimedAt?: Date;
  }): Promise<PollSyncResult> {
    const allDates = datesInclusive(input.startDate, input.endDate);
    const polledAt = this.now();
    const context = await this.repository.getPollTargetContext(input.pollTargetId, input.claimedAt);
    if (!context) {
      throw new PollTargetClaimLostError(input.pollTargetId);
    }
    const adapter = this.registry.get(context.sourceCode);
    const intervalSeconds = Math.max(context.intervalSeconds, context.sourceMinPollIntervalSeconds);
    const writeFence = input.claimedAt
      ? { pollTargetId: context.pollTargetId, expectedClaimedAt: input.claimedAt }
      : {};

    try {
      const bookableDates = adapter.listBookableDates
        ? await adapter.listBookableDates({
            externalVenueId: context.externalVenueId,
            sportCode: context.sportCode,
            externalCategoryId: context.externalCategoryId,
            startDate: input.startDate,
            endDate: input.endDate,
          })
        : allDates;
      const bookableSet = new Set(bookableDates);
      let slotsSeen = 0;
      let staleSlotsCleared = 0;

      for (const useDate of allDates) {
        const slots = bookableSet.has(useDate)
          ? await adapter.listAvailability({
              externalVenueId: context.externalVenueId,
              sportCode: context.sportCode,
              externalCategoryId: context.externalCategoryId,
              useDate,
            })
          : [];

        for (const slot of slots) {
          assertSlotMatchesTarget(slot, context, useDate);
          const written = await this.repository.upsertAvailabilitySlot({
            sourceId: context.sourceId,
            venueId: context.venueId,
            sportId: context.sportId,
            slot,
            seenAt: polledAt,
            ...writeFence,
          });
          if (!written) throw new PollTargetClaimLostError(context.pollTargetId);
        }
        slotsSeen += slots.length;
        staleSlotsCleared += await this.repository.markMissingSlotsUnknown({
          sourceId: context.sourceId,
          venueId: context.venueId,
          sportId: context.sportId,
          useDate,
          seenExternalSlotKeys: slots.map((slot) => slot.externalSlotKey),
          seenAt: polledAt,
          ...writeFence,
        });
      }

      const finalized = await this.repository.markPollTargetSuccess({
        pollTargetId: context.pollTargetId,
        polledAt,
        nextPollAt: addSeconds(polledAt, intervalSeconds),
        expectedClaimedAt: input.claimedAt,
      });
      if (!finalized) throw new PollTargetClaimLostError(context.pollTargetId);

      return {
        pollTargetId: context.pollTargetId,
        datesChecked: allDates.length,
        bookableDates: bookableSet.size,
        slotsSeen,
        staleSlotsCleared,
      };
    } catch (cause) {
      // A newer Worker owns the target now. The old Worker must not overwrite
      // target health/backoff owned by that newer claim.
      if (cause instanceof PollTargetClaimLostError) throw cause;

      await this.repository.markPollTargetFailure({
        pollTargetId: context.pollTargetId,
        polledAt,
        nextPollAt: addSeconds(polledAt, Math.min(intervalSeconds * 2, 3600)),
        errorCode: sourceErrorCode(cause),
        expectedClaimedAt: input.claimedAt,
      });
      throw cause;
    }
  }
}

function datesInclusive(startDate: string, endDate: string): string[] {
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    throw new Error('Sync dates must use YYYY-MM-DD');
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (end < start) throw new Error('endDate must not be before startDate');
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_SYNC_WINDOW_DAYS) {
    throw new Error(`Sync window must not exceed ${MAX_SYNC_WINDOW_DAYS} days`);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
}

function assertSlotMatchesTarget(
  slot: {
    externalVenueId: string;
    sportCode: string;
    useDate: string;
  },
  context: PollTargetContext,
  useDate: string,
): void {
  if (
    slot.externalVenueId !== context.externalVenueId ||
    slot.sportCode !== context.sportCode ||
    slot.useDate !== useDate
  ) {
    throw new Error(`Source adapter returned a slot outside poll target ${context.pollTargetId}`);
  }
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}

function sourceErrorCode(cause: unknown): string {
  if (cause instanceof AvailabilitySourceError) return cause.code;
  if (cause instanceof Error && cause.message.includes('outside poll target')) return 'SOURCE_TARGET_MISMATCH';
  return 'SOURCE_SYNC_FAILED';
}
