import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { pollTargets, sources, venues, watchRules, watchRuleVenues } from '../db/schema';
import { taipeiDate } from './orchestrator';

const WATCHED_PRIORITY = 100;
const DEFAULT_PRIORITY = 0;
const WATCHED_POLL_INTERVAL_SECONDS = 180;
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_POLLING_HORIZON_DAYS = 14;

type DemandWatch = {
  dateFrom: string | null;
  dateTo: string | null;
  daysOfWeek: number[] | null;
};

export function watchIntersectsPollingHorizon(
  watch: DemandWatch,
  today: string,
  horizonEnd: string,
): boolean {
  const start = watch.dateFrom && watch.dateFrom > today ? watch.dateFrom : today;
  const end = watch.dateTo && watch.dateTo < horizonEnd ? watch.dateTo : horizonEnd;
  if (start > end) return false;
  if (!watch.daysOfWeek || watch.daysOfWeek.length === 0) return true;

  const allowedDays = new Set(watch.daysOfWeek);
  for (let cursor = start; cursor <= end; cursor = addIsoDays(cursor, 1)) {
    const day = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (allowedDays.has(day)) return true;
  }
  return false;
}

export type PollingDemandResult = {
  targetsUpdated: number;
  watchedTargets: number;
};

/**
 * Recomputes watch-driven polling demand from the current 14-day fetch
 * horizon. Expired watches and watches that only begin beyond the horizon do
 * not keep provider endpoints hot forever; they automatically become relevant
 * as the cron horizon reaches them.
 *
 * This reconciliation intentionally changes only priority/interval. `next_poll_at`
 * also acts as the in-flight polling lease, so shortening it here could let a
 * second Worker reclaim a target while the first source request is still active.
 */
export class DrizzlePollingDemandReconciler {
  constructor(private readonly database: Database) {}

  async reconcile(now = new Date(), horizonDays = DEFAULT_POLLING_HORIZON_DAYS): Promise<PollingDemandResult> {
    const today = taipeiDate(now);
    const horizonEnd = addIsoDays(today, Math.max(1, Math.min(31, Math.trunc(horizonDays))) - 1);
    const targets = await this.database
      .select({
        id: pollTargets.id,
        venueId: pollTargets.venueId,
        sportId: pollTargets.sportId,
        priority: pollTargets.priority,
        intervalSeconds: pollTargets.intervalSeconds,
        sourceMinPollIntervalSeconds: sources.minPollIntervalSeconds,
        city: venues.city,
        district: venues.district,
      })
      .from(pollTargets)
      .innerJoin(sources, eq(sources.id, pollTargets.sourceId))
      .innerJoin(venues, eq(venues.id, pollTargets.venueId))
      .where(eq(pollTargets.enabled, true));

    const watches = await this.database
      .select({
        id: watchRules.id,
        sportId: watchRules.sportId,
        city: watchRules.city,
        district: watchRules.district,
        dateFrom: watchRules.dateFrom,
        dateTo: watchRules.dateTo,
        daysOfWeek: watchRules.daysOfWeek,
      })
      .from(watchRules)
      .where(eq(watchRules.enabled, true));
    const venueIdsByRule = await this.loadVenueIds(watches.map((watch) => watch.id));
    const relevantWatches = watches.filter((watch) => watchIntersectsPollingHorizon(watch, today, horizonEnd));

    let targetsUpdated = 0;
    let watchedTargets = 0;
    for (const target of targets) {
      const watched = relevantWatches.some((watch) => {
        if (watch.sportId !== target.sportId || watch.city !== target.city) return false;
        if (watch.district && watch.district !== target.district) return false;
        const venueIds = venueIdsByRule.get(watch.id) ?? [];
        return venueIds.length === 0 || venueIds.includes(target.venueId);
      });
      if (watched) watchedTargets += 1;

      const requestedInterval = watched ? WATCHED_POLL_INTERVAL_SECONDS : DEFAULT_POLL_INTERVAL_SECONDS;
      const intervalSeconds = Math.max(target.sourceMinPollIntervalSeconds, requestedInterval);
      const priority = watched ? WATCHED_PRIORITY : DEFAULT_PRIORITY;
      if (target.priority === priority && target.intervalSeconds === intervalSeconds) continue;

      await this.database
        .update(pollTargets)
        .set({
          priority,
          intervalSeconds,
          updatedAt: now,
        })
        .where(and(eq(pollTargets.id, target.id), eq(pollTargets.enabled, true)));
      targetsUpdated += 1;
    }

    return { targetsUpdated, watchedTargets };
  }

  private async loadVenueIds(ruleIds: number[]): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (ruleIds.length === 0) return result;
    const rows = await this.database
      .select({ watchRuleId: watchRuleVenues.watchRuleId, venueId: watchRuleVenues.venueId })
      .from(watchRuleVenues)
      .where(inArray(watchRuleVenues.watchRuleId, ruleIds))
      .orderBy(asc(watchRuleVenues.venueId));
    for (const row of rows) {
      const venueIds = result.get(row.watchRuleId) ?? [];
      venueIds.push(row.venueId);
      result.set(row.watchRuleId, venueIds);
    }
    return result;
  }
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
