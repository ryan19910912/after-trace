import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { AiEntitlementService } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { aiPointReservationCostHoldTwd } from './ai-points';
import { DrizzleAiEntitlementRepository } from './drizzle-ai-entitlement';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';
import type { WorklogTextNormalizationAiPointPort } from './text-normalization';

/**
 * Keeps provider usage operation classification separate while forcing every retained
 * Record-normalization provider request through the shared per-user entitlement gate.
 *
 * The provider-cost hold is derived from the current durable runtime pricing immediately
 * before reservation. AI Pro fails closed through the entitled delegate when a TWD hold
 * cannot be computed; FREE trial ignores the paid-period TWD hold.
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

  async reserveAi(input: Parameters<WorklogTextNormalizationAiPointPort['reserveAi']>[0]) {
    const providerCostHoldTwd = await this.providerCostHoldTwd(input.requestedPoints);
    return this.entitledDelegate.reserveAi({ ...input, providerCostHoldTwd });
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

  private async providerCostHoldTwd(points: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT output_usd_per_million::text AS output_usd_per_million,
             usd_twd_rate::text AS usd_twd_rate
      FROM worklog_ai_runtime_config
      WHERE id = 1
      LIMIT 1
    `);
    const row = result.rows[0] as {
      output_usd_per_million?: unknown;
      usd_twd_rate?: unknown;
    } | undefined;
    if (!row) return null;
    const outputUsdPerMillion = Number(row.output_usd_per_million);
    const usdTwdRate = row.usd_twd_rate === null || row.usd_twd_rate === undefined
      ? null
      : Number(row.usd_twd_rate);
    if (!Number.isFinite(outputUsdPerMillion) || outputUsdPerMillion <= 0) return null;
    return aiPointReservationCostHoldTwd({
      points,
      outputUsdPerMillion,
      usdTwdRate: usdTwdRate !== null && Number.isFinite(usdTwdRate) ? usdTwdRate : null,
    });
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
