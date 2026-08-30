import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { GroupEnergyMemberStatus } from '../line/energy-status';
import type { CallerEnergySnapshot, UserEnergyAccessRepository } from './access';

type FetchLike = typeof fetch;
const runtimeFetch: FetchLike = (input, init) => fetch(input, init);

type GroupMemberRow = {
  line_group_id: string;
  line_user_id: string;
  usable: boolean;
};

type LineMemberProfile = {
  displayName?: unknown;
};

export class DrizzleUserEnergyAccessRepository implements UserEnergyAccessRepository {
  private readonly channelAccessToken: string | null;

  constructor(
    private readonly db: Database,
    channelAccessToken?: string,
    private readonly fetcher: FetchLike = runtimeFetch,
  ) {
    const token = channelAccessToken?.trim() ?? '';
    this.channelAccessToken = token || null;
  }

  async findCaller(lineUserId: string, at: Date): Promise<CallerEnergySnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        u.id::text AS user_id,
        COALESCE(SUM(
          CASE
            WHEN l.available_units > 0 AND (l.expires_at IS NULL OR l.expires_at > ${at})
              THEN l.available_units
            ELSE 0
          END
        ), 0)::text AS usable_units
      FROM line_users u
      LEFT JOIN user_energy_lots l ON l.user_id = u.id
      WHERE u.line_user_id = ${lineUserId}
      GROUP BY u.id
      LIMIT 1
    `);
    const row = result.rows[0] as { user_id?: string; usable_units?: string } | undefined;
    if (!row?.user_id) return null;
    return {
      userId: Number(row.user_id),
      usableUnits: BigInt(row.usable_units ?? '0'),
    };
  }

  async listGroupMemberAvailability(
    groupId: number,
    callerLineUserId: string,
    at: Date,
  ): Promise<GroupEnergyMemberStatus[]> {
    const result = await this.db.execute(sql`
      SELECT
        lg.line_group_id,
        gm.line_user_id,
        COALESCE(SUM(
          CASE
            WHEN l.available_units > 0 AND (l.expires_at IS NULL OR l.expires_at > ${at})
              THEN l.available_units
            ELSE 0
          END
        ), 0) > 0 AS usable
      FROM group_members gm
      JOIN line_groups lg ON lg.id = gm.group_id
      LEFT JOIN line_users u ON u.line_user_id = gm.line_user_id
      LEFT JOIN user_energy_lots l ON l.user_id = u.id
      WHERE gm.group_id = ${groupId}
        AND gm.is_active = TRUE
      GROUP BY lg.line_group_id, gm.line_user_id, gm.first_seen_at
      ORDER BY gm.first_seen_at ASC, gm.line_user_id ASC
    `);

    const rows = result.rows as GroupMemberRow[];
    return Promise.all(rows.map(async (row) => ({
      displayName: await this.memberDisplayName(row.line_group_id, row.line_user_id, callerLineUserId),
      usable: Boolean(row.usable),
    })));
  }

  private async memberDisplayName(
    lineGroupId: string,
    lineUserId: string,
    callerLineUserId: string,
  ): Promise<string> {
    if (!this.channelAccessToken) {
      return lineUserId === callerLineUserId ? '你' : 'LINE 使用者';
    }

    try {
      const response = await this.fetcher(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(lineGroupId)}/member/${encodeURIComponent(lineUserId)}`,
        { headers: { Authorization: `Bearer ${this.channelAccessToken}` } },
      );
      if (!response.ok) return lineUserId === callerLineUserId ? '你' : 'LINE 使用者';
      const profile = (await response.json()) as LineMemberProfile;
      return typeof profile.displayName === 'string' && profile.displayName.trim()
        ? profile.displayName.trim().slice(0, 100)
        : lineUserId === callerLineUserId ? '你' : 'LINE 使用者';
    } catch {
      return lineUserId === callerLineUserId ? '你' : 'LINE 使用者';
    }
  }
}
