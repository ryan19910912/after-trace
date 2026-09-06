import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogLineRecordEditOutput } from './line-record-edit';
import type { WorklogInterpretedEditStagePort } from './interpreted-edit';

export class DrizzleWorklogInterpretedEditStageRepository implements WorklogInterpretedEditStagePort {
  constructor(private readonly db: Database) {}

  async stage(input: {
    editId: number;
    claimToken: string;
    output: WorklogLineRecordEditOutput;
  }): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_line_ai_edits
      SET status = 'USAGE_COMMITTED',
          result_json = ${JSON.stringify(input.output)}::jsonb,
          provider_succeeded_at = COALESCE(provider_succeeded_at, NOW()),
          usage_committed_at = COALESCE(usage_committed_at, NOW()),
          last_error_code = NULL,
          last_error_detail = NULL,
          updated_at = NOW()
      WHERE id = ${input.editId}
        AND claim_token = ${input.claimToken}
        AND status = 'PROCESSING'
      RETURNING id
    `);
    if (result.rows.length === 0) throw new Error('interpreted LINE edit could not be staged');
  }
}
