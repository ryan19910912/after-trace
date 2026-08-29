import app, { type Bindings } from './index';
import { createDatabase } from './db/client';
import { LineMessagingPushClient } from './line/push';
import { ReminderDeliveryService } from './reminders/delivery';
import { DrizzleReminderDeliveryRepository } from './reminders/drizzle-delivery-repository';

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

export default {
  fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    return app.fetch(request, env, executionContext as never);
  },
  scheduled(
    controller: ScheduledControllerLike,
    env: Bindings,
    executionContext: ExecutionContextLike,
  ) {
    executionContext.waitUntil(runReminderSchedule(controller, env));
  },
};
