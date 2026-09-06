import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WebSessionClaims } from './token';

/**
 * Resolve the authenticated AFTERTRACE user from a signed Web session.
 *
 * Target sessions carry durable numeric userId. lineUserId is accepted only as a
 * bounded migration fallback for already-issued LINE-era sessions.
 */
export async function resolveWebSessionUserId(
  database: Database,
  session: WebSessionClaims,
): Promise<number | null> {
  if (session.userId) {
    const result = await database.execute(sql`
      SELECT worklog_user.id::text AS id
      FROM worklog_users AS worklog_user
      WHERE worklog_user.id = ${session.userId}
      LIMIT 1
    `);
    return databaseId((result.rows[0] as { id?: string } | undefined)?.id);
  }

  if (!session.lineUserId) return null;
  const result = await database.execute(sql`
    SELECT worklog_user.id::text AS id
    FROM worklog_users AS worklog_user
    WHERE worklog_user.line_user_id = ${session.lineUserId}
    LIMIT 1
  `);
  return databaseId((result.rows[0] as { id?: string } | undefined)?.id);
}

function databaseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
