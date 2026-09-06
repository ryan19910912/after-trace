import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogPrivateInputMode,
  WorklogPrivateInputModeConsumeResult,
  WorklogPrivateInputModeRepository,
} from './oa-input-mode';

export class DrizzleWorklogPrivateInputModeRepository implements WorklogPrivateInputModeRepository {
  constructor(private readonly db: Database) {}

  async set(input: {
    userId: number;
    action: WorklogPrivateInputMode;
    expiresAt: Date;
    at: Date;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_private_pending_actions (
        user_id, action, expires_at, created_at, updated_at
      ) VALUES (
        ${input.userId}, ${input.action}, ${input.expiresAt}, ${input.at}, ${input.at}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        action = EXCLUDED.action,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at
    `);
  }

  async consume(userId: number, at: Date): Promise<WorklogPrivateInputModeConsumeResult> {
    const result = await this.db.execute(sql`
      DELETE FROM worklog_private_pending_actions
      WHERE user_id = ${userId}
      RETURNING action, expires_at
    `);
    const row = result.rows[0] as { action?: unknown; expires_at?: unknown } | undefined;
    if (!row) return { status: 'NONE' };

    const expiresAt = row.expires_at instanceof Date
      ? row.expires_at
      : new Date(String(row.expires_at ?? ''));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= at.getTime()) {
      return { status: 'EXPIRED' };
    }
    if (row.action === 'RECORD' || row.action === 'QUERY') {
      return { status: 'ACTIVE', action: row.action };
    }
    throw new Error('invalid private OA pending action');
  }
}
