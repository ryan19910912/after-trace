/**
 * Compatibility barrel while provider-usage imports are moved to ai-provider-usage.
 *
 * Subscription lifecycle now lives in subscription-period.ts. AI availability and
 * settlement live exclusively in the user-owned Grant/point ledger. Do not add quota,
 * entitlement, group-collaboration, or reservation logic back to this module.
 */
export type { WorklogAiUsageCommit } from './ai-provider-usage';
export {
  WorklogSubscriptionPeriodService,
  addOneCalendarMonth,
  evaluateSubscriptionPeriod,
  subscriptionPeriodOriginKey,
} from './subscription-period';
export type {
  WorklogSubscriptionPeriodAssignmentResult,
  WorklogSubscriptionPeriodGrantSnapshot,
  WorklogSubscriptionPeriodRepository,
  WorklogSubscriptionPeriodSnapshot,
  WorklogSubscriptionPlanTemplate,
  WorklogSubscriptionSource,
  WorklogSubscriptionStatus,
} from './subscription-period';
