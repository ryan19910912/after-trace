import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../db/client';
import { notificationDeliveryRuntime } from '../db/schema-notifications';
import {
  availabilityEvents,
  availabilitySlots,
  courts,
  notificationDeliveries,
  notificationSubscriptions,
  sports,
  venues,
  watchRules,
} from '../db/schema';
import type { PushSubscriptionInput } from './validation';
import { normalizePushSubscription } from './validation';

const MAX_DELIVERY_AGE_MS = 30 * 60 * 1000;

export type DuePushDelivery = {
  deliveryId: number;
  userId: number;
  subscriptionId: number | null;
  attemptCount: number;
  expiresAt: Date;
};

export class DrizzleNotificationRepository {
  constructor(private readonly database: Database) {}

  async upsertWebPushSubscription(userId: number, input: PushSubscriptionInput) {
    const normalized = normalizePushSubscription(input);
    const now = new Date();

    // An anonymous identity represents one browser profile in V1. Keep one
    // active push endpoint for that identity so one Radar event produces one
    // user-visible notification instead of duplicate device fan-out.
    await this.database
      .update(notificationSubscriptions)
      .set({ active: false, updatedAt: now })
      .where(and(
        eq(notificationSubscriptions.userId, userId),
        eq(notificationSubscriptions.channel, 'WEB_PUSH'),
        eq(notificationSubscriptions.active, true),
        ne(notificationSubscriptions.endpoint, normalized.endpoint),
      ));

    const [stored] = await this.database
      .insert(notificationSubscriptions)
      .values({
        userId,
        channel: 'WEB_PUSH',
        endpoint: normalized.endpoint,
        p256dh: normalized.p256dh,
        authSecret: normalized.authSecret,
        active: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [notificationSubscriptions.userId, notificationSubscriptions.endpoint],
        set: {
          channel: 'WEB_PUSH',
          p256dh: normalized.p256dh,
          authSecret: normalized.authSecret,
          active: true,
          updatedAt: now,
        },
      })
      .returning({ id: notificationSubscriptions.id, active: notificationSubscriptions.active });

    if (!stored) throw new Error('Push subscription upsert did not return a row');
    return stored;
  }

  async deactivateWebPushSubscription(userId: number, endpoint: string): Promise<boolean> {
    const rows = await this.database
      .update(notificationSubscriptions)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(notificationSubscriptions.userId, userId),
        eq(notificationSubscriptions.channel, 'WEB_PUSH'),
        eq(notificationSubscriptions.endpoint, endpoint),
        eq(notificationSubscriptions.active, true),
      ))
      .returning({ id: notificationSubscriptions.id });
    return rows.length > 0;
  }

  async getActiveSubscription(userId: number, preferredSubscriptionId: number | null) {
    if (preferredSubscriptionId) {
      const [preferred] = await this.database
        .select({ id: notificationSubscriptions.id, endpoint: notificationSubscriptions.endpoint })
        .from(notificationSubscriptions)
        .where(and(
          eq(notificationSubscriptions.id, preferredSubscriptionId),
          eq(notificationSubscriptions.userId, userId),
          eq(notificationSubscriptions.channel, 'WEB_PUSH'),
          eq(notificationSubscriptions.active, true),
        ))
        .limit(1);
      if (preferred) return preferred;
    }

    const [latest] = await this.database
      .select({ id: notificationSubscriptions.id, endpoint: notificationSubscriptions.endpoint })
      .from(notificationSubscriptions)
      .where(and(
        eq(notificationSubscriptions.userId, userId),
        eq(notificationSubscriptions.channel, 'WEB_PUSH'),
        eq(notificationSubscriptions.active, true),
      ))
      .orderBy(desc(notificationSubscriptions.id))
      .limit(1);
    return latest ?? null;
  }

  async expireStalePending(now = new Date(), limit = 200): Promise<number> {
    const rows = await this.database
      .select({ deliveryId: notificationDeliveryRuntime.deliveryId })
      .from(notificationDeliveryRuntime)
      .innerJoin(notificationDeliveries, eq(notificationDeliveries.id, notificationDeliveryRuntime.deliveryId))
      .where(and(
        eq(notificationDeliveries.status, 'PENDING'),
        lte(notificationDeliveryRuntime.expiresAt, now),
      ))
      .orderBy(asc(notificationDeliveryRuntime.expiresAt), asc(notificationDeliveryRuntime.deliveryId))
      .limit(Math.max(1, Math.min(500, Math.trunc(limit))));
    if (rows.length === 0) return 0;

    const ids = rows.map((row) => row.deliveryId);
    const updated = await this.database
      .update(notificationDeliveries)
      .set({ status: 'FAILED', errorCode: 'DELIVERY_EXPIRED', updatedAt: now })
      .where(and(inArray(notificationDeliveries.id, ids), eq(notificationDeliveries.status, 'PENDING')))
      .returning({ id: notificationDeliveries.id });
    return updated.length;
  }

  async listDuePushDeliveries(now = new Date(), limit = 12): Promise<DuePushDelivery[]> {
    return this.database
      .select({
        deliveryId: notificationDeliveries.id,
        userId: watchRules.userId,
        subscriptionId: notificationDeliveries.subscriptionId,
        attemptCount: notificationDeliveryRuntime.attemptCount,
        expiresAt: notificationDeliveryRuntime.expiresAt,
      })
      .from(notificationDeliveryRuntime)
      .innerJoin(notificationDeliveries, eq(notificationDeliveries.id, notificationDeliveryRuntime.deliveryId))
      .innerJoin(watchRules, eq(watchRules.id, notificationDeliveries.watchRuleId))
      .where(and(
        eq(notificationDeliveries.channel, 'WEB_PUSH'),
        eq(notificationDeliveries.status, 'PENDING'),
        lte(notificationDeliveryRuntime.nextAttemptAt, now),
        gt(notificationDeliveryRuntime.expiresAt, now),
      ))
      .orderBy(asc(notificationDeliveryRuntime.nextAttemptAt), asc(notificationDeliveryRuntime.deliveryId))
      .limit(Math.max(1, Math.min(50, Math.trunc(limit))));
  }

  async claimDelivery(deliveryId: number, claimKey: string, now: Date, leaseUntil: Date) {
    const [claimed] = await this.database
      .update(notificationDeliveryRuntime)
      .set({
        attemptCount: sql`${notificationDeliveryRuntime.attemptCount} + 1`,
        nextAttemptAt: leaseUntil,
        dispatchClaimKey: claimKey,
        updatedAt: now,
      })
      .where(and(
        eq(notificationDeliveryRuntime.deliveryId, deliveryId),
        lte(notificationDeliveryRuntime.nextAttemptAt, now),
        gt(notificationDeliveryRuntime.expiresAt, now),
        sql`EXISTS (
          SELECT 1 FROM notification_deliveries d
          WHERE d.id = ${deliveryId} AND d.status = 'PENDING'
        )`,
      ))
      .returning({
        attemptCount: notificationDeliveryRuntime.attemptCount,
        expiresAt: notificationDeliveryRuntime.expiresAt,
      });
    return claimed ?? null;
  }

  async bindSubscription(
    deliveryId: number,
    subscriptionId: number,
    claimKey: string,
    now = new Date(),
  ): Promise<boolean> {
    const [updated] = await this.database
      .update(notificationDeliveries)
      .set({ subscriptionId, updatedAt: now })
      .where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, 'PENDING'),
        sql`EXISTS (
          SELECT 1 FROM notification_delivery_runtime r
          WHERE r.delivery_id = ${deliveryId} AND r.dispatch_claim_key = ${claimKey}
        )`,
      ))
      .returning({ id: notificationDeliveries.id });
    return Boolean(updated);
  }

  async settleAccepted(deliveryId: number, claimKey: string, now = new Date()): Promise<boolean> {
    // Normally the dispatcher writes SENT first, then clears its lease. A Push
    // service may however wake the Service Worker before the POST response gets
    // back to this Worker; claimPresentation can therefore mark the same row
    // SENT first. Treat both paths as one successful settlement as long as this
    // dispatcher still owns the runtime claim.
    const [claim] = await this.database
      .select({ deliveryId: notificationDeliveryRuntime.deliveryId })
      .from(notificationDeliveryRuntime)
      .where(and(
        eq(notificationDeliveryRuntime.deliveryId, deliveryId),
        eq(notificationDeliveryRuntime.dispatchClaimKey, claimKey),
      ))
      .limit(1);
    if (!claim) return false;

    const [current] = await this.database
      .select({ status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId))
      .limit(1);
    if (!current || current.status === 'FAILED') return false;

    if (current.status === 'PENDING') {
      const [updated] = await this.database
        .update(notificationDeliveries)
        .set({ status: 'SENT', errorCode: null, sentAt: now, updatedAt: now })
        .where(and(
          eq(notificationDeliveries.id, deliveryId),
          eq(notificationDeliveries.status, 'PENDING'),
          sql`EXISTS (
            SELECT 1 FROM notification_delivery_runtime r
            WHERE r.delivery_id = ${deliveryId} AND r.dispatch_claim_key = ${claimKey}
          )`,
        ))
        .returning({ id: notificationDeliveries.id });
      if (!updated) {
        const [raced] = await this.database
          .select({ status: notificationDeliveries.status })
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, deliveryId))
          .limit(1);
        if (raced?.status !== 'SENT' && raced?.status !== 'OPENED') return false;
      }
    }

    await this.clearClaim(deliveryId, claimKey, now);
    return true;
  }

  async settleRetry(deliveryId: number, claimKey: string, errorCode: string, nextAttemptAt: Date, now = new Date()) {
    const [runtime] = await this.database
      .update(notificationDeliveryRuntime)
      .set({ dispatchClaimKey: null, nextAttemptAt, updatedAt: now })
      .where(and(
        eq(notificationDeliveryRuntime.deliveryId, deliveryId),
        eq(notificationDeliveryRuntime.dispatchClaimKey, claimKey),
        sql`EXISTS (
          SELECT 1 FROM notification_deliveries d
          WHERE d.id = ${deliveryId} AND d.status = 'PENDING'
        )`,
      ))
      .returning({ deliveryId: notificationDeliveryRuntime.deliveryId });
    if (!runtime) return false;
    await this.database
      .update(notificationDeliveries)
      .set({ errorCode, updatedAt: now })
      .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.status, 'PENDING')));
    return true;
  }

  async settleFailed(deliveryId: number, claimKey: string, errorCode: string, now = new Date()) {
    const [updated] = await this.database
      .update(notificationDeliveries)
      .set({ status: 'FAILED', errorCode, updatedAt: now })
      .where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, 'PENDING'),
        sql`EXISTS (
          SELECT 1 FROM notification_delivery_runtime r
          WHERE r.delivery_id = ${deliveryId} AND r.dispatch_claim_key = ${claimKey}
        )`,
      ))
      .returning({ id: notificationDeliveries.id });
    if (!updated) return false;
    await this.clearClaim(deliveryId, claimKey, now);
    return true;
  }

  async resetGoneSubscription(
    deliveryId: number,
    claimKey: string,
    subscriptionId: number,
    now = new Date(),
  ): Promise<boolean> {
    const [ownedClaim] = await this.database
      .select({ deliveryId: notificationDeliveryRuntime.deliveryId })
      .from(notificationDeliveryRuntime)
      .where(and(
        eq(notificationDeliveryRuntime.deliveryId, deliveryId),
        eq(notificationDeliveryRuntime.dispatchClaimKey, claimKey),
      ))
      .limit(1);
    if (!ownedClaim) return false;

    // 404/410 is authoritative for this concrete endpoint. Deactivating it is
    // safe even if the lease later expires. Only unbind the delivery when it
    // still points at the same dead subscription, so a newer worker cannot
    // have its replacement binding erased by an older response.
    await this.database
      .update(notificationSubscriptions)
      .set({ active: false, updatedAt: now })
      .where(eq(notificationSubscriptions.id, subscriptionId));
    await this.database
      .update(notificationDeliveries)
      .set({ subscriptionId: null, errorCode: 'SUBSCRIPTION_GONE', updatedAt: now })
      .where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, 'PENDING'),
        eq(notificationDeliveries.subscriptionId, subscriptionId),
      ));

    const [runtime] = await this.database
      .update(notificationDeliveryRuntime)
      .set({
        attemptCount: 0,
        dispatchClaimKey: null,
        nextAttemptAt: new Date(now.getTime() + 60_000),
        updatedAt: now,
      })
      .where(and(
        eq(notificationDeliveryRuntime.deliveryId, deliveryId),
        eq(notificationDeliveryRuntime.dispatchClaimKey, claimKey),
      ))
      .returning({ deliveryId: notificationDeliveryRuntime.deliveryId });
    return Boolean(runtime);
  }

  async claimPresentation(userId: number, endpoint: string, now = new Date()) {
    const candidates = await this.database
      .select({
        deliveryId: notificationDeliveries.id,
        venueId: availabilitySlots.venueId,
        venueName: venues.name,
        district: venues.district,
        sportCode: sports.code,
        sportName: sports.name,
        courtName: courts.name,
        useDate: availabilitySlots.useDate,
        startTime: availabilitySlots.startTime,
        endTime: availabilitySlots.endTime,
      })
      .from(notificationDeliveries)
      .innerJoin(notificationDeliveryRuntime, eq(notificationDeliveryRuntime.deliveryId, notificationDeliveries.id))
      .innerJoin(notificationSubscriptions, eq(notificationSubscriptions.id, notificationDeliveries.subscriptionId))
      .innerJoin(watchRules, eq(watchRules.id, notificationDeliveries.watchRuleId))
      .innerJoin(availabilityEvents, eq(availabilityEvents.id, notificationDeliveries.availabilityEventId))
      .innerJoin(availabilitySlots, eq(availabilitySlots.id, availabilityEvents.availabilitySlotId))
      .innerJoin(venues, eq(venues.id, availabilitySlots.venueId))
      .innerJoin(sports, eq(sports.id, availabilitySlots.sportId))
      .leftJoin(courts, eq(courts.id, availabilitySlots.courtId))
      .where(and(
        eq(watchRules.userId, userId),
        eq(notificationSubscriptions.endpoint, endpoint),
        eq(notificationSubscriptions.active, true),
        isNull(notificationDeliveryRuntime.presentedAt),
        gt(notificationDeliveryRuntime.expiresAt, now),
        or(
          eq(notificationDeliveries.status, 'SENT'),
          and(
            eq(notificationDeliveries.status, 'PENDING'),
            isNotNull(notificationDeliveryRuntime.dispatchClaimKey),
          ),
        ),
      ))
      .orderBy(asc(notificationDeliveries.sentAt), asc(notificationDeliveries.id))
      .limit(5);

    for (const candidate of candidates) {
      const [claimed] = await this.database
        .update(notificationDeliveryRuntime)
        .set({ presentedAt: now, updatedAt: now })
        .where(and(
          eq(notificationDeliveryRuntime.deliveryId, candidate.deliveryId),
          isNull(notificationDeliveryRuntime.presentedAt),
          gt(notificationDeliveryRuntime.expiresAt, now),
        ))
        .returning({ deliveryId: notificationDeliveryRuntime.deliveryId });
      if (!claimed) continue;

      // Seeing the Push event is stronger evidence than waiting for the
      // dispatching Worker to receive the Push service's HTTP response. Close
      // that race by allowing presentation to settle PENDING -> SENT itself.
      await this.database
        .update(notificationDeliveries)
        .set({ status: 'SENT', errorCode: null, sentAt: now, updatedAt: now })
        .where(and(
          eq(notificationDeliveries.id, candidate.deliveryId),
          eq(notificationDeliveries.status, 'PENDING'),
        ));

      const params = new URLSearchParams({
        sport: candidate.sportCode,
        venueId: String(candidate.venueId),
        date: candidate.useDate,
        start: candidate.startTime.slice(0, 5),
        end: candidate.endTime.slice(0, 5),
        radar: '1',
      });
      return {
        deliveryId: candidate.deliveryId,
        title: '發現可預約空位',
        body: `${candidate.venueName}｜${candidate.sportName}｜${candidate.useDate} ${candidate.startTime.slice(0, 5)}–${candidate.endTime.slice(0, 5)}`,
        tag: `aftertrace-delivery-${candidate.deliveryId}`,
        deepLink: `/?${params.toString()}`,
        venueName: candidate.venueName,
        district: candidate.district,
        courtName: candidate.courtName,
      };
    }
    return null;
  }

  async markOpened(userId: number, deliveryId: number, now = new Date()): Promise<boolean> {
    const [owned] = await this.database
      .select({ id: notificationDeliveries.id, status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .innerJoin(watchRules, eq(watchRules.id, notificationDeliveries.watchRuleId))
      .where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(watchRules.userId, userId),
        or(eq(notificationDeliveries.status, 'SENT'), eq(notificationDeliveries.status, 'OPENED')),
      ))
      .limit(1);
    if (!owned) return false;
    if (owned.status === 'OPENED') return true;

    await this.database
      .update(notificationDeliveries)
      .set({ status: 'OPENED', openedAt: now, updatedAt: now })
      .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.status, 'SENT')));
    return true;
  }

  async ensureRuntime(deliveryId: number, occurredAt: Date, now = new Date()): Promise<void> {
    await this.database
      .insert(notificationDeliveryRuntime)
      .values({
        deliveryId,
        nextAttemptAt: now,
        expiresAt: new Date(occurredAt.getTime() + MAX_DELIVERY_AGE_MS),
        updatedAt: now,
      })
      .onConflictDoNothing({ target: notificationDeliveryRuntime.deliveryId });
  }

  private async clearClaim(deliveryId: number, claimKey: string, now: Date) {
    const [runtime] = await this.database
      .update(notificationDeliveryRuntime)
      .set({ dispatchClaimKey: null, updatedAt: now })
      .where(and(
        eq(notificationDeliveryRuntime.deliveryId, deliveryId),
        eq(notificationDeliveryRuntime.dispatchClaimKey, claimKey),
      ))
      .returning({ deliveryId: notificationDeliveryRuntime.deliveryId });
    return runtime ?? null;
  }
}
