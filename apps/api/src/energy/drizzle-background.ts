import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { BackgroundParticipant } from './background';

export type BackgroundParticipantSnapshot = BackgroundParticipant & {
  userId: number;
};

export class DrizzleBackgroundEnergyRepository {
  constructor(private readonly db: Database) {}

  async listBatchParticipants(
    groupId: number,
    extractionBatchId: number,
    at: Date,
  ): Promise<BackgroundParticipantSnapshot[]> {
    const result = await this.db.execute(sql`
      WITH speaking AS (
        SELECT
          cm.line_user_id,
          SUM(
            LENGTH(
              REGEXP_REPLACE(
                BTRIM(COALESCE(cm.text_content, '')),
                '\\s+',
                ' ',
                'g'
              )
            )
          )::bigint AS normalized_chars
        FROM conversation_messages cm
        WHERE cm.group_id = ${groupId}
          AND cm.extraction_batch_id = ${extractionBatchId}
          AND cm.message_type = 'text'
          AND cm.line_user_id IS NOT NULL
          AND BTRIM(COALESCE(cm.text_content, '')) <> ''
        GROUP BY cm.line_user_id
      ), balances AS (
        SELECT
          u.id AS user_id,
          u.line_user_id,
          COALESCE(SUM(
            CASE
              WHEN l.available_units > 0
                AND (l.expires_at IS NULL OR l.expires_at > ${at})
              THEN l.available_units
              ELSE 0
            END
          ), 0)::bigint AS usable_units
        FROM line_users u
        LEFT JOIN user_energy_lots l ON l.user_id = u.id
        GROUP BY u.id, u.line_user_id
      )
      SELECT
        b.user_id::text AS user_id,
        s.line_user_id,
        s.normalized_chars::text AS normalized_chars,
        b.usable_units::text AS usable_units
      FROM speaking s
      JOIN balances b ON b.line_user_id = s.line_user_id
      ORDER BY s.line_user_id ASC
    `);

    return result.rows.map((raw) => {
      const row = raw as {
        user_id: string;
        line_user_id: string;
        normalized_chars: string;
        usable_units: string;
      };
      const chars = Number(row.normalized_chars);
      if (!Number.isSafeInteger(chars) || chars < 0) {
        throw new Error('Background normalized character count is outside safe integer range');
      }
      return {
        userId: Number(row.user_id),
        lineUserId: row.line_user_id,
        normalizedCharCount: chars,
        availableEnergyUnits: BigInt(row.usable_units),
      };
    });
  }
}
