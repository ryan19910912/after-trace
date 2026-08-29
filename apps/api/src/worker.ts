import app, { type Bindings } from './index';
import { createDatabase } from './db/client';
import { LineMessagingPushClient } from './line/push';
import { ReminderDeliveryService } from './reminders/delivery';
import { DrizzleReminderDeliveryRepository } from './reminders/drizzle-delivery-repository';
import { DrizzleRetentionRepository } from './retention/drizzle-repository';
import { GroupRetentionService } from './retention/service';

type ScheduledControllerLike = { scheduledTime: number };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

async function runReminderSchedule(
  controller: ScheduledControllerLike,
  env: Bindings,
): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const repository = new DrizzleReminderDeliveryRepository(database);
  const line = new LineMessagingPushClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  const service = new ReminderDeliveryService(repository, line);
  const result = await service.deliverDue(new Date(controller.scheduledTime));

  console.log(
    JSON.stringify({
      event: 'reminder_delivery_run',
      ...result,
    }),
  );
}

async function runRetentionSchedule(
  controller: ScheduledControllerLike,
  env: Bindings,
): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new GroupRetentionService(new DrizzleRetentionRepository(database));
  const result = await service.purgeExpired(new Date(controller.scheduledTime));

  console.log(
    JSON.stringify({
      event: 'group_retention_run',
      ...result,
    }),
  );
}

export default {
  fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    return app.fetch(request, env, executionContext as never);
  },
  scheduled(
    controller: ScheduledControllerLike,
    env: Bindings,
    executionContext: ExecutionContextLike,
  ) {
    // Reminder delivery and retention operate on disjoint eligibility boundaries:
    // delivery requires an ACTIVE Group, retention requires an INACTIVE Group.
    // Start both so one external failure does not prevent the other task from beginning.
    executionContext.waitUntil(
      Promise.all([
        runReminderSchedule(controller, env),
        runRetentionSchedule(controller, env),
      ]).then(() => undefined),
    );
  },
};
