import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type AdminProfitabilityPeriod = 'TODAY' | '7D' | '30D' | 'BILLING_MONTH';

export type AdminProfitabilityWindow = {
  period: AdminProfitabilityPeriod;
  from: Date;
  to: Date;
};

export type AdminProfitabilitySummary = {
  period: AdminProfitabilityPeriod;
  from: string;
  to: string;
  requests: number;
  chargedUsers: number;
  customerPointsCharged: number;
  platformSubsidizedPoints: number;
  providerCostUsd: string;
  providerCostTwd: string;
  platformSubsidizedCostUsd: string;
  platformSubsidizedCostTwd: string;
  missingProviderCostTwdRequests: number;
  missingSubsidyCostTwdRequests: number;
  averagePointsPerRequest: number;
  averageProviderCostTwdPerRequest: string;
  averagePointsPerChargedUser: number;
  averageProviderCostTwdPerChargedUser: string;
  revenueTwd: null;
  realizedAiCostRatio: null;
  realizedGrossMargin: null;
  revenueStatus: 'UNAVAILABLE_NO_SUCCESSFUL_PAYMENT_FACT';
};

export type AdminProfitabilityBreakdownRow = {
  key: string;
  requests: number;
  chargedUsers: number;
  customerPointsCharged: number;
  platformSubsidizedPoints: number;
  providerCostUsd: string;
  providerCostTwd: string;
  missingProviderCostTwdRequests: number;
};

export type AdminGrantTypeUsageRow = {
  grantType: string;
  requests: number;
  pointsCharged: number;
};

export type AdminGrantInventoryRow = {
  grantType: string;
  grants: number;
  exhaustedGrants: number;
  originalPoints: number;
  remainingPoints: number;
};

export type AdminProfitabilityReport = {
  summary: AdminProfitabilitySummary;
  byModel: AdminProfitabilityBreakdownRow[];
  byOperation: AdminProfitabilityBreakdownRow[];
  bySourceType: AdminProfitabilityBreakdownRow[];
  byGrantType: AdminGrantTypeUsageRow[];
  grantInventory: AdminGrantInventoryRow[];
};

/**
 * Factual AI economics from immutable provider usage + Grant settlement facts.
 *
 * Revenue and margin intentionally remain null until AFTERTRACE has a durable,
 * successful-payment revenue ledger. Checkout intent status or plan list price is not
 * sufficient evidence of realized revenue and must never be synthesized here.
 *
 * TWD totals expose missing-conversion request counts. A NULL historical TWD cost must
 * never be silently interpreted as a known zero-cost request.
 */
export class DrizzleAdminProfitabilityRepository {
  constructor(private readonly db: Database) {}

  async report(period: AdminProfitabilityPeriod, at = new Date()): Promise<AdminProfitabilityReport> {
    const window = adminProfitabilityWindow(period, at);
    const [summary, byModel, byOperation, bySourceType, byGrantType, grantInventory] = await Promise.all([
      this.summary(window),
      this.breakdown(window, 'MODEL'),
      this.breakdown(window, 'OPERATION'),
      this.breakdown(window, 'SOURCE_TYPE'),
      this.grantTypeUsage(window),
      this.grantInventory(window.to),
    ]);
    return { summary, byModel, byOperation, bySourceType, byGrantType, grantInventory };
  }

  private async summary(window: AdminProfitabilityWindow): Promise<AdminProfitabilitySummary> {
    const result = await this.db.execute(sql`
      SELECT
        COUNT(*)::text AS requests,
        COUNT(DISTINCT charged_user_id)::text AS charged_users,
        COALESCE(SUM(customer_points_charged), 0)::bigint::text AS customer_points_charged,
        COALESCE(SUM(platform_subsidized_points), 0)::bigint::text AS platform_subsidized_points,
        COALESCE(SUM(provider_cost_usd), 0)::text AS provider_cost_usd,
        COALESCE(SUM(provider_cost_twd), 0)::text AS provider_cost_twd,
        COALESCE(SUM(platform_subsidized_cost_usd), 0)::text AS platform_subsidized_cost_usd,
        COALESCE(SUM(platform_subsidized_cost_twd), 0)::text AS platform_subsidized_cost_twd,
        COUNT(*) FILTER (WHERE provider_cost_twd IS NULL)::text AS missing_provider_cost_twd_requests,
        COUNT(*) FILTER (
          WHERE platform_subsidized_points > 0 AND platform_subsidized_cost_twd IS NULL
        )::text AS missing_subsidy_cost_twd_requests
      FROM worklog_ai_usage_events
      WHERE created_at >= ${window.from} AND created_at < ${window.to}
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    const requests = integer(row?.requests);
    const chargedUsers = integer(row?.charged_users);
    const points = integer(row?.customer_points_charged);
    const costTwd = decimal(row?.provider_cost_twd);
    return {
      period: window.period,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      requests,
      chargedUsers,
      customerPointsCharged: points,
      platformSubsidizedPoints: integer(row?.platform_subsidized_points),
      providerCostUsd: decimal(row?.provider_cost_usd),
      providerCostTwd: costTwd,
      platformSubsidizedCostUsd: decimal(row?.platform_subsidized_cost_usd),
      platformSubsidizedCostTwd: decimal(row?.platform_subsidized_cost_twd),
      missingProviderCostTwdRequests: integer(row?.missing_provider_cost_twd_requests),
      missingSubsidyCostTwdRequests: integer(row?.missing_subsidy_cost_twd_requests),
      averagePointsPerRequest: requests > 0 ? points / requests : 0,
      averageProviderCostTwdPerRequest: ratioDecimal(costTwd, requests),
      averagePointsPerChargedUser: chargedUsers > 0 ? points / chargedUsers : 0,
      averageProviderCostTwdPerChargedUser: ratioDecimal(costTwd, chargedUsers),
      revenueTwd: null,
      realizedAiCostRatio: null,
      realizedGrossMargin: null,
      revenueStatus: 'UNAVAILABLE_NO_SUCCESSFUL_PAYMENT_FACT',
    };
  }

  private async breakdown(
    window: AdminProfitabilityWindow,
    dimension: 'MODEL' | 'OPERATION' | 'SOURCE_TYPE',
  ): Promise<AdminProfitabilityBreakdownRow[]> {
    const key = dimension === 'MODEL'
      ? sql`usage.model`
      : dimension === 'OPERATION'
        ? sql`usage.operation`
        : sql`COALESCE(source.type::text, 'UNKNOWN')`;
    const result = await this.db.execute(sql`
      SELECT
        ${key} AS key,
        COUNT(*)::text AS requests,
        COUNT(DISTINCT usage.charged_user_id)::text AS charged_users,
        COALESCE(SUM(usage.customer_points_charged), 0)::bigint::text AS customer_points_charged,
        COALESCE(SUM(usage.platform_subsidized_points), 0)::bigint::text AS platform_subsidized_points,
        COALESCE(SUM(usage.provider_cost_usd), 0)::text AS provider_cost_usd,
        COALESCE(SUM(usage.provider_cost_twd), 0)::text AS provider_cost_twd,
        COUNT(*) FILTER (WHERE usage.provider_cost_twd IS NULL)::text AS missing_provider_cost_twd_requests
      FROM worklog_ai_usage_events usage
      LEFT JOIN worklog_sources source ON source.id = usage.source_id
      WHERE usage.created_at >= ${window.from} AND usage.created_at < ${window.to}
      GROUP BY ${key}
      ORDER BY SUM(usage.provider_cost_usd) DESC, ${key} ASC
    `);
    return result.rows.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        key: text(row.key, 'UNKNOWN'),
        requests: integer(row.requests),
        chargedUsers: integer(row.charged_users),
        customerPointsCharged: integer(row.customer_points_charged),
        platformSubsidizedPoints: integer(row.platform_subsidized_points),
        providerCostUsd: decimal(row.provider_cost_usd),
        providerCostTwd: decimal(row.provider_cost_twd),
        missingProviderCostTwdRequests: integer(row.missing_provider_cost_twd_requests),
      };
    });
  }

  private async grantTypeUsage(window: AdminProfitabilityWindow): Promise<AdminGrantTypeUsageRow[]> {
    const result = await this.db.execute(sql`
      SELECT
        grant.type::text AS grant_type,
        COUNT(DISTINCT funding.usage_event_id)::text AS requests,
        COALESCE(SUM(funding.points_charged), 0)::bigint::text AS points_charged
      FROM worklog_ai_usage_funding funding
      INNER JOIN worklog_ai_usage_events usage ON usage.id = funding.usage_event_id
      INNER JOIN worklog_ai_grants grant ON grant.id = funding.grant_id
      WHERE usage.created_at >= ${window.from} AND usage.created_at < ${window.to}
      GROUP BY grant.type
      ORDER BY SUM(funding.points_charged) DESC, grant.type ASC
    `);
    return result.rows.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        grantType: text(row.grant_type, 'UNKNOWN'),
        requests: integer(row.requests),
        pointsCharged: integer(row.points_charged),
      };
    });
  }

  private async grantInventory(at: Date): Promise<AdminGrantInventoryRow[]> {
    const result = await this.db.execute(sql`
      SELECT
        type::text AS grant_type,
        COUNT(*)::text AS grants,
        COUNT(*) FILTER (WHERE status = 'EXHAUSTED' OR remaining_points = 0)::text AS exhausted_grants,
        COALESCE(SUM(original_points), 0)::bigint::text AS original_points,
        COALESCE(SUM(remaining_points), 0)::bigint::text AS remaining_points
      FROM worklog_ai_grants
      WHERE effective_at < ${at} AND status <> 'REVOKED'
      GROUP BY type
      ORDER BY type ASC
    `);
    return result.rows.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        grantType: text(row.grant_type, 'UNKNOWN'),
        grants: integer(row.grants),
        exhaustedGrants: integer(row.exhausted_grants),
        originalPoints: integer(row.original_points),
        remainingPoints: integer(row.remaining_points),
      };
    });
  }
}

export function adminProfitabilityWindow(
  period: AdminProfitabilityPeriod,
  at = new Date(),
): AdminProfitabilityWindow {
  const now = validDate(at);
  if (period === 'TODAY') {
    return { period, from: taipeiDayStart(now), to: new Date(now.getTime() + 1) };
  }
  if (period === '7D') {
    return { period, from: new Date(now.getTime() - 7 * DAY_MS), to: new Date(now.getTime() + 1) };
  }
  if (period === '30D') {
    return { period, from: new Date(now.getTime() - 30 * DAY_MS), to: new Date(now.getTime() + 1) };
  }
  if (period === 'BILLING_MONTH') {
    return { period, from: taipeiMonthStart(now), to: new Date(now.getTime() + 1) };
  }
  return assertNever(period);
}

export function parseAdminProfitabilityPeriod(value: string | null | undefined): AdminProfitabilityPeriod | null {
  const normalized = value?.trim().toUpperCase() ?? 'TODAY';
  return normalized === 'TODAY' || normalized === '7D' || normalized === '30D' || normalized === 'BILLING_MONTH'
    ? normalized
    : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + TAIPEI_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TAIPEI_OFFSET_MS);
}

function taipeiMonthStart(at: Date): Date {
  const shifted = new Date(at.getTime() + TAIPEI_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TAIPEI_OFFSET_MS);
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('invalid profitability reference date');
  return new Date(value.getTime());
}

function integer(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function decimal(value: unknown): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : '0';
}

function ratioDecimal(total: string, denominator: number): string {
  if (denominator <= 0) return '0';
  const value = Number(total);
  return Number.isFinite(value) ? String(value / denominator) : '0';
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function assertNever(value: never): never {
  throw new Error(`unsupported profitability period: ${String(value)}`);
}
