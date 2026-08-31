import { and, asc, desc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';
import {
  AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER,
  MIN_AVAILABILITY_FRESHNESS_SECONDS,
} from '../availability/freshness';
import type { Database } from '../db/client';
import {
  availabilitySlots,
  courts,
  pollTargets,
  sources,
  sports,
  venueSports,
  venues,
} from '../db/schema';
import type { SourceAvailabilitySlot, SourceSport, SourceVenue } from './types';

export type PersistableAvailabilitySlot = Omit<SourceAvailabilitySlot, 'externalVenueId' | 'sportCode'>;

export type PollTargetClaim = {
  pollTargetId: number;
  claimedAt: Date;
};

export type PollWriteFence = {
  pollTargetId?: number;
  expectedClaimedAt?: Date;
};

export type PollTargetContext = {
  pollTargetId: number;
  sourceId: number;
  sourceCode: string;
  sourceMinPollIntervalSeconds: number;
  venueId: number;
  externalVenueId: string;
  sportId: number;
  sportCode: string;
  externalCategoryId?: string;
  intervalSeconds: number;
};

export type AvailabilitySyncRepository = {
  upsertSource(input: {
    code: string;
    name: string;
    baseUrl: string;
    minPollIntervalSeconds: number;
  }): Promise<number>;
  upsertSport(input: SourceSport): Promise<number>;
  upsertVenue(sourceId: number, input: SourceVenue): Promise<number>;
  deactivateMissingVenues(sourceId: number, externalVenueIds: string[]): Promise<void>;
  upsertVenueSport(venueId: number, sportId: number, externalCategoryId?: string): Promise<void>;
  deactivateMissingVenueSports(venueId: number, sportIds: number[]): Promise<void>;
  ensurePollTarget(input: {
    sourceId: number;
    venueId: number;
    sportId: number;
    intervalSeconds: number;
  }): Promise<void>;
  claimDuePollTargets(input: {
    claimedAt: Date;
    leaseSeconds: number;
    limit: number;
  }): Promise<PollTargetClaim[]>;
  getPollTargetContext(pollTargetId: number, expectedClaimedAt?: Date): Promise<PollTargetContext | null>;
  upsertAvailabilitySlot(input: {
    sourceId: number;
    venueId: number;
    sportId: number;
    slot: PersistableAvailabilitySlot;
    seenAt: Date;
  } & PollWriteFence): Promise<boolean>;
  markMissingSlotsUnknown(input: {
    sourceId: number;
    venueId: number;
    sportId: number;
    useDate: string;
    seenExternalSlotKeys: string[];
    seenAt: Date;
  } & PollWriteFence): Promise<number>;
  markPollTargetSuccess(input: {
    pollTargetId: number;
    polledAt: Date;
    nextPollAt: Date;
    expectedClaimedAt?: Date;
  }): Promise<boolean>;
  markPollTargetFailure(input: {
    pollTargetId: number;
    polledAt: Date;
    nextPollAt: Date;
    errorCode: string;
    expectedClaimedAt?: Date;
  }): Promise<boolean>;
};

export class DrizzleAvailabilitySyncRepository implements AvailabilitySyncRepository {
  constructor(private readonly database: Database) {}

  async upsertSource(input: {
    code: string;
    name: string;
    baseUrl: string;
    minPollIntervalSeconds: number;
  }): Promise<number> {
    const now = new Date();
    const [row] = await this.database
      .insert(sources)
      .values({
        code: input.code,
        name: input.name,
        baseUrl: input.baseUrl,
        minPollIntervalSeconds: input.minPollIntervalSeconds,
        active: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sources.code,
        set: {
          name: input.name,
          baseUrl: input.baseUrl,
          minPollIntervalSeconds: input.minPollIntervalSeconds,
          active: true,
          updatedAt: now,
        },
      })
      .returning({ id: sources.id });
    if (!row) throw new Error(`Failed to upsert source ${input.code}`);
    return row.id;
  }

  async upsertSport(input: SourceSport): Promise<number> {
    const now = new Date();
    const [row] = await this.database
      .insert(sports)
      .values({ code: input.code, name: input.name, active: true, updatedAt: now })
      .onConflictDoUpdate({
        target: sports.code,
        set: { name: input.name, active: true, updatedAt: now },
      })
      .returning({ id: sports.id });
    if (!row) throw new Error(`Failed to upsert sport ${input.code}`);
    return row.id;
  }

  async upsertVenue(sourceId: number, input: SourceVenue): Promise<number> {
    const now = new Date();
    const [row] = await this.database
      .insert(venues)
      .values({
        sourceId,
        externalVenueId: input.externalVenueId,
        name: input.name,
        city: input.city,
        district: input.district,
        address: input.address,
        bookingUrl: input.bookingUrl,
        active: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [venues.sourceId, venues.externalVenueId],
        set: {
          name: input.name,
          city: input.city,
          district: input.district,
          address: input.address,
          bookingUrl: input.bookingUrl,
          active: true,
          updatedAt: now,
        },
      })
      .returning({ id: venues.id });
    if (!row) throw new Error(`Failed to upsert venue ${input.externalVenueId}`);
    return row.id;
  }

  async deactivateMissingVenues(sourceId: number, externalVenueIds: string[]): Promise<void> {
    const condition = externalVenueIds.length === 0
      ? eq(venues.sourceId, sourceId)
      : and(eq(venues.sourceId, sourceId), notInArray(venues.externalVenueId, externalVenueIds));
    await this.database.update(venues).set({ active: false, updatedAt: new Date() }).where(condition);
  }

  async upsertVenueSport(venueId: number, sportId: number, externalCategoryId?: string): Promise<void> {
    const now = new Date();
    await this.database
      .insert(venueSports)
      .values({ venueId, sportId, externalCategoryId, active: true, updatedAt: now })
      .onConflictDoUpdate({
        target: [venueSports.venueId, venueSports.sportId],
        set: { externalCategoryId, active: true, updatedAt: now },
      });
  }

  async deactivateMissingVenueSports(venueId: number, sportIds: number[]): Promise<void> {
    const condition = sportIds.length === 0
      ? eq(venueSports.venueId, venueId)
      : and(eq(venueSports.venueId, venueId), notInArray(venueSports.sportId, sportIds));
    await this.database.update(venueSports).set({ active: false, updatedAt: new Date() }).where(condition);
  }

  async ensurePollTarget(input: {
    sourceId: number;
    venueId: number;
    sportId: number;
    intervalSeconds: number;
  }): Promise<void> {
    await this.database
      .insert(pollTargets)
      .values({
        sourceId: input.sourceId,
        venueId: input.venueId,
        sportId: input.sportId,
        enabled: true,
        intervalSeconds: input.intervalSeconds,
      })
      .onConflictDoUpdate({
        target: [pollTargets.sourceId, pollTargets.venueId, pollTargets.sportId],
        set: { enabled: true, intervalSeconds: input.intervalSeconds, updatedAt: new Date() },
      });
  }

  async claimDuePollTargets(input: {
    claimedAt: Date;
    leaseSeconds: number;
    limit: number;
  }): Promise<PollTargetClaim[]> {
    const limit = Math.max(1, Math.min(20, Math.trunc(input.limit)));
    const candidates = await this.database
      .select({ id: pollTargets.id })
      .from(pollTargets)
      .where(and(eq(pollTargets.enabled, true), lte(pollTargets.nextPollAt, input.claimedAt)))
      .orderBy(desc(pollTargets.priority), asc(pollTargets.nextPollAt), asc(pollTargets.id))
      .limit(limit);
    if (candidates.length === 0) return [];

    const leaseUntil = new Date(input.claimedAt.getTime() + Math.max(60, input.leaseSeconds) * 1000);
    const claimed = await this.database
      .update(pollTargets)
      .set({
        lastPolledAt: input.claimedAt,
        nextPollAt: leaseUntil,
        updatedAt: input.claimedAt,
      })
      .where(
        and(
          eq(pollTargets.enabled, true),
          lte(pollTargets.nextPollAt, input.claimedAt),
          inArray(pollTargets.id, candidates.map((row) => row.id)),
        ),
      )
      .returning({ pollTargetId: pollTargets.id });

    return claimed.map((row) => ({ pollTargetId: row.pollTargetId, claimedAt: input.claimedAt }));
  }

  async getPollTargetContext(pollTargetId: number, expectedClaimedAt?: Date): Promise<PollTargetContext | null> {
    const [row] = await this.database
      .select({
        pollTargetId: pollTargets.id,
        sourceId: sources.id,
        sourceCode: sources.code,
        sourceMinPollIntervalSeconds: sources.minPollIntervalSeconds,
        venueId: venues.id,
        externalVenueId: venues.externalVenueId,
        sportId: sports.id,
        sportCode: sports.code,
        externalCategoryId: venueSports.externalCategoryId,
        intervalSeconds: pollTargets.intervalSeconds,
      })
      .from(pollTargets)
      .innerJoin(sources, eq(sources.id, pollTargets.sourceId))
      .innerJoin(venues, eq(venues.id, pollTargets.venueId))
      .innerJoin(sports, eq(sports.id, pollTargets.sportId))
      .innerJoin(
        venueSports,
        and(eq(venueSports.venueId, venues.id), eq(venueSports.sportId, sports.id)),
      )
      .where(
        and(
          eq(pollTargets.id, pollTargetId),
          expectedClaimedAt ? eq(pollTargets.lastPolledAt, expectedClaimedAt) : undefined,
          eq(pollTargets.enabled, true),
          eq(sources.active, true),
          eq(venues.active, true),
          eq(sports.active, true),
          eq(venueSports.active, true),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      externalCategoryId: row.externalCategoryId ?? undefined,
    };
  }

  async upsertAvailabilitySlot(input: {
    sourceId: number;
    venueId: number;
    sportId: number;
    slot: PersistableAvailabilitySlot;
    seenAt: Date;
  } & PollWriteFence): Promise<boolean> {
    if (!(await this.isPollWriteFenceActive(input))) return false;

    // Every mutation derived from a claimed poll must be serialized behind the
    // same claim fence. Court discovery used to happen before the authoritative
    // slot/event fence, which allowed an expired Worker to reactivate or rename
    // a court even when its later slot write was correctly rejected.
    const writeFence = pollWriteFenceSql(input);
    const reconfirmedAfterStaleGap = availabilityReconfirmationSql(input, input.seenAt);
    const courtUpsert = input.slot.externalCourtId
      ? sql`
        court_upsert AS (
          INSERT INTO courts (
            venue_id,
            sport_id,
            external_court_id,
            name,
            active,
            created_at,
            updated_at
          )
          SELECT
            ${input.venueId},
            ${input.sportId},
            ${input.slot.externalCourtId},
            ${input.slot.courtName ?? input.slot.externalCourtId},
            TRUE,
            ${input.seenAt},
            ${input.seenAt}
          WHERE ${writeFence}
          ON CONFLICT (venue_id, sport_id, external_court_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            active = TRUE,
            updated_at = EXCLUDED.updated_at
          RETURNING id
        ),`
      : sql``;
    const courtId = input.slot.externalCourtId
      ? sql`(SELECT id FROM court_upsert)`
      : sql`NULL`;

    await this.database.execute(sql`
      WITH
      ${courtUpsert}
      previous AS MATERIALIZED (
        SELECT id, status, last_seen_at
        FROM availability_slots
        WHERE source_id = ${input.sourceId}
          AND external_slot_key = ${input.slot.externalSlotKey}
      ),
      upserted AS (
        INSERT INTO availability_slots (
          source_id,
          venue_id,
          sport_id,
          court_id,
          external_slot_key,
          use_date,
          start_time,
          end_time,
          status,
          price,
          external_booking_ref,
          first_seen_at,
          last_seen_at,
          updated_at
        )
        SELECT
          ${input.sourceId},
          ${input.venueId},
          ${input.sportId},
          ${courtId},
          ${input.slot.externalSlotKey},
          ${input.slot.useDate},
          ${input.slot.startTime},
          ${input.slot.endTime},
          ${input.slot.status}::availability_status,
          ${input.slot.price ?? null},
          ${input.slot.externalBookingRef ?? null},
          ${input.seenAt},
          ${input.seenAt},
          ${input.seenAt}
        WHERE ${writeFence}
        ON CONFLICT (source_id, external_slot_key)
        DO UPDATE SET
          venue_id = EXCLUDED.venue_id,
          sport_id = EXCLUDED.sport_id,
          court_id = EXCLUDED.court_id,
          use_date = EXCLUDED.use_date,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          status = EXCLUDED.status,
          price = EXCLUDED.price,
          external_booking_ref = EXCLUDED.external_booking_ref,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = EXCLUDED.updated_at
        RETURNING id, status
      )
      INSERT INTO availability_events (
        availability_slot_id,
        previous_status,
        new_status,
        occurred_at
      )
      SELECT
        upserted.id,
        COALESCE(previous.status, 'UNKNOWN'::availability_status),
        upserted.status,
        ${input.seenAt}
      FROM upserted
      LEFT JOIN previous ON previous.id = upserted.id
      WHERE
        (previous.id IS NULL AND upserted.status = 'AVAILABLE'::availability_status)
        OR (previous.id IS NOT NULL AND previous.status IS DISTINCT FROM upserted.status)
        OR ${reconfirmedAfterStaleGap}
    `);

    // If ownership changed immediately after a legitimate write, stop this old
    // poll before it performs more provider/date work. If there is no fence
    // (manual/direct synchronization), this remains true.
    return this.isPollWriteFenceActive(input);
  }

  async markMissingSlotsUnknown(input: {
    sourceId: number;
    venueId: number;
    sportId: number;
    useDate: string;
    seenExternalSlotKeys: string[];
    seenAt: Date;
  } & PollWriteFence): Promise<number> {
    if (!(await this.isPollWriteFenceActive(input))) return 0;

    const base = and(
      eq(availabilitySlots.sourceId, input.sourceId),
      eq(availabilitySlots.venueId, input.venueId),
      eq(availabilitySlots.sportId, input.sportId),
      eq(availabilitySlots.useDate, input.useDate),
    );
    const candidates = await this.database
      .select({
        externalSlotKey: availabilitySlots.externalSlotKey,
        externalCourtId: courts.externalCourtId,
        courtName: courts.name,
        useDate: availabilitySlots.useDate,
        startTime: availabilitySlots.startTime,
        endTime: availabilitySlots.endTime,
        status: availabilitySlots.status,
        price: availabilitySlots.price,
        externalBookingRef: availabilitySlots.externalBookingRef,
      })
      .from(availabilitySlots)
      .leftJoin(courts, eq(courts.id, availabilitySlots.courtId))
      .where(
        input.seenExternalSlotKeys.length === 0
          ? base
          : and(base, notInArray(availabilitySlots.externalSlotKey, input.seenExternalSlotKeys)),
      );

    let changed = 0;
    for (const candidate of candidates) {
      if (candidate.status === 'UNKNOWN') continue;
      const written = await this.upsertAvailabilitySlot({
        sourceId: input.sourceId,
        venueId: input.venueId,
        sportId: input.sportId,
        seenAt: input.seenAt,
        pollTargetId: input.pollTargetId,
        expectedClaimedAt: input.expectedClaimedAt,
        slot: {
          externalSlotKey: candidate.externalSlotKey,
          externalCourtId: candidate.externalCourtId ?? undefined,
          courtName: candidate.courtName ?? undefined,
          useDate: candidate.useDate,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          status: 'UNKNOWN',
          price: candidate.price ?? undefined,
          externalBookingRef: candidate.externalBookingRef ?? undefined,
        },
      });
      if (!written) break;
      changed += 1;
    }
    return changed;
  }

  async markPollTargetSuccess(input: {
    pollTargetId: number;
    polledAt: Date;
    nextPollAt: Date;
    expectedClaimedAt?: Date;
  }): Promise<boolean> {
    const rows = await this.database
      .update(pollTargets)
      .set({
        lastSuccessAt: input.polledAt,
        lastErrorCode: null,
        nextPollAt: input.nextPollAt,
        updatedAt: input.polledAt,
      })
      .where(
        and(
          eq(pollTargets.id, input.pollTargetId),
          input.expectedClaimedAt ? eq(pollTargets.lastPolledAt, input.expectedClaimedAt) : undefined,
        ),
      )
      .returning({ id: pollTargets.id });
    return rows.length === 1;
  }

  async markPollTargetFailure(input: {
    pollTargetId: number;
    polledAt: Date;
    nextPollAt: Date;
    errorCode: string;
    expectedClaimedAt?: Date;
  }): Promise<boolean> {
    const rows = await this.database
      .update(pollTargets)
      .set({
        lastErrorCode: input.errorCode,
        nextPollAt: input.nextPollAt,
        updatedAt: input.polledAt,
      })
      .where(
        and(
          eq(pollTargets.id, input.pollTargetId),
          input.expectedClaimedAt ? eq(pollTargets.lastPolledAt, input.expectedClaimedAt) : undefined,
        ),
      )
      .returning({ id: pollTargets.id });
    return rows.length === 1;
  }

  private async isPollWriteFenceActive(input: PollWriteFence): Promise<boolean> {
    if (!input.expectedClaimedAt || input.pollTargetId === undefined) return true;
    const [active] = await this.database
      .select({ id: pollTargets.id })
      .from(pollTargets)
      .where(and(
        eq(pollTargets.id, input.pollTargetId),
        eq(pollTargets.enabled, true),
        eq(pollTargets.lastPolledAt, input.expectedClaimedAt),
      ))
      .limit(1);
    return Boolean(active);
  }
}

function pollWriteFenceSql(input: PollWriteFence) {
  if (!input.expectedClaimedAt || input.pollTargetId === undefined) return sql`TRUE`;
  return sql`EXISTS (
    SELECT 1
    FROM poll_targets claim_target
    WHERE claim_target.id = ${input.pollTargetId}
      AND claim_target.enabled = TRUE
      AND claim_target.last_polled_at = ${input.expectedClaimedAt}
    FOR UPDATE
  )`;
}

function availabilityReconfirmationSql(input: PollWriteFence, seenAt: Date) {
  if (!input.expectedClaimedAt || input.pollTargetId === undefined) return sql`FALSE`;
  return sql`(
    previous.id IS NOT NULL
    AND previous.status = 'AVAILABLE'::availability_status
    AND upserted.status = 'AVAILABLE'::availability_status
    AND previous.last_seen_at
      + (GREATEST(
          (
            SELECT recovery_target.interval_seconds * ${AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER}
            FROM poll_targets recovery_target
            WHERE recovery_target.id = ${input.pollTargetId}
              AND recovery_target.enabled = TRUE
              AND recovery_target.last_polled_at = ${input.expectedClaimedAt}
          ),
          ${MIN_AVAILABILITY_FRESHNESS_SECONDS}
        ) * INTERVAL '1 second') < ${seenAt}
  )`;
}
