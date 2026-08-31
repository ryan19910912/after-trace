import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  availabilityEvents,
  availabilitySlots,
  notificationDeliveries,
  sources,
  sports,
  venueSports,
  venues,
  watchRules,
} from '../db/schema';

/**
 * Removes notification intents that are no longer actionable before a Push
 * request is sent. This closes the gap between Radar event creation and later
 * delivery when availability, source metadata or the user's watch state has
 * changed in the meantime.
 */
export class DrizzlePendingDeliveryReconciler {
  constructor(private readonly database: Database) {}

  async invalidateStalePending(now = new Date(), limit = 200): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const stale = await this.database
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .innerJoin(watchRules, eq(watchRules.id, notificationDeliveries.watchRuleId))
      .innerJoin(availabilityEvents, eq(availabilityEvents.id, notificationDeliveries.availabilityEventId))
      .innerJoin(availabilitySlots, eq(availabilitySlots.id, availabilityEvents.availabilitySlotId))
      .innerJoin(sources, eq(sources.id, availabilitySlots.sourceId))
      .innerJoin(venues, eq(venues.id, availabilitySlots.venueId))
      .innerJoin(sports, eq(sports.id, availabilitySlots.sportId))
      .leftJoin(
        venueSports,
        and(
          eq(venueSports.venueId, availabilitySlots.venueId),
          eq(venueSports.sportId, availabilitySlots.sportId),
        ),
      )
      .where(and(
        eq(notificationDeliveries.status, 'PENDING'),
        or(
          eq(watchRules.enabled, false),
          // Editing or resuming a watch establishes a new activation boundary;
          // delivery intents created under an older rule state must not survive.
          gt(watchRules.updatedAt, notificationDeliveries.createdAt),
          ne(availabilityEvents.newStatus, 'AVAILABLE'),
          ne(availabilitySlots.status, 'AVAILABLE'),
          eq(sources.active, false),
          eq(venues.active, false),
          eq(sports.active, false),
          isNull(venueSports.id),
          eq(venueSports.active, false),
          // A later transition for the same slot supersedes this event. Even if
          // the slot became AVAILABLE again, the newer event owns that wake-up.
          sql`EXISTS (
            SELECT 1
            FROM availability_events newer
            WHERE newer.availability_slot_id = ${availabilitySlots.id}
              AND newer.id > ${availabilityEvents.id}
          )`,
        ),
      ))
      .orderBy(asc(notificationDeliveries.id))
      .limit(boundedLimit);

    if (stale.length === 0) return 0;
    const updated = await this.database
      .update(notificationDeliveries)
      .set({
        status: 'FAILED',
        errorCode: 'DELIVERY_NO_LONGER_ACTIONABLE',
        updatedAt: now,
      })
      .where(and(
        inArray(notificationDeliveries.id, stale.map((row) => row.id)),
        eq(notificationDeliveries.status, 'PENDING'),
      ))
      .returning({ id: notificationDeliveries.id });
    return updated.length;
  }

  /**
   * Rechecks the exact delivery after a bare Push wakes the Service Worker.
   * Availability can change after Push-service acceptance but before the
   * browser fetches presentation data, so this is the final false-alert gate.
   */
  async isDeliveryActionable(userId: number, deliveryId: number): Promise<boolean> {
    const [row] = await this.database
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .innerJoin(watchRules, eq(watchRules.id, notificationDeliveries.watchRuleId))
      .innerJoin(availabilityEvents, eq(availabilityEvents.id, notificationDeliveries.availabilityEventId))
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
        eq(notificationDeliveries.id, deliveryId),
        eq(watchRules.userId, userId),
        eq(watchRules.enabled, true),
        lte(watchRules.updatedAt, notificationDeliveries.createdAt),
        eq(availabilityEvents.newStatus, 'AVAILABLE'),
        eq(availabilitySlots.status, 'AVAILABLE'),
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
      .limit(1);
    return Boolean(row);
  }
}
