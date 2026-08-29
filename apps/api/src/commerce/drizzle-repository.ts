import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { CommerceRepository } from './service';

export class DrizzleCommerceRepository implements CommerceRepository {
  constructor(private readonly db: Database) {}

  async findApplied(provider: string, providerEventId: string): Promise<null | { eventType: string; userId: number }> {
    const result = await this.db.execute(sql`
      SELECT event_type, user_id::text AS user_id
      FROM commerce_provider_events
      WHERE provider = ${provider}
        AND provider_event_id = ${providerEventId}
      LIMIT 1
    `);
    const row = result.rows[0] as { event_type?: string; user_id?: string } | undefined;
    return row?.event_type && row.user_id
      ? { eventType: row.event_type, userId: Number(row.user_id) }
      : null;
  }

  async recordApplied(input: Parameters<CommerceRepository['recordApplied']>[0]): Promise<'RECORDED' | 'ALREADY_RECORDED' | 'REFERENCE_CONFLICT'> {
    const payload = JSON.stringify(input.payload);
    const result = await this.db.execute(sql`
      WITH existing AS (
        SELECT event_type, user_id
        FROM commerce_provider_events
        WHERE provider = ${input.provider}
          AND provider_event_id = ${input.providerEventId}
      ), inserted AS (
        INSERT INTO commerce_provider_events (
          provider, provider_event_id, event_type, user_id, status, payload, created_at
        )
        SELECT ${input.provider}, ${input.providerEventId}, ${input.eventType}, ${input.userId}, 'APPLIED', ${payload}::jsonb, ${input.at}
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM existing WHERE event_type <> ${input.eventType} OR user_id <> ${input.userId})
          THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_RECORDED'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'RECORDED'
        ELSE 'ALREADY_RECORDED'
      END AS status
    `);
    return String((result.rows[0] as { status?: string } | undefined)?.status ?? 'REFERENCE_CONFLICT') as 'RECORDED' | 'ALREADY_RECORDED' | 'REFERENCE_CONFLICT';
  }

  async upsertSubscription(input: Parameters<CommerceRepository['upsertSubscription']>[0]): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO user_subscription_state (
        user_id, provider, provider_subscription_id, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES (
        ${input.userId}, ${input.provider}, ${input.providerSubscriptionId}, ${input.status},
        ${input.currentPeriodEnd}, ${input.cancelAtPeriodEnd ? 'true' : 'false'}, ${input.at}
      )
      ON CONFLICT (user_id) DO UPDATE
      SET provider = EXCLUDED.provider,
          provider_subscription_id = EXCLUDED.provider_subscription_id,
          status = EXCLUDED.status,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          updated_at = EXCLUDED.updated_at
    `);
  }

  async recordSubscriptionCycle(input: Parameters<CommerceRepository['recordSubscriptionCycle']>[0]): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO user_subscription_cycles (
        user_id, provider, subscription_id, cycle_id,
        period_start, period_end, grant_operation_id, created_at
      ) VALUES (
        ${input.userId}, ${input.provider}, ${input.providerSubscriptionId}, ${input.cycleId},
        ${input.periodStart}, ${input.periodEnd}, ${input.grantOperationId}, ${input.at}
      )
      ON CONFLICT DO NOTHING
    `);
  }

  async recordPaidPurchase(input: Parameters<CommerceRepository['recordPaidPurchase']>[0]): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO user_paid_purchases (
        user_id, provider, provider_purchase_id, pack_code, grant_operation_id, created_at
      ) VALUES (
        ${input.userId}, ${input.provider}, ${input.providerPurchaseId}, ${input.packCode},
        ${input.grantOperationId}, ${input.at}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}
