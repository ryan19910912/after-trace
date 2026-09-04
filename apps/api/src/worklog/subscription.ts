/**
 * Subscription-period compatibility barrel.
 *
 * Subscription lifecycle lives in subscription-period.ts. AI provider usage and
 * settlement belong to ai-provider-usage.ts and the user-owned Grant/point ledger;
 * do not add quota, entitlement, group-collaboration, or reservation logic here.
 */
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
