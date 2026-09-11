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

type ProvisionedUserRow = {
  user_id: string;
};

/** Provider-neutral account provisioning keyed only by provider + subject. */
export class DrizzleAccountIdentityRepository implements AccountIdentityRepository {
  constructor(private readonly db: Database) {}

  async provision(
    input: ProvisionAccountIdentityInput & { publicAccountId: string; at: Date },
  ): Promise<AccountProfile> {
    const provider = input.provider;
    const subject = input.subject.trim();
    const emailSnapshot = normalizeOptional(input.emailSnapshot);
    const displayNameSnapshot = normalizeOptional(input.displayNameSnapshot);
    if (!subject) throw new Error('AUTH_PROVIDER_SUBJECT_REQUIRED');

    // Keep identity/public-account creation in one atomic statement, but do not try to
    // UPDATE a user inserted by a sibling data-modifying CTE in the same statement.
    // PostgreSQL sibling DML shares one snapshot, so that UPDATE cannot see a newly
    // inserted worklog_users row. Resolve the durable user id first, then update/read
    // the account in subsequent statements after the first statement has completed.
    const provisioned = await this.db.execute(sql`
      WITH existing_identity AS (
        SELECT identity_row.user_id
        FROM worklog_auth_identities AS identity_row
        WHERE identity_row.provider = ${provider}::worklog_auth_provider
          AND identity_row.subject = ${subject}
        LIMIT 1
      ),
      created_account AS (
        INSERT INTO worklog_users (
          display_name, created_at, updated_at
        )
        SELECT ${displayNameSnapshot}, ${input.at}, ${input.at}
        WHERE NOT EXISTS (SELECT 1 FROM existing_identity)
        RETURNING id AS user_id
      ),
      candidate_account AS (
        SELECT user_id FROM existing_identity
        UNION ALL
        SELECT user_id FROM created_account
        LIMIT 1
      ),
      ensured_identity AS (
        INSERT INTO worklog_auth_identities (
          user_id, provider, subject, email_snapshot, display_name_snapshot, created_at, updated_at
        )
        SELECT candidate_account.user_id,
               ${provider}::worklog_auth_provider,
               ${subject}, ${emailSnapshot}, ${displayNameSnapshot}, ${input.at}, ${input.at}
        FROM candidate_account
        ON CONFLICT (provider, subject) DO UPDATE
        SET email_snapshot = COALESCE(EXCLUDED.email_snapshot, worklog_auth_identities.email_snapshot),
            display_name_snapshot = COALESCE(EXCLUDED.display_name_snapshot, worklog_auth_identities.display_name_snapshot),
            updated_at = GREATEST(worklog_auth_identities.updated_at, EXCLUDED.updated_at)
        RETURNING user_id
      ),
      removed_losing_account AS (
        DELETE FROM worklog_users AS losing_account
        USING created_account, ensured_identity
        WHERE losing_account.id = created_account.user_id
          AND losing_account.id <> ensured_identity.user_id
        RETURNING losing_account.id
      ),
      ensured_public_account AS (
        INSERT INTO worklog_user_public_accounts (user_id, public_account_id, created_at)
        SELECT ensured_identity.user_id, ${input.publicAccountId}, ${input.at}
        FROM ensured_identity
        ON CONFLICT (user_id) DO UPDATE
        SET public_account_id = worklog_user_public_accounts.public_account_id
        RETURNING user_id
      )
      SELECT ensured_public_account.user_id::text AS user_id
      FROM ensured_public_account
      LIMIT 1
    `);

    const provisionedRow = provisioned.rows[0] as ProvisionedUserRow | undefined;
    const userId = positiveUserId(provisionedRow?.user_id);
    if (!userId) throw new Error('ACCOUNT_IDENTITY_PROVISION_FAILED');

    await this.db.execute(sql`
      UPDATE worklog_users
      SET display_name = COALESCE(${displayNameSnapshot}, display_name),
          updated_at = GREATEST(updated_at, ${input.at})
      WHERE id = ${userId}
    `);

    const profile = await this.profile(userId);
    if (!profile) throw new Error('ACCOUNT_IDENTITY_PROVISION_FAILED');
    return profile;
  }

  async profile(userId: number): Promise<AccountProfile | null> {
    const result = await this.db.execute(sql`
      SELECT account_row.id::text AS id,
             account_row.display_name,
             public_row.public_account_id
      FROM worklog_users AS account_row
      INNER JOIN worklog_user_public_accounts AS public_row ON public_row.user_id = account_row.id
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

function positiveUserId(value: unknown): number | null {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function mapAccountProfile(row: AccountProfileRow): AccountProfile {
  const userId = positiveUserId(row.id);
  if (!userId) throw new Error('INVALID_ACCOUNT_USER_ID');
  return { userId, displayName: row.display_name, publicAccountId: row.public_account_id };
}
