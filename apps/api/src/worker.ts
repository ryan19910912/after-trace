import app, { type Bindings } from './index';
import { createAdminRoutes } from './admin/routes';
import { createDatabase } from './db/client';
import { LineMessagingPushClient } from './line/push';
import { DrizzleProactiveRepository } from './proactive/drizzle-repository';
import { createProactiveRoutes } from './proactive/routes';
import { ProactiveDeliveryService } from './proactive/service';
import { ReminderDeliveryService } from './reminders/delivery';
import { DrizzleUserReminderDeliveryRepository } from './reminders/drizzle-user-delivery-repository';
import { DrizzleRetentionRepository } from './retention/drizzle-repository';
import { GroupRetentionService } from './retention/service';

type ScheduledControllerLike = { scheduledTime: number };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const proactiveRoutes = createProactiveRoutes();
const adminRoutes = createAdminRoutes();

async function runReminderSchedule(controller: ScheduledControllerLike, env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new ReminderDeliveryService(
    new DrizzleUserReminderDeliveryRepository(database),
    new LineMessagingPushClient(env.LINE_CHANNEL_ACCESS_TOKEN),
  );
  console.log(JSON.stringify({
    event: 'reminder_delivery_run',
    ...(await service.deliverDue(new Date(controller.scheduledTime))),
  }));
}

async function runProactiveSchedule(controller: ScheduledControllerLike, env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new ProactiveDeliveryService(
    new DrizzleProactiveRepository(database),
    new LineMessagingPushClient(env.LINE_CHANNEL_ACCESS_TOKEN),
  );
  console.log(JSON.stringify({
    event: 'proactive_delivery_run',
    ...(await service.deliverDue(new Date(controller.scheduledTime))),
  }));
}

async function runRetentionSchedule(controller: ScheduledControllerLike, env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new GroupRetentionService(new DrizzleRetentionRepository(database));
  console.log(JSON.stringify({
    event: 'group_retention_run',
    ...(await service.purgeExpired(new Date(controller.scheduledTime))),
  }));
}

export default {
  fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/internal/proactive') {
      const rewritten = new URL(request.url);
      rewritten.pathname = '/';
      return proactiveRoutes.fetch(
        new Request(rewritten, request),
        env as never,
        executionContext as never,
      );
    }
    if (url.pathname === '/api/v1/admin' || url.pathname.startsWith('/api/v1/admin/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/admin'.length) || '/';
      return adminRoutes.fetch(
        new Request(rewritten, request),
        env as never,
        executionContext as never,
      );
    }
    return app.fetch(request, env, executionContext as never);
  },
  scheduled(controller: ScheduledControllerLike, env: Bindings, executionContext: ExecutionContextLike) {
    executionContext.waitUntil(
      Promise.all([
        runReminderSchedule(controller, env),
        runProactiveSchedule(controller, env),
        runRetentionSchedule(controller, env),
      ]).then(() => undefined),
    );
  },
};
