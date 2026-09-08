import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

/** Provider-neutral account bootstrap used after Google/LINE/Apple authentication. */
export class DrizzleAccountOnboardingRepository {
  constructor(private readonly db: Database) {}

  async ensureWorkspace(ownerUserId: number, at: Date): Promise<number> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_workspaces (owner_user_id, created_at, updated_at)
      VALUES (${ownerUserId}, ${at}, ${at})
      ON CONFLICT (owner_user_id) DO UPDATE
      SET updated_at = GREATEST(worklog_workspaces.updated_at, EXCLUDED.updated_at)
      RETURNING id::text
    `);
    return positiveId((result.rows[0] as { id?: string } | undefined)?.id, 'ACCOUNT_WORKSPACE_BOOTSTRAP_FAILED');
  }

  async ensurePrivateSource(userId: number, workspaceId: number, at: Date): Promise<number> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_sources (
        workspace_id, type, status, private_user_id, created_at, updated_at
      )
      VALUES (${workspaceId}, 'PRIVATE', 'ACTIVE', ${userId}, ${at}, ${at})
      ON CONFLICT (private_user_id) DO UPDATE
      SET workspace_id = EXCLUDED.workspace_id,
          status = 'ACTIVE',
          inactive_at = NULL,
          updated_at = GREATEST(worklog_sources.updated_at, EXCLUDED.updated_at)
      RETURNING id::text
    `);
    return positiveId((result.rows[0] as { id?: string } | undefined)?.id, 'ACCOUNT_PRIVATE_SOURCE_BOOTSTRAP_FAILED');
  }
}

function positiveId(value: string | undefined, error: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(error);
  return parsed;
}
