import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { GroupEnergyMemberStatus } from '../line/energy-status';
import type { CallerEnergySnapshot, UserEnergyAccessRepository } from './access';

export class DrizzleUserEnergyAccessRepository implements UserEnergyAccessRepository {
  constructor(private readonly db: Database) {}

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
        gm.line_user_id,
        COALESCE(SUM(
          CASE
            WHEN l.available_units > 0 AND (l.expires_at IS NULL OR l.expires_at > ${at})
              THEN l.available_units
            ELSE 0
          END
        ), 0) > 0 AS usable
      FROM group_members gm
      LEFT JOIN line_users u ON u.line_user_id = gm.line_user_id
      LEFT JOIN user_energy_lots l ON l.user_id = u.id
      WHERE gm.group_id = ${groupId}
        AND gm.is_active = TRUE
      GROUP BY gm.line_user_id, gm.first_seen_at
      ORDER BY gm.first_seen_at ASC, gm.line_user_id ASC
    `);

    let otherMemberNumber = 0;
    return result.rows.map((raw) => {
      const row = raw as { line_user_id: string; usable: boolean };
      if (row.line_user_id === callerLineUserId) {
        return {
          displayName: '你',
          usable: Boolean(row.usable),
        };
      }
      otherMemberNumber += 1;
      return {
        displayName: `成員 ${otherMemberNumber}`,
        usable: Boolean(row.usable),
      };
    });
  }
}
