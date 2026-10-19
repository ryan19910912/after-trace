import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WebSessionClaims } from './token';

/** Resolve the authenticated AFTERTRACE user from the provider-neutral signed Web session. */
export async function resolveWebSessionUserId(
  database: Database,
  session: WebSessionClaims,
): Promise<number | null> {
  const result = await database.execute(sql`
    SELECT account_row.id::text AS id
    FROM worklog_users AS account_row
    WHERE account_row.id = ${session.userId}
    LIMIT 1
  `);
  return databaseId((result.rows[0] as { id?: string } | undefined)?.id);
}

function databaseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
