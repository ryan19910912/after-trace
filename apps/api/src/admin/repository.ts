import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type AdminOverview = {
  users: number;
  groups: number;
  activeGroups: number;
  aiCallsToday: number;
  aiCostTwdToday: string;
  platformSubsidyUnitsToday: string;
  failedMemoryRequests: number;
  failedChats: number;
  scheduledReminders: number;
  scheduledProactive: number;
};

export class DrizzleAdminRepository {
  constructor(private readonly db: Database) {}

  async overview(at = new Date()): Promise<AdminOverview> {
    const dayStart = taipeiDayStart(at);
    const result = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM line_users)::text AS users,
        (SELECT COUNT(*) FROM line_groups)::text AS groups,
        (SELECT COUNT(*) FROM line_groups WHERE status = 'ACTIVE')::text AS active_groups,
        (
          (SELECT COUNT(*) FROM ai_energy_usage_events WHERE created_at >= ${dayStart})
          +
          (SELECT COUNT(*) FROM explicit_ai_chat_requests WHERE status = 'SUCCEEDED' AND updated_at >= ${dayStart})
        )::text AS ai_calls_today,
        (
          COALESCE((SELECT SUM(cost_twd) FROM ai_energy_usage_events WHERE created_at >= ${dayStart}), 0)
          + COALESCE((SELECT SUM(cost_twd) FROM explicit_ai_chat_requests WHERE status = 'SUCCEEDED' AND updated_at >= ${dayStart}), 0)
        )::text AS ai_cost_twd_today,
        COALESCE((SELECT SUM(units) FROM platform_ai_subsidy_operations WHERE created_at >= ${dayStart}), 0)::text AS subsidy_units_today,
        (SELECT COUNT(*) FROM memory_candidate_requests WHERE status = 'FAILED')::text AS failed_memory_requests,
        (SELECT COUNT(*) FROM explicit_ai_chat_requests WHERE status = 'FAILED')::text AS failed_chats,
        (SELECT COUNT(*) FROM reminders WHERE status IN ('SCHEDULED','DISPATCHING'))::text AS scheduled_reminders,
        (SELECT COUNT(*) FROM proactive_pushes WHERE status IN ('SCHEDULED','DISPATCHING'))::text AS scheduled_proactive
    `);
    const row = result.rows[0] as Record<string, string>;
    return {
      users: Number(row.users ?? 0),
      groups: Number(row.groups ?? 0),
      activeGroups: Number(row.active_groups ?? 0),
      aiCallsToday: Number(row.ai_calls_today ?? 0),
      aiCostTwdToday: row.ai_cost_twd_today ?? '0',
      platformSubsidyUnitsToday: row.subsidy_units_today ?? '0',
      failedMemoryRequests: Number(row.failed_memory_requests ?? 0),
      failedChats: Number(row.failed_chats ?? 0),
      scheduledReminders: Number(row.scheduled_reminders ?? 0),
      scheduledProactive: Number(row.scheduled_proactive ?? 0),
    };
  }

  async users(query: string | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT
        u.id::text AS id,
        u.line_user_id,
        u.created_at,
        u.updated_at,
        COALESCE(SUM(CASE WHEN l.available_units > 0 AND (l.expires_at IS NULL OR l.expires_at > NOW()) THEN l.available_units ELSE 0 END), 0)::text AS usable_units,
        COALESCE(SUM(l.reserved_units), 0)::text AS reserved_units,
        subscription.status AS subscription_status,
        subscription.current_period_end,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.line_user_id = u.line_user_id AND gm.is_active = TRUE)::text AS active_group_count
      FROM line_users u
      LEFT JOIN user_energy_lots l ON l.user_id = u.id
      LEFT JOIN user_subscription_state subscription ON subscription.user_id = u.id
      WHERE ${query}::text IS NULL OR u.line_user_id ILIKE '%' || ${query} || '%' OR u.id::text = ${query}
      GROUP BY u.id, subscription.status, subscription.current_period_end
      ORDER BY u.updated_at DESC, u.id DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async userDetail(userId: number) {
    const [user, lots, ai, purchases, ads, reminders] = await Promise.all([
      this.db.execute(sql`
        SELECT u.id::text AS id, u.line_user_id, u.created_at, u.updated_at,
               s.provider, s.status AS subscription_status, s.current_period_end, s.cancel_at_period_end
        FROM line_users u LEFT JOIN user_subscription_state s ON s.user_id = u.id
        WHERE u.id = ${userId} LIMIT 1
      `),
      this.db.execute(sql`
        SELECT id::text AS id, bucket, original_units::text, available_units::text, reserved_units::text,
               source_type, source_id, expires_at, created_at
        FROM user_energy_lots WHERE user_id = ${userId}
        ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, id
      `),
      this.db.execute(sql`
        SELECT 'MEMORY' AS kind, request_id::text AS id, usage_type, model, input_tokens, output_tokens,
               cost_twd::text, energy_units::text, created_at
        FROM ai_energy_usage_events WHERE request_id IN (
          SELECT request_id FROM ai_user_energy_allocations WHERE user_id = ${userId}
        )
        UNION ALL
        SELECT 'CHAT', id::text, usage_type, model, input_tokens, output_tokens,
               cost_twd::text, energy_units::text, updated_at
        FROM explicit_ai_chat_requests WHERE user_id = ${userId} AND status = 'SUCCEEDED'
        ORDER BY created_at DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT provider, provider_purchase_id, pack_code, grant_operation_id::text, created_at
        FROM user_paid_purchases WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT id::text AS id, provider, provider_event_id, status, accepted_at, granted_at
        FROM user_rewarded_ad_claims WHERE user_id = ${userId} ORDER BY accepted_at DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT r.id::text AS id, r.group_id::text AS group_id, r.message, r.scheduled_for, r.status,
               o.energy_reservation_id::text AS energy_reservation_id
        FROM user_reminder_ownership o JOIN reminders r ON r.id = o.reminder_id
        WHERE o.user_id = ${userId} ORDER BY r.scheduled_for DESC LIMIT 50
      `),
    ]);
    const row = user.rows[0];
    return row ? { user: row, lots: lots.rows, ai: ai.rows, purchases: purchases.rows, rewardedAds: ads.rows, reminders: reminders.rows } : null;
  }

  async groups(query: string | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT g.id::text AS id, g.line_group_id, g.status, g.created_at, g.updated_at,
             g.pending_message_count, g.pending_char_count,
             (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.is_active = TRUE)::text AS active_members,
             (SELECT COUNT(*) FROM memories m WHERE m.group_id = g.id AND m.status = 'ACTIVE')::text AS active_memories
      FROM line_groups g
      WHERE ${query}::text IS NULL OR g.line_group_id ILIKE '%' || ${query} || '%' OR g.id::text = ${query}
      ORDER BY g.updated_at DESC, g.id DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async groupDetail(groupId: number) {
    const [group, members, memories, batches, reminders, proactive] = await Promise.all([
      this.db.execute(sql`SELECT * FROM line_groups WHERE id = ${groupId} LIMIT 1`),
      this.db.execute(sql`
        SELECT gm.line_user_id, gm.is_active, gm.first_seen_at, gm.last_seen_at, u.id::text AS user_id
        FROM group_members gm LEFT JOIN line_users u ON u.line_user_id = gm.line_user_id
        WHERE gm.group_id = ${groupId} ORDER BY gm.is_active DESC, gm.last_seen_at DESC
      `),
      this.db.execute(sql`
        SELECT id::text AS id, category, subject, content, source_message_id, source_line_timestamp, updated_at
        FROM memories WHERE group_id = ${groupId} AND status = 'ACTIVE'
        ORDER BY updated_at DESC LIMIT 100
      `),
      this.db.execute(sql`
        SELECT id::text AS id, status, message_count, char_count, attempt_count, last_error_code, created_at, completed_at
        FROM conversation_extraction_batches WHERE group_id = ${groupId}
        ORDER BY id DESC LIMIT 30
      `),
      this.db.execute(sql`
        SELECT r.id::text AS id, r.message, r.scheduled_for, r.status, o.user_id::text AS owner_user_id
        FROM reminders r LEFT JOIN user_reminder_ownership o ON o.reminder_id = r.id
        WHERE r.group_id = ${groupId} ORDER BY r.scheduled_for DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT id::text AS id, user_id::text, source_type, source_id, message, scheduled_for, status, last_error_code
        FROM proactive_pushes WHERE group_id = ${groupId} ORDER BY scheduled_for DESC LIMIT 50
      `),
    ]);
    const row = group.rows[0];
    return row ? { group: row, members: members.rows, memories: memories.rows, batches: batches.rows, reminders: reminders.rows, proactive: proactive.rows } : null;
  }

  async failures(limit: number) {
    const [memory, chat, proactive] = await Promise.all([
      this.db.execute(sql`
        SELECT request.id::text AS id, request.group_id::text AS group_id, request.origin, request.last_error_code,
               work.attempt_count, work.transient_failure_count, request.updated_at
        FROM memory_candidate_requests request
        JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.status = 'FAILED'
        ORDER BY request.updated_at DESC LIMIT ${limit}
      `),
      this.db.execute(sql`
        SELECT id::text AS id, group_id::text, user_id::text, line_message_id, last_error_code, updated_at
        FROM explicit_ai_chat_requests WHERE status = 'FAILED'
        ORDER BY updated_at DESC LIMIT ${limit}
      `),
      this.db.execute(sql`
        SELECT id::text AS id, group_id::text, user_id::text, source_type, source_id, last_error_code, updated_at
        FROM proactive_pushes WHERE status = 'FAILED'
        ORDER BY updated_at DESC LIMIT ${limit}
      `),
    ]);
    return { memory: memory.rows, chat: chat.rows, proactive: proactive.rows };
  }

  async audit(limit: number) {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, group_id::text AS group_id, actor_line_user_id, action, target_type, target_id,
             before_value, after_value, created_at
      FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ${limit}
    `);
    return result.rows;
  }

  async failedMemoryAttempt(requestId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT work.attempt_count
      FROM memory_candidate_requests request
      JOIN memory_request_work_states work ON work.request_id = request.id
      WHERE request.id = ${requestId} AND request.status = 'FAILED'
      LIMIT 1
    `);
    const row = result.rows[0] as { attempt_count?: number } | undefined;
    return row?.attempt_count ?? null;
  }

  async cancelProactive(id: number, at = new Date()): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE proactive_pushes SET status = 'CANCELLED', cancelled_at = ${at}, updated_at = ${at}
      WHERE id = ${id} AND status = 'SCHEDULED'
      RETURNING id
    `);
    return result.rows.length === 1;
  }
}

function taipeiDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
}
