import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogBootstrapRepository,
  WorklogBootstrapUser,
  WorklogBoundGroup,
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
  status: 'ACTIVE' | 'INACTIVE';
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
        status
      FROM worklog_sources
      WHERE type = 'GROUP'
        AND line_group_id = ${lineGroupId}
      LIMIT 1
    `);
    const row = result.rows[0] as BoundGroupRow | undefined;
    return row ? mapBoundGroup(row) : null;
  }

  async ensureGroupSource(lineGroupId: string, workspaceId: number, at: Date): Promise<WorklogBoundGroup> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_sources (
        workspace_id,
        type,
        status,
        line_group_id,
        created_at,
        updated_at
      )
      VALUES (
        ${workspaceId},
        'GROUP',
        'ACTIVE',
        ${lineGroupId},
        ${at},
        ${at}
      )
      ON CONFLICT (line_group_id) DO UPDATE
      SET
        status = CASE
          WHEN worklog_sources.updated_at <= EXCLUDED.updated_at THEN 'ACTIVE'::worklog_source_status
          ELSE worklog_sources.status
        END,
        inactive_at = CASE
          WHEN worklog_sources.updated_at <= EXCLUDED.updated_at THEN NULL
          ELSE worklog_sources.inactive_at
        END,
        updated_at = GREATEST(worklog_sources.updated_at, EXCLUDED.updated_at)
      RETURNING
        id::text,
        line_group_id,
        workspace_id::text,
        status
    `);
    const row = result.rows[0] as BoundGroupRow | undefined;
    if (!row) throw new Error('failed to ensure worklog group source');
    return mapBoundGroup(row);
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
      )
      UPDATE worklog_source_members
      SET is_active = FALSE, last_seen_at = ${at}, updated_at = ${at}
      WHERE source_id IN (SELECT id FROM deactivated_source)
        AND last_seen_at <= ${at}
    `);
  }
}

function mapBoundGroup(row: BoundGroupRow): WorklogBoundGroup {
  return {
    sourceId: Number(row.id),
    lineGroupId: row.line_group_id,
    workspaceId: Number(row.workspace_id),
    status: row.status,
  };
}
