import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { EligibleMemorySubject, EligibleMemorySubjectRepository } from './eligible-subjects';

export class DrizzleEligibleMemorySubjectRepository implements EligibleMemorySubjectRepository {
  constructor(private readonly db: Database) {}

  async listForRequest(requestId: number): Promise<EligibleMemorySubject[]> {
    const result = await this.db.execute(sql`
      SELECT
        user_id::text AS user_id,
        line_user_id,
        normalized_char_count,
        preflight_available_units::text AS preflight_available_units
      FROM automatic_memory_eligible_subjects
      WHERE request_id = ${requestId}
      ORDER BY id
    `);
    return result.rows.map((raw) => {
      const row = raw as {
        user_id: string;
        line_user_id: string;
        normalized_char_count: number;
        preflight_available_units: string;
      };
      return {
        userId: Number(row.user_id),
        lineUserId: row.line_user_id,
        normalizedCharCount: Number(row.normalized_char_count),
        preflightAvailableUnits: BigInt(row.preflight_available_units),
      };
    });
  }
}
