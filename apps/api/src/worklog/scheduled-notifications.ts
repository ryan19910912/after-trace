import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client';
import { DrizzleNotificationRepository } from './drizzle-notifications';
import { deliverPendingPushBatch, type WebPushRuntimeBindings } from './push-runtime';

export type ScheduledNotificationBindings = WebPushRuntimeBindings;

export type ScheduledNotificationRunResult = {
  dueAnnouncementsExamined: number;
  announcementsSent: number;
  announcementsSkipped: number;
  pushBatchClaimed: number;
};

type DueAnnouncementRow = { id: string };

export async function runScheduledNotificationBatch(
  env: ScheduledNotificationBindings,
  options: { announcementLimit?: number; pushLimit?: number } = {},
): Promise<ScheduledNotificationRunResult> {
  const database = createDatabase(env.DATABASE_URL);
  const announcementResult = await dispatchDueAnnouncements(
    database,
    boundedLimit(options.announcementLimit, 25, 100),
  );
  const pushResult = await deliverPendingPushBatch(
    env,
    boundedLimit(options.pushLimit, 50, 100),
  );
  return {
    ...announcementResult,
    pushBatchClaimed: pushResult?.claimed ?? 0,
  };
}

export async function dispatchDueAnnouncements(
  database: Database,
  limit = 25,
): Promise<Pick<ScheduledNotificationRunResult, 'dueAnnouncementsExamined' | 'announcementsSent' | 'announcementsSkipped'>> {
  const due = await database.execute(sql`
    SELECT notification.id::text AS id
    FROM worklog_notifications AS notification
    WHERE notification.type = 'ANNOUNCEMENT'
      AND notification.status = 'SCHEDULED'
      AND notification.scheduled_at IS NOT NULL
      AND notification.scheduled_at <= NOW()
    ORDER BY notification.scheduled_at ASC, notification.id ASC
    LIMIT ${boundedLimit(limit, 25, 100)}
  `);

  const repository = new DrizzleNotificationRepository(database);
  let sent = 0;
  let skipped = 0;
  for (const row of due.rows as DueAnnouncementRow[]) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      skipped += 1;
      continue;
    }
    const result = await repository.dispatchAnnouncement(id);
    if (result.status === 'SENT') sent += 1;
    else skipped += 1;
  }

  return {
    dueAnnouncementsExamined: due.rows.length,
    announcementsSent: sent,
    announcementsSkipped: skipped,
  };
}

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max
    ? Number(value)
    : fallback;
}
