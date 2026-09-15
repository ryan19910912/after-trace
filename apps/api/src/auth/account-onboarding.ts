import type { Database } from '../db/client';
import { WorklogAiGrantService } from '../worklog/ai-grants';
import { DrizzleWorklogAiGrantRepository } from '../worklog/drizzle-ai-grants';
import { DrizzleNotificationRepository } from '../worklog/drizzle-notifications';
import { NotificationService } from '../worklog/notifications';
import { notifyFreeTrialIssued } from '../worklog/system-notification-events';
import { DrizzleAccountOnboardingRepository } from './drizzle-account-onboarding';

export type AccountOnboardingResult = {
  workspaceId: number;
  privateSourceId: number;
  freeTrial: 'ISSUED_OR_EXISTING' | 'CONFIG_PENDING';
};

/**
 * Shared provider-neutral post-auth onboarding. Login providers call this only after resolving
 * an AFTERTRACE user. It does not inspect provider email/id/name or LINE webhook state.
 */
export async function ensureAccountOnboarding(
  database: Database,
  userId: number,
  at = new Date(),
): Promise<AccountOnboardingResult> {
  const onboarding = new DrizzleAccountOnboardingRepository(database);
  const workspaceId = await onboarding.ensureWorkspace(userId, at);
  const privateSourceId = await onboarding.ensurePrivateSource(userId, workspaceId, at);
  const grants = new WorklogAiGrantService(new DrizzleWorklogAiGrantRepository(database));

  try {
    const freeTrialGrant = await grants.ensureInitialFreeGrant({ userId, privateSourceId, at });
    try {
      await notifyFreeTrialIssued(
        new NotificationService(new DrizzleNotificationRepository(database)),
        userId,
        freeTrialGrant.id,
      );
    } catch (error) {
      // Account/login onboarding must not fail because a non-critical notification could not
      // be created. The durable grant has already been issued; log the notification failure
      // for operators and let the authenticated session continue normally.
      console.error(JSON.stringify({
        event: 'free_ai_trial_notification_failed',
        userId,
        grantId: freeTrialGrant.id,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
    }
    return { workspaceId, privateSourceId, freeTrial: 'ISSUED_OR_EXISTING' };
  } catch (error) {
    if (error instanceof Error && error.message === 'FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED') {
      return { workspaceId, privateSourceId, freeTrial: 'CONFIG_PENDING' };
    }
    throw error;
  }
}
