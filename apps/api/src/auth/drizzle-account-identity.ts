import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  AccountIdentityRepository,
  AccountProfile,
  ProvisionAccountIdentityInput,
} from './account-identity';

type AccountProfileRow = {
  id: string;
  display_name: string | null;
  public_account_id: string;
};

/**
 * Provider-neutral account provisioning.
 *
 * One SQL statement is used so a newly-created user, provider identity and public account
 * id either commit together or roll back together. A provider+subject advisory transaction
 * lock prevents concurrent callbacks for the same external identity from creating duplicate
 * AFTERTRACE users. Public-account-id uniqueness remains enforced by PostgreSQL.
 */
export class DrizzleAccountIdentityRepository implements AccountIdentityRepository {
  constructor(private readonly db: Database) {}

  async provision(
    input: ProvisionAccountIdentityInput & { publicAccountId: string; at: Date },
  ): Promise<AccountProfile> {
    const provider = input.provider;
    const subject = input.subject.trim();
    const emailSnapshot = normalizeOptional(input.emailSnapshot);
    const displayNameSnapshot = normalizeOptional(input.displayNameSnapshot);
    const legacyLineUserId = provider === 'LINE' ? normalizeOptional(input.legacyLineUserId) : null;
    if (!subject) throw new Error('AUTH_PROVIDER_SUBJECT_REQUIRED');
    if (provider === 'LINE' && !legacyLineUserId) throw new Error('LINE_SUBJECT_REQUIRED');

    const result = await this.db.execute(sql`
      WITH identity_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${provider}::text || ':' || ${subject}::text, 0)
        ) AS locked
      ),
      existing_identity AS (
        SELECT identity_row.user_id
        FROM worklog_auth_identities AS identity_row
        CROSS JOIN identity_lock
        WHERE identity_row.provider = ${provider}::worklog_auth_provider
          AND identity_row.subject = ${subject}
        LIMIT 1
      ),
      legacy_line_account AS (
        SELECT account_row.id AS user_id
        FROM worklog_users AS account_row
        CROSS JOIN identity_lock
        WHERE NOT EXISTS (SELECT 1 FROM existing_identity)
          AND ${provider}::text = 'LINE'
          AND ${legacyLineUserId}::text IS NOT NULL
          AND account_row.line_user_id = ${legacyLineUserId}
        LIMIT 1
      ),
      created_account AS (
        INSERT INTO worklog_users (
          line_user_id,
          display_name,
          last_interaction_at,
          created_at,
          updated_at
        )
        SELECT
          CASE WHEN ${provider}::text = 'LINE' THEN ${legacyLineUserId} ELSE NULL END,
          ${displayNameSnapshot},
          ${input.at},
          ${input.at},
          ${input.at}
        FROM identity_lock
        WHERE NOT EXISTS (SELECT 1 FROM existing_identity)
          AND NOT EXISTS (SELECT 1 FROM legacy_line_account)
        RETURNING id AS user_id
      ),
      resolved_account AS (
        SELECT user_id FROM existing_identity
        UNION ALL
        SELECT user_id FROM legacy_line_account
        UNION ALL
        SELECT user_id FROM created_account
        LIMIT 1
      ),
      updated_account AS (
        UPDATE worklog_users AS account_row
        SET
          line_user_id = CASE
            WHEN ${provider}::text = 'LINE' AND account_row.line_user_id IS NULL
              THEN ${legacyLineUserId}
            ELSE account_row.line_user_id
          END,
          display_name = COALESCE(${displayNameSnapshot}, account_row.display_name),
          last_interaction_at = CASE
            WHEN account_row.last_interaction_at IS NULL THEN ${input.at}
            ELSE GREATEST(account_row.last_interaction_at, ${input.at})
          END,
          updated_at = GREATEST(account_row.updated_at, ${input.at})
        FROM resolved_account
        WHERE account_row.id = resolved_account.user_id
        RETURNING account_row.id, account_row.display_name
      ),
      existing_public_account AS (
        SELECT public_row.user_id, public_row.public_account_id
        FROM worklog_user_public_accounts AS public_row
        INNER JOIN updated_account ON updated_account.id = public_row.user_id
      ),
      inserted_public_account AS (
        INSERT INTO worklog_user_public_accounts (
          user_id,
          public_account_id,
          created_at
        )
        SELECT
          updated_account.id,
          ${input.publicAccountId},
          ${input.at}
        FROM updated_account
        WHERE NOT EXISTS (SELECT 1 FROM existing_public_account)
        RETURNING user_id, public_account_id
      ),
      ensured_public_account AS (
        SELECT user_id, public_account_id FROM existing_public_account
        UNION ALL
        SELECT user_id, public_account_id FROM inserted_public_account
      ),
      ensured_identity AS (
        INSERT INTO worklog_auth_identities (
          user_id,
          provider,
          subject,
          email_snapshot,
          display_name_snapshot,
          created_at,
          updated_at
        )
        SELECT
          updated_account.id,
          ${provider}::worklog_auth_provider,
          ${subject},
          ${emailSnapshot},
          ${displayNameSnapshot},
          ${input.at},
          ${input.at}
        FROM updated_account
        INNER JOIN ensured_public_account
          ON ensured_public_account.user_id = updated_account.id
        ON CONFLICT (provider, subject) DO UPDATE
        SET
          email_snapshot = COALESCE(EXCLUDED.email_snapshot, worklog_auth_identities.email_snapshot),
          display_name_snapshot = COALESCE(
            EXCLUDED.display_name_snapshot,
            worklog_auth_identities.display_name_snapshot
          ),
          updated_at = GREATEST(worklog_auth_identities.updated_at, EXCLUDED.updated_at)
        WHERE worklog_auth_identities.user_id = EXCLUDED.user_id
        RETURNING user_id
      )
      SELECT
        updated_account.id::text AS id,
        updated_account.display_name,
        ensured_public_account.public_account_id
      FROM updated_account
      INNER JOIN ensured_public_account
        ON ensured_public_account.user_id = updated_account.id
      INNER JOIN ensured_identity
        ON ensured_identity.user_id = updated_account.id
      LIMIT 1
    `);

    const row = result.rows[0] as AccountProfileRow | undefined;
    if (!row) throw new Error('ACCOUNT_IDENTITY_PROVISION_FAILED');
    return mapAccountProfile(row);
  }

  async profile(userId: number): Promise<AccountProfile | null> {
    const result = await this.db.execute(sql`
      SELECT
        account_row.id::text AS id,
        account_row.display_name,
        public_row.public_account_id
      FROM worklog_users AS account_row
      INNER JOIN worklog_user_public_accounts AS public_row
        ON public_row.user_id = account_row.id
      WHERE account_row.id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as AccountProfileRow | undefined;
    return row ? mapAccountProfile(row) : null;
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function mapAccountProfile(row: AccountProfileRow): AccountProfile {
  const userId = Number(row.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID_ACCOUNT_USER_ID');
  return {
    userId,
    displayName: row.display_name,
    publicAccountId: row.public_account_id,
  };
}
