import { sql, type SQL } from 'drizzle-orm';
import { pollTargets } from '../db/schema';

export const MIN_AVAILABILITY_FRESHNESS_SECONDS = 15 * 60;
export const AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER = 3;

export function availabilityFreshnessSeconds(intervalSeconds: number): number {
  const normalizedInterval = Number.isFinite(intervalSeconds) && intervalSeconds > 0
    ? Math.trunc(intervalSeconds)
    : MIN_AVAILABILITY_FRESHNESS_SECONDS;
  return Math.max(
    MIN_AVAILABILITY_FRESHNESS_SECONDS,
    normalizedInterval * AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER,
  );
}

/**
 * Current availability must be backed by a reasonably recent successful full
 * poll of the exact source/venue/sport target. We tolerate at least 15 minutes
 * and otherwise three configured poll intervals, so transient provider errors
 * do not instantly blank the product while prolonged outages fail closed.
 */
export function pollTargetFreshAt(now: Date): SQL {
  return sql`(
    ${pollTargets.enabled} = TRUE
    AND ${pollTargets.lastSuccessAt} IS NOT NULL
    AND ${pollTargets.lastSuccessAt}
      + (GREATEST(
          ${pollTargets.intervalSeconds} * ${AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER},
          ${MIN_AVAILABILITY_FRESHNESS_SECONDS}
        ) * INTERVAL '1 second') >= ${now}
  )`;
}

export function pollTargetStaleAt(now: Date): SQL {
  return sql`(
    ${pollTargets.enabled} = FALSE
    OR ${pollTargets.lastSuccessAt} IS NULL
    OR ${pollTargets.lastSuccessAt}
      + (GREATEST(
          ${pollTargets.intervalSeconds} * ${AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER},
          ${MIN_AVAILABILITY_FRESHNESS_SECONDS}
        ) * INTERVAL '1 second') < ${now}
  )`;
}
