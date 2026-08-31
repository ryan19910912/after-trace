import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { notificationDeliveryRuntime } from '../db/schema-notifications';
import {
  availabilityEvents,
  availabilitySlots,
  notificationDeliveries,
  sources,
  sports,
  venueSports,
  venues,
  watchRules,
  watchRuleVenues,
} from '../db/schema';
import { taipeiDate, taipeiTime } from '../time/taipei';
import { matchesWatchRule } from './rules';

const DELIVERY_MAX_AGE_MS = 30 * 60 * 1000;

export type RadarMatchResult = {
  eventsProcessed: number;
  deliveriesCreated: number;
};

export class DrizzleRadarMatcher {
  constructor(private readonly database: Database) {}

  async matchPendingAvailableEvents(limit = 200): Promise<RadarMatchResult> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const now = new Date();
    const today = taipeiDate(now);
    const currentTime = taipeiTime(now);

    // Once a later transition exists for the same slot, an older AVAILABLE
    // event can never be the current Radar truth again. Close it out so stale
    // unmatched rows do not accumulate forever in the Radar queue index.
    await this.database
      .update(availabilityEvents)
      .set({ matchedAt: now })
      .where(and(
        eq(availabilityEvents.newStatus, 'AVAILABLE'),
        isNull(availabilityEvents.matchedAt),
        sql`EXISTS (
          SELECT 1
          FROM availability_events newer
          WHERE newer.availability_slot_id = ${availabilityEvents.availabilitySlotId}
            AND newer.id > ${availabilityEvents.id}
        )`,
      ));

    // Availability can remain persisted after its actionable wall-clock window
    // has passed. Retire those queue events even when the provider never emitted
    // another status transition, otherwise a delayed matcher could notify after
    // the court time has already started.
    await this.database
      .update(availabilityEvents)
      .set({ matchedAt: now })
      .where(and(
        eq(availabilityEvents.newStatus, 'AVAILABLE'),
        isNull(availabilityEvents.matchedAt),
        sql`EXISTS (
          SELECT 1
          FROM availability_slots expired_slot
          WHERE expired_slot.id = ${availabilityEvents.availabilitySlotId}
            AND (
              expired_slot.use_date < ${today}
              OR (expired_slot.use_date = ${today} AND expired_slot.start_time <= ${currentTime})
            )
        )`,
      ));

    const events = await this.database
      .select({
        id: availabilityEvents.id,
        occurredAt: availabilityEvents.occurredAt,
        venueId: availabilitySlots.venueId,
        sportId: availabilitySlots.sportId,
        useDate: availabilitySlots.useDate,
        startTime: availabilitySlots.startTime,
        endTime: availabilitySlots.endTime,
        city: venues.city,
        district: venues.district,
      })
      .from(availabilityEvents)
      .innerJoin(availabilitySlots, eq(availabilitySlots.id, availabilityEvents.availabilitySlotId))
      .innerJoin(sources, eq(sources.id, availabilitySlots.sourceId))
      .innerJoin(venues, eq(venues.id, availabilitySlots.venueId))
      .innerJoin(sports, eq(sports.id, availabilitySlots.sportId))
      .innerJoin(
        venueSports,
        and(
          eq(venueSports.venueId, availabilitySlots.venueId),
          eq(venueSports.sportId, availabilitySlots.sportId),
        ),
      )
      .where(and(
        eq(availabilityEvents.newStatus, 'AVAILABLE'),
        isNull(availabilityEvents.matchedAt),
        eq(availabilitySlots.status, 'AVAILABLE'),
        or(
          gt(availabilitySlots.useDate, today),
          and(eq(availabilitySlots.useDate, today), gt(availabilitySlots.startTime, currentTime)),
        ),
        eq(sources.active, true),
        eq(venues.active, true),
        eq(sports.active, true),
        eq(venueSports.active, true),
        sql`NOT EXISTS (
          SELECT 1
          FROM availability_events newer
          WHERE newer.availability_slot_id = ${availabilitySlots.id}
            AND newer.id > ${availabilityEvents.id}
        )`,
      ))
      .orderBy(asc(availabilityEvents.id))
      .limit(boundedLimit);

    let deliveriesCreated = 0;
    for (const event of events) {
      const candidates = await this.database
        .select({
          id: watchRules.id,
          userId: watchRules.userId,
          enabled: watchRules.enabled,
          dateFrom: watchRules.dateFrom,
          dateTo: watchRules.dateTo,
          daysOfWeek: watchRules.daysOfWeek,
          startTime: watchRules.startTime,
          endTime: watchRules.endTime,
          city: watchRules.city,
          district: watchRules.district,
        })
        .from(watchRules)
        .where(
          and(
            eq(watchRules.enabled, true),
            eq(watchRules.sportId, event.sportId),
            eq(watchRules.city, event.city),
            // Treat every watch edit/resume as a new activation boundary. An
            // availability event that happened before the latest rule state
            // must never become a retroactive notification just because Radar
            // matching was temporarily backlogged.
            lte(watchRules.updatedAt, event.occurredAt),
          ),
        )
        .orderBy(asc(watchRules.userId), asc(watchRules.id));

      const venueIdsByRule = new Map<number, number[]>();
      if (candidates.length > 0) {
        const mappings = await this.database
          .select({ watchRuleId: watchRuleVenues.watchRuleId, venueId: watchRuleVenues.venueId })
          .from(watchRuleVenues)
          .where(inArray(watchRuleVenues.watchRuleId, candidates.map((candidate) => candidate.id)));
        for (const mapping of mappings) {
          const venueIds = venueIdsByRule.get(mapping.watchRuleId) ?? [];
          venueIds.push(mapping.venueId);
          venueIdsByRule.set(mapping.watchRuleId, venueIds);
        }
      }

      // A user may intentionally have overlapping Radar rules. One slot event
      // should wake that browser once, not once per matching rule. Candidate
      // order is deterministic so retries select the same first matching rule.
      const usersWithDelivery = new Set<number>();
      for (const candidate of candidates) {
        if (usersWithDelivery.has(candidate.userId)) continue;
        const matched = matchesWatchRule(
          {
            ...candidate,
            venueIds: venueIdsByRule.get(candidate.id) ?? [],
          },
          {
            venueId: event.venueId,
            useDate: event.useDate,
            startTime: event.startTime,
            endTime: event.endTime,
            city: event.city,
            district: event.district,
          },
        );
        if (!matched) continue;
        usersWithDelivery.add(candidate.userId);

        const idempotencyKey = `watch:${candidate.id}:event:${event.id}:web-push`;
        const inserted = await this.database
          .insert(notificationDeliveries)
          .values({
            watchRuleId: candidate.id,
            availabilityEventId: event.id,
            subscriptionId: null,
            channel: 'WEB_PUSH',
            status: 'PENDING',
            idempotencyKey,
          })
          .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey })
          .returning({ id: notificationDeliveries.id });
        deliveriesCreated += inserted.length;

        let deliveryId = inserted[0]?.id ?? null;
        if (!deliveryId) {
          const [existing] = await this.database
            .select({ id: notificationDeliveries.id })
            .from(notificationDeliveries)
            .where(eq(notificationDeliveries.idempotencyKey, idempotencyKey))
            .limit(1);
          deliveryId = existing?.id ?? null;
        }
        if (deliveryId) {
          await this.database
            .insert(notificationDeliveryRuntime)
            .values({
              deliveryId,
              nextAttemptAt: now,
              expiresAt: new Date(event.occurredAt.getTime() + DELIVERY_MAX_AGE_MS),
            })
            .onConflictDoNothing({ target: notificationDeliveryRuntime.deliveryId });
        }
      }

      await this.database
        .update(availabilityEvents)
        .set({ matchedAt: now })
        .where(and(eq(availabilityEvents.id, event.id), isNull(availabilityEvents.matchedAt)));
    }

    return { eventsProcessed: events.length, deliveriesCreated };
  }
}
