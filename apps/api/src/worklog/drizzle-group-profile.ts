import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogCachedGroupProfile, WorklogGroupProfileRepository } from './group-profile';

type GroupProfileRow = {
  source_id: string;
  line_group_id: string;
  group_name: string | null;
  picture_url: string | null;
  synced_at: Date | string | null;
};

export class DrizzleWorklogGroupProfileRepository implements WorklogGroupProfileRepository {
  constructor(private readonly db: Database) {}

  async findByLineGroupId(lineGroupId: string): Promise<WorklogCachedGroupProfile | null> {
    const result = await this.db.execute(sql`
      SELECT
        source.id::text AS source_id,
        source.line_group_id,
        profile.group_name,
        profile.picture_url,
        profile.synced_at
      FROM worklog_sources AS source
      LEFT JOIN worklog_source_line_profiles AS profile ON profile.source_id = source.id
      WHERE source.type = 'GROUP'
        AND source.line_group_id = ${lineGroupId}
      LIMIT 1
    `);
    const row = result.rows[0] as GroupProfileRow | undefined;
    if (!row) return null;
    return {
      sourceId: Number(row.source_id),
      lineGroupId: row.line_group_id,
      groupName: row.group_name,
      pictureUrl: row.picture_url,
      syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    };
  }

  async save(input: {
    sourceId: number;
    groupName: string;
    pictureUrl: string | null;
    syncedAt: Date;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_source_line_profiles (
        source_id,
        group_name,
        picture_url,
        synced_at,
        created_at,
        updated_at
      ) VALUES (
        ${input.sourceId},
        ${input.groupName},
        ${input.pictureUrl},
        ${input.syncedAt},
        ${input.syncedAt},
        ${input.syncedAt}
      )
      ON CONFLICT (source_id) DO UPDATE
      SET
        group_name = CASE
          WHEN EXCLUDED.synced_at >= worklog_source_line_profiles.synced_at THEN EXCLUDED.group_name
          ELSE worklog_source_line_profiles.group_name
        END,
        picture_url = CASE
          WHEN EXCLUDED.synced_at >= worklog_source_line_profiles.synced_at THEN EXCLUDED.picture_url
          ELSE worklog_source_line_profiles.picture_url
        END,
        synced_at = GREATEST(worklog_source_line_profiles.synced_at, EXCLUDED.synced_at),
        updated_at = GREATEST(worklog_source_line_profiles.updated_at, EXCLUDED.updated_at)
    `);
  }
}
