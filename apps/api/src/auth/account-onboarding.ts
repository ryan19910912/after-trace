import type { Database } from '../db/client';
import { WorklogAiGrantService } from '../worklog/ai-grants';
import { DrizzleWorklogAiGrantRepository } from '../worklog/drizzle-ai-grants';
import { DrizzleWorklogBootstrapRepository } from '../worklog/drizzle-bootstrap';
import { DrizzleNotificationRepository } from '../worklog/drizzle-notifications';
import { NotificationService } from '../worklog/notifications';
import { notifyFreeTrialIssued } from '../worklog/system-notification-events';

export type AccountOnboardingResult = {
  workspaceId: number;
  privateSourceId: number;
  freeTrial: 'ISSUED_OR_EXISTING' | 'CONFIG_PENDING';
};

/**
 * Shared provider-neutral post-auth onboarding. Login providers must call this after resolving
 * the AFTERTRACE user. It deliberately does not inspect provider email/id/name.
 *
 * Missing commercial trial config must not block the complete FREE manual product. The next
 * successful login retries issuance; once configured, owner+origin_key makes issuance exactly
 * once per AFTERTRACE account and the SYSTEM notification is independently idempotent.
 */
export async function ensureAccountOnboarding(
  database: Database,
  userId: number,
  at = new Date(),
): Promise<AccountOnboardingResult> {
  const bootstrap = new DrizzleWorklogBootstrapRepository(database);
  const workspaceId = await bootstrap.ensureWorkspace(userId, at);
  const privateSourceId = await bootstrap.ensurePrivateSource(userId, workspaceId, at);
  const grants = new WorklogAiGrantService(new DrizzleWorklogAiGrantRepository(database));

  try {
    const freeTrialGrant = await grants.ensureInitialFreeGrant({ userId, privateSourceId, at });
    await notifyFreeTrialIssued(
      new NotificationService(new DrizzleNotificationRepository(database)),
      userId,
      freeTrialGrant.id,
    );
    return { workspaceId, privateSourceId, freeTrial: 'ISSUED_OR_EXISTING' };
  } catch (error) {
    if (error instanceof Error && error.message === 'FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED') {
      return { workspaceId, privateSourceId, freeTrial: 'CONFIG_PENDING' };
    }
    throw error;
  }
}
