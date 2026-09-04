import type { Database } from '../db/client';
import { sql } from 'drizzle-orm';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import type { WorklogTextNormalizationAiPointPort } from './text-normalization';

/**
 * Keeps the existing Grant-ledger behavior while ensuring the second AI call used to
 * title/date an attachment Record is reported separately from TEXT record creation.
 */
export class RecordNormalizationAiPointPort implements WorklogTextNormalizationAiPointPort {
  constructor(
    private readonly db: Database,
    private readonly delegate: WorklogTextNormalizationAiPointPort,
  ) {}

  reserveAi(input: Parameters<WorklogTextNormalizationAiPointPort['reserveAi']>[0]) {
    return this.delegate.reserveAi(input);
  }

  async commitAiUsage(
    token: string,
    usage: WorklogAiUsageCommit,
    at?: Date,
  ) {
    return this.delegate.commitAiUsage(token, await this.normalizeUsageOperation(usage), at);
  }

  releaseAi(token: string, at?: Date) {
    return this.delegate.releaseAi(token, at);
  }

  private async normalizeUsageOperation(usage: WorklogAiUsageCommit): Promise<WorklogAiUsageCommit> {
    if (!usage.recordId) return usage;
    const result = await this.db.execute(sql`
      SELECT input_type FROM worklog_records WHERE id = ${usage.recordId} LIMIT 1
    `);
    const inputType = (result.rows[0] as { input_type?: unknown } | undefined)?.input_type;
    return inputType === 'AUDIO' || inputType === 'IMAGE' || inputType === 'FILE'
      ? { ...usage, operation: 'RECORD_TITLE_NORMALIZATION' }
      : usage;
  }
}
