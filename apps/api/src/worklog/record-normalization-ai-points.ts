import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { AiEntitlementService } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { DrizzleAiEntitlementRepository } from './drizzle-ai-entitlement';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';
import type { WorklogTextNormalizationAiPointPort } from './text-normalization';

/**
 * Keeps provider usage operation classification separate while forcing every Record
 * normalization provider request through the shared per-user FREE_TRIAL/AI_PRO admission
 * gate before the low-level Grant ledger can reserve points.
 */
export class RecordNormalizationAiPointPort implements WorklogTextNormalizationAiPointPort {
  private readonly entitledDelegate: EntitledAiPointLedgerService;

  constructor(
    private readonly db: Database,
    private readonly delegate: WorklogTextNormalizationAiPointPort,
  ) {
    this.entitledDelegate = new EntitledAiPointLedgerService(
      new AiEntitlementService(new DrizzleAiEntitlementRepository(db)),
      delegate,
    );
  }

  reserveAi(input: Parameters<WorklogTextNormalizationAiPointPort['reserveAi']>[0]) {
    return this.entitledDelegate.reserveAi(input);
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
