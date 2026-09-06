import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  NativeGroupCreateResult,
  NativeGroupInviteCreateResult,
  NativeGroupInviteRevokeResult,
  NativeGroupInviteSummary,
  NativeGroupJoinResult,
  NativeGroupRepository,
  NativeGroupRole,
  NativeGroupSummary,
} from './native-groups';

type GroupRow = {
  source_id: string;
  name: string;
  role: NativeGroupRole;
};

type InviteRow = {
  id: string;
  source_id: string;
  expires_at: Date | string | null;
  max_uses: number | null;
  use_count: number;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

type JoinRow = GroupRow & {
  join_status: 'JOINED' | 'ALREADY_MEMBER';
};

/** Persistence for AFTERTRACE-native groups. Legacy LINE group rows are never mutated here. */
export class DrizzleNativeGroupRepository implements NativeGroupRepository {
  constructor(private readonly db: Database) {}

  async createGroup(input: {
    creatorUserId: number;
    name: string;
  }): Promise<NativeGroupCreateResult> {
    const result = await this.db.execute(sql`
      WITH creator_workspace AS MATERIALIZED (
        SELECT workspace.id
        FROM worklog_workspaces AS workspace
        WHERE workspace.owner_user_id = ${input.creatorUserId}
        LIMIT 1
      ), inserted_source AS (
        INSERT INTO worklog_sources (
          workspace_id, type, status, private_user_id, name,
          created_by_user_id, line_group_id, created_at, updated_at
        )
        SELECT creator_workspace.id, 'GROUP', 'ACTIVE', NULL, ${input.name},
               ${input.creatorUserId}, NULL, NOW(), NOW()
        FROM creator_workspace
        RETURNING id, name
      ), inserted_member AS (
        INSERT INTO worklog_source_members (
          source_id, user_id, role, is_active,
          first_seen_at, last_seen_at, created_at, updated_at
        )
        SELECT inserted_source.id, ${input.creatorUserId}, 'OWNER', TRUE,
               NOW(), NOW(), NOW(), NOW()
        FROM inserted_source
        ON CONFLICT (source_id, user_id) DO UPDATE
        SET role = 'OWNER',
            is_active = TRUE,
            last_seen_at = NOW(),
            updated_at = NOW()
        RETURNING source_id, role
      )
      SELECT inserted_source.id::text AS source_id,
             inserted_source.name,
             inserted_member.role
      FROM inserted_source
      INNER JOIN inserted_member ON inserted_member.source_id = inserted_source.id
      LIMIT 1
    `);
    const row = result.rows[0] as GroupRow | undefined;
    return row
      ? { status: 'CREATED', group: groupSummary(row) }
      : { status: 'USER_NOT_READY' };
  }

  async createInvite(input: {
    sourceId: number;
    actorUserId: number;
    tokenHash: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }): Promise<NativeGroupInviteCreateResult> {
    const inserted = await this.db.execute(sql`
      WITH owner_access AS MATERIALIZED (
        SELECT source.id
        FROM worklog_sources AS source
        INNER JOIN worklog_source_members AS member
          ON member.source_id = source.id
         AND member.user_id = ${input.actorUserId}
        WHERE source.id = ${input.sourceId}
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
          AND source.line_group_id IS NULL
          AND source.name IS NOT NULL
          AND length(btrim(source.name)) > 0
          AND member.is_active = TRUE
          AND member.role = 'OWNER'
        LIMIT 1
      )
      INSERT INTO worklog_source_invites (
        source_id, token_hash, created_by_user_id,
        expires_at, revoked_at, max_uses, use_count,
        created_at, updated_at
      )
      SELECT owner_access.id, ${input.tokenHash}, ${input.actorUserId},
             ${input.expiresAt}, NULL, ${input.maxUses}, 0,
             NOW(), NOW()
      FROM owner_access
      ON CONFLICT (token_hash) DO NOTHING
      RETURNING id::text AS id,
                source_id::text AS source_id,
                expires_at, max_uses, use_count, revoked_at, created_at
    `);
    const row = inserted.rows[0] as InviteRow | undefined;
    if (row) return { status: 'CREATED', invite: inviteSummary(row) };

    const access = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM worklog_sources AS source
        INNER JOIN worklog_source_members AS member
          ON member.source_id = source.id
         AND member.user_id = ${input.actorUserId}
        WHERE source.id = ${input.sourceId}
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
          AND source.line_group_id IS NULL
          AND source.name IS NOT NULL
          AND length(btrim(source.name)) > 0
          AND member.is_active = TRUE
          AND member.role = 'OWNER'
      ) AS allowed
    `);
    const allowed = Boolean((access.rows[0] as { allowed?: boolean } | undefined)?.allowed);
    return allowed ? { status: 'TOKEN_CONFLICT' } : { status: 'FORBIDDEN_OR_UNAVAILABLE' };
  }

  async revokeInvite(input: {
    sourceId: number;
    inviteId: number;
    actorUserId: number;
  }): Promise<NativeGroupInviteRevokeResult> {
    const result = await this.db.execute(sql`
      UPDATE worklog_source_invites AS invite
      SET revoked_at = COALESCE(invite.revoked_at, NOW()),
          updated_at = NOW()
      WHERE invite.id = ${input.inviteId}
        AND invite.source_id = ${input.sourceId}
        AND EXISTS (
          SELECT 1
          FROM worklog_sources AS source
          INNER JOIN worklog_source_members AS member
            ON member.source_id = source.id
           AND member.user_id = ${input.actorUserId}
          WHERE source.id = invite.source_id
            AND source.type = 'GROUP'
            AND source.status = 'ACTIVE'
            AND source.line_group_id IS NULL
            AND source.name IS NOT NULL
            AND length(btrim(source.name)) > 0
            AND member.is_active = TRUE
            AND member.role = 'OWNER'
        )
      RETURNING invite.id::text AS id
    `);
    const row = result.rows[0] as { id?: string } | undefined;
    return row?.id
      ? { status: 'REVOKED', inviteId: Number(row.id) }
      : { status: 'FORBIDDEN_OR_NOT_FOUND' };
  }

  async joinWithInvite(input: {
    actorUserId: number;
    tokenHash: string;
  }): Promise<NativeGroupJoinResult> {
    const result = await this.db.execute(sql`
      WITH invite_row AS MATERIALIZED (
        SELECT invite.id,
               invite.source_id,
               invite.expires_at,
               invite.revoked_at,
               invite.max_uses,
               invite.use_count
        FROM worklog_source_invites AS invite
        WHERE invite.token_hash = ${input.tokenHash}
        LIMIT 1
        FOR UPDATE
      ), active_member_before AS MATERIALIZED (
        SELECT member.source_id, member.role
        FROM worklog_source_members AS member
        INNER JOIN invite_row ON invite_row.source_id = member.source_id
        INNER JOIN worklog_sources AS source ON source.id = member.source_id
        WHERE member.user_id = ${input.actorUserId}
          AND member.is_active = TRUE
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
          AND source.line_group_id IS NULL
          AND source.name IS NOT NULL
          AND length(btrim(source.name)) > 0
        LIMIT 1
      ), eligible_invite AS MATERIALIZED (
        SELECT invite_row.id, invite_row.source_id
        FROM invite_row
        INNER JOIN worklog_sources AS source ON source.id = invite_row.source_id
        WHERE invite_row.revoked_at IS NULL
          AND (invite_row.expires_at IS NULL OR invite_row.expires_at > NOW())
          AND (invite_row.max_uses IS NULL OR invite_row.use_count < invite_row.max_uses)
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
          AND source.line_group_id IS NULL
          AND source.name IS NOT NULL
          AND length(btrim(source.name)) > 0
      ), membership_upsert AS (
        INSERT INTO worklog_source_members (
          source_id, user_id, role, is_active,
          first_seen_at, last_seen_at, created_at, updated_at
        )
        SELECT eligible_invite.source_id, ${input.actorUserId}, 'MEMBER', TRUE,
               NOW(), NOW(), NOW(), NOW()
        FROM eligible_invite
        WHERE NOT EXISTS (SELECT 1 FROM active_member_before)
        ON CONFLICT (source_id, user_id) DO UPDATE
        SET role = CASE
              WHEN worklog_source_members.role = 'OWNER' THEN 'OWNER'::worklog_source_member_role
              ELSE 'MEMBER'::worklog_source_member_role
            END,
            is_active = TRUE,
            last_seen_at = NOW(),
            updated_at = NOW()
        RETURNING source_id, role
      ), consumed_invite AS (
        UPDATE worklog_source_invites AS invite
        SET use_count = invite.use_count + 1,
            updated_at = NOW()
        FROM eligible_invite
        INNER JOIN membership_upsert ON membership_upsert.source_id = eligible_invite.source_id
        WHERE invite.id = eligible_invite.id
        RETURNING invite.id
      )
      SELECT membership_upsert.source_id::text AS source_id,
             source.name,
             membership_upsert.role,
             'JOINED'::text AS join_status
      FROM membership_upsert
      INNER JOIN worklog_sources AS source ON source.id = membership_upsert.source_id
      WHERE EXISTS (SELECT 1 FROM consumed_invite)
      UNION ALL
      SELECT active_member_before.source_id::text AS source_id,
             source.name,
             active_member_before.role,
             'ALREADY_MEMBER'::text AS join_status
      FROM active_member_before
      INNER JOIN worklog_sources AS source ON source.id = active_member_before.source_id
      LIMIT 1
    `);
    const row = result.rows[0] as JoinRow | undefined;
    return row
      ? { status: row.join_status, group: groupSummary(row) }
      : { status: 'INVALID_INVITE' };
  }
}

function groupSummary(row: GroupRow): NativeGroupSummary {
  return {
    sourceId: Number(row.source_id),
    name: row.name,
    role: row.role,
  };
}

function inviteSummary(row: InviteRow): NativeGroupInviteSummary {
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    maxUses: row.max_uses === null ? null : Number(row.max_uses),
    useCount: Number(row.use_count),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
