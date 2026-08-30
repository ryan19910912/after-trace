import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client';
import { notificationDeliveryRuntime } from '../db/schema-notifications';
import {
  availabilityEvents,
  availabilitySlots,
  notificationDeliveries,
  venues,
  watchRules,
  watchRuleVenues,
} from '../db/schema';
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
      .innerJoin(venues, eq(venues.id, availabilitySlots.venueId))
      .where(and(eq(availabilityEvents.newStatus, 'AVAILABLE'), isNull(availabilityEvents.matchedAt)))
      .orderBy(asc(availabilityEvents.id))
      .limit(boundedLimit);

    let deliveriesCreated = 0;
    for (const event of events) {
      const candidates = await this.database
        .select({
          id: watchRules.id,
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
            lte(watchRules.createdAt, event.occurredAt),
          ),
        );

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

      for (const candidate of candidates) {
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
              nextAttemptAt: new Date(),
              expiresAt: new Date(event.occurredAt.getTime() + DELIVERY_MAX_AGE_MS),
            })
            .onConflictDoNothing({ target: notificationDeliveryRuntime.deliveryId });
        }
      }

      await this.database
        .update(availabilityEvents)
        .set({ matchedAt: new Date() })
        .where(and(eq(availabilityEvents.id, event.id), isNull(availabilityEvents.matchedAt)));
    }

    return { eventsProcessed: events.length, deliveriesCreated };
  }
}
