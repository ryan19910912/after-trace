import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogBootstrapRepository,
  WorklogBootstrapUser,
  WorklogBoundGroup,
  WorklogPendingGroup,
} from './bootstrap';

type UserRow = {
  id: string;
  line_user_id: string;
  is_oa_friend: boolean;
};

type BoundGroupRow = {
  id: string;
  line_group_id: string;
  workspace_id: string;
  owner_user_id: string | null;
  status: 'ACTIVE' | 'INACTIVE';
};

type PendingGroupRow = {
  id: string;
  line_group_id: string;
  is_active: boolean;
  promoted_source_id: string | null;
};

export class DrizzleWorklogBootstrapRepository implements WorklogBootstrapRepository {
  constructor(private readonly db: Database) {}

  async upsertLineUser(input: {
    lineUserId: string;
    displayName: string | null;
    at: Date;
  }): Promise<WorklogBootstrapUser> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_users (
        line_user_id,
        display_name,
        last_interaction_at,
        created_at,
        updated_at
      )
      VALUES (
        ${input.lineUserId},
        ${input.displayName},
        ${input.at},
        ${input.at},
        ${input.at}
      )
      ON CONFLICT (line_user_id) DO UPDATE
      SET
        display_name = COALESCE(EXCLUDED.display_name, worklog_users.display_name),
        last_interaction_at = CASE
          WHEN worklog_users.last_interaction_at IS NULL THEN EXCLUDED.last_interaction_at
          ELSE GREATEST(worklog_users.last_interaction_at, EXCLUDED.last_interaction_at)
        END,
        updated_at = GREATEST(worklog_users.updated_at, EXCLUDED.updated_at)
      RETURNING id::text, line_user_id, is_oa_friend
    `);
    const row = result.rows[0] as UserRow | undefined;
    if (!row) throw new Error('failed to upsert worklog LINE user');
    return {
      userId: Number(row.id),
      lineUserId: row.line_user_id,
      isOaFriend: row.is_oa_friend,
    };
  }

  async setOaFriendState(userId: number, isOaFriend: boolean, at: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_users
      SET
        is_oa_friend = CASE
          WHEN oa_friend_state_at IS NULL OR ${at} >= oa_friend_state_at THEN ${isOaFriend}
          ELSE is_oa_friend
        END,
        oa_friend_state_at = CASE
          WHEN oa_friend_state_at IS NULL OR ${at} >= oa_friend_state_at THEN ${at}
          ELSE oa_friend_state_at
        END,
        first_oa_added_at = CASE
          WHEN ${isOaFriend} THEN
            CASE
              WHEN first_oa_added_at IS NULL THEN ${at}
              ELSE LEAST(first_oa_added_at, ${at})
            END
          ELSE first_oa_added_at
        END,
        last_interaction_at = CASE
          WHEN last_interaction_at IS NULL THEN ${at}
          ELSE GREATEST(last_interaction_at, ${at})
        END,
        updated_at = GREATEST(updated_at, ${at})
      WHERE id = ${userId}
    `);
  }

  async ensureWorkspace(ownerUserId: number, at: Date): Promise<number> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_workspaces (owner_user_id, created_at, updated_at)
      VALUES (${ownerUserId}, ${at}, ${at})
      ON CONFLICT (owner_user_id) DO UPDATE
      SET updated_at = GREATEST(worklog_workspaces.updated_at, EXCLUDED.updated_at)
      RETURNING id::text
    `);
    const id = (result.rows[0] as { id?: string } | undefined)?.id;
    if (!id) throw new Error('failed to ensure worklog workspace');
    return Number(id);
  }

  async ensurePrivateSource(userId: number, workspaceId: number, at: Date): Promise<number> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_sources (
        workspace_id,
        type,
        status,
        private_user_id,
        created_at,
        updated_at
      )
      VALUES (${workspaceId}, 'PRIVATE', 'ACTIVE', ${userId}, ${at}, ${at})
      ON CONFLICT (private_user_id) DO UPDATE
      SET
        workspace_id = EXCLUDED.workspace_id,
        status = 'ACTIVE',
        inactive_at = NULL,
        updated_at = GREATEST(worklog_sources.updated_at, EXCLUDED.updated_at)
      RETURNING id::text
    `);
    const id = (result.rows[0] as { id?: string } | undefined)?.id;
    if (!id) throw new Error('failed to ensure worklog private source');
    return Number(id);
  }

  async findBoundGroupByLineId(lineGroupId: string): Promise<WorklogBoundGroup | null> {
    const result = await this.db.execute(sql`
      SELECT
        id::text,
        line_group_id,
        workspace_id::text,
        owner_user_id::text,
        status
      FROM worklog_sources
      WHERE type = 'GROUP'
        AND line_group_id = ${lineGroupId}
      LIMIT 1
    `);
    const row = result.rows[0] as BoundGroupRow | undefined;
    return row ? mapBoundGroup(row) : null;
  }

  async reactivateBoundGroup(sourceId: number, at: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_sources
      SET status = 'ACTIVE', inactive_at = NULL, updated_at = ${at}
      WHERE id = ${sourceId}
        AND type = 'GROUP'
        AND updated_at <= ${at}
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async upsertPendingGroup(lineGroupId: string, at: Date): Promise<WorklogPendingGroup> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_pending_groups (
        line_group_id,
        is_active,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (${lineGroupId}, TRUE, ${at}, ${at}, ${at}, ${at})
      ON CONFLICT (line_group_id) DO UPDATE
      SET
        is_active = CASE
          WHEN EXCLUDED.last_seen_at >= worklog_pending_groups.last_seen_at THEN TRUE
          ELSE worklog_pending_groups.is_active
        END,
        last_seen_at = GREATEST(worklog_pending_groups.last_seen_at, EXCLUDED.last_seen_at),
        inactive_at = CASE
          WHEN EXCLUDED.last_seen_at >= worklog_pending_groups.last_seen_at THEN NULL
          ELSE worklog_pending_groups.inactive_at
        END,
        updated_at = GREATEST(worklog_pending_groups.updated_at, EXCLUDED.updated_at)
      RETURNING id::text, line_group_id, is_active, promoted_source_id::text
    `);
    const row = result.rows[0] as PendingGroupRow | undefined;
    if (!row) throw new Error('failed to ensure pending LINE group');
    return {
      pendingGroupId: Number(row.id),
      lineGroupId: row.line_group_id,
      isActive: row.is_active,
      promotedSourceId: nullableNumber(row.promoted_source_id),
    };
  }

  async upsertPendingGroupMember(
    pendingGroupId: number,
    userId: number,
    isActive: boolean,
    at: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_pending_group_members (
        pending_group_id,
        user_id,
        is_active,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (${pendingGroupId}, ${userId}, ${isActive}, ${at}, ${at}, ${at}, ${at})
      ON CONFLICT (pending_group_id, user_id) DO UPDATE
      SET
        is_active = CASE
          WHEN EXCLUDED.last_seen_at >= worklog_pending_group_members.last_seen_at THEN EXCLUDED.is_active
          ELSE worklog_pending_group_members.is_active
        END,
        last_seen_at = GREATEST(worklog_pending_group_members.last_seen_at, EXCLUDED.last_seen_at),
        updated_at = GREATEST(worklog_pending_group_members.updated_at, EXCLUDED.updated_at)
    `);
  }

  async upsertBoundGroupMember(
    sourceId: number,
    userId: number,
    isActive: boolean,
    at: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_source_members (
        source_id,
        user_id,
        is_active,
        recording_enabled,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (${sourceId}, ${userId}, ${isActive}, TRUE, ${at}, ${at}, ${at}, ${at})
      ON CONFLICT (source_id, user_id) DO UPDATE
      SET
        is_active = CASE
          WHEN EXCLUDED.last_seen_at >= worklog_source_members.last_seen_at THEN EXCLUDED.is_active
          ELSE worklog_source_members.is_active
        END,
        last_seen_at = GREATEST(worklog_source_members.last_seen_at, EXCLUDED.last_seen_at),
        updated_at = GREATEST(worklog_source_members.updated_at, EXCLUDED.updated_at)
    `);
  }

  async markGroupInactive(lineGroupId: string, at: Date): Promise<void> {
    await this.db.execute(sql`
      WITH deactivated_source AS (
        UPDATE worklog_sources
        SET status = 'INACTIVE', inactive_at = ${at}, updated_at = ${at}
        WHERE type = 'GROUP'
          AND line_group_id = ${lineGroupId}
          AND updated_at <= ${at}
        RETURNING id
      ),
      deactivated_members AS (
        UPDATE worklog_source_members
        SET is_active = FALSE, last_seen_at = ${at}, updated_at = ${at}
        WHERE source_id IN (SELECT id FROM deactivated_source)
          AND last_seen_at <= ${at}
        RETURNING id
      ),
      deactivated_pending AS (
        UPDATE worklog_pending_groups
        SET is_active = FALSE, inactive_at = ${at}, last_seen_at = ${at}, updated_at = ${at}
        WHERE line_group_id = ${lineGroupId}
          AND last_seen_at <= ${at}
        RETURNING id
      )
      UPDATE worklog_pending_group_members
      SET is_active = FALSE, last_seen_at = ${at}, updated_at = ${at}
      WHERE pending_group_id IN (SELECT id FROM deactivated_pending)
        AND last_seen_at <= ${at}
    `);
  }

  async promoteGroup(input: {
    lineGroupId: string;
    ownerUserId: number;
    workspaceId: number;
    bindingMethod: string;
    at: Date;
  }): Promise<WorklogBoundGroup | null> {
    const result = await this.db.execute(sql`
      WITH candidate AS (
        INSERT INTO worklog_sources (
          workspace_id,
          type,
          status,
          line_group_id,
          owner_user_id,
          owner_binding_method,
          owner_bound_at,
          subscription_owner_user_id,
          created_at,
          updated_at
        )
        VALUES (
          ${input.workspaceId},
          'GROUP',
          'ACTIVE',
          ${input.lineGroupId},
          ${input.ownerUserId},
          ${input.bindingMethod},
          ${input.at},
          ${input.ownerUserId},
          ${input.at},
          ${input.at}
        )
        ON CONFLICT (line_group_id) DO NOTHING
        RETURNING id
      ),
      chosen AS (
        SELECT id FROM candidate
        UNION ALL
        SELECT id
        FROM worklog_sources
        WHERE type = 'GROUP'
          AND line_group_id = ${input.lineGroupId}
        LIMIT 1
      ),
      activated AS (
        UPDATE worklog_sources AS source
        SET
          workspace_id = ${input.workspaceId},
          status = CASE WHEN source.updated_at <= ${input.at} THEN 'ACTIVE'::worklog_source_status ELSE source.status END,
          inactive_at = CASE WHEN source.updated_at <= ${input.at} THEN NULL ELSE source.inactive_at END,
          owner_user_id = COALESCE(source.owner_user_id, ${input.ownerUserId}),
          subscription_owner_user_id = COALESCE(source.subscription_owner_user_id, ${input.ownerUserId}),
          owner_binding_method = CASE
            WHEN source.owner_user_id IS NULL THEN ${input.bindingMethod}
            ELSE source.owner_binding_method
          END,
          owner_bound_at = CASE
            WHEN source.owner_user_id IS NULL THEN ${input.at}
            ELSE source.owner_bound_at
          END,
          updated_at = GREATEST(source.updated_at, ${input.at})
        WHERE source.id = (SELECT id FROM chosen)
          AND (source.owner_user_id IS NULL OR source.owner_user_id = ${input.ownerUserId})
        RETURNING source.id, source.line_group_id, source.workspace_id, source.owner_user_id, source.status
      ),
      migrated_members AS (
        INSERT INTO worklog_source_members (
          source_id,
          user_id,
          is_active,
          recording_enabled,
          first_seen_at,
          last_seen_at,
          created_at,
          updated_at
        )
        SELECT
          activated.id,
          pending_member.user_id,
          pending_member.is_active,
          TRUE,
          pending_member.first_seen_at,
          pending_member.last_seen_at,
          ${input.at},
          ${input.at}
        FROM activated
        INNER JOIN worklog_pending_groups AS pending
          ON pending.line_group_id = ${input.lineGroupId}
        INNER JOIN worklog_pending_group_members AS pending_member
          ON pending_member.pending_group_id = pending.id
        ON CONFLICT (source_id, user_id) DO UPDATE
        SET
          is_active = CASE
            WHEN EXCLUDED.last_seen_at >= worklog_source_members.last_seen_at THEN EXCLUDED.is_active
            ELSE worklog_source_members.is_active
          END,
          first_seen_at = LEAST(worklog_source_members.first_seen_at, EXCLUDED.first_seen_at),
          last_seen_at = GREATEST(worklog_source_members.last_seen_at, EXCLUDED.last_seen_at),
          updated_at = GREATEST(worklog_source_members.updated_at, EXCLUDED.updated_at)
        RETURNING id
      ),
      marked_pending AS (
        UPDATE worklog_pending_groups AS pending
        SET
          is_active = FALSE,
          promoted_source_id = activated.id,
          promoted_at = ${input.at},
          updated_at = GREATEST(pending.updated_at, ${input.at})
        FROM activated
        WHERE pending.line_group_id = ${input.lineGroupId}
        RETURNING pending.id
      )
      SELECT
        activated.id::text,
        activated.line_group_id,
        activated.workspace_id::text,
        activated.owner_user_id::text,
        activated.status
      FROM activated
      LIMIT 1
    `);

    const row = result.rows[0] as BoundGroupRow | undefined;
    return row ? mapBoundGroup(row) : null;
  }
}

function mapBoundGroup(row: BoundGroupRow): WorklogBoundGroup {
  return {
    sourceId: Number(row.id),
    lineGroupId: row.line_group_id,
    workspaceId: Number(row.workspace_id),
    ownerUserId: nullableNumber(row.owner_user_id),
    status: row.status,
  };
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
