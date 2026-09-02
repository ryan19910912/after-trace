import app, { type Bindings } from './index';
import { createAdminRoutes } from './admin/routes';
import { loadOperationalRuntimeEnv, operationalSettingDefinitions } from './config/operational-settings';
import { createDatabase } from './db/client';
import { LineMessageContentResolver } from './line/content';
import { LineMessagingPushClient } from './line/push';
import { DrizzleProactiveRepository } from './proactive/drizzle-repository';
import { createProactiveRoutes } from './proactive/routes';
import { ProactiveDeliveryService } from './proactive/service';
import { ReminderDeliveryService } from './reminders/delivery';
import { DrizzleUserReminderDeliveryRepository } from './reminders/drizzle-user-delivery-repository';
import { DrizzleRetentionRepository } from './retention/drizzle-repository';
import { GroupRetentionService } from './retention/service';
import { WorklogAttachmentIngestionService } from './worklog/attachment-ingestion';
import { configureWorklogAttachmentRuntime } from './worklog/attachment-runtime';
import { DrizzleWorklogAttachmentRepository } from './worklog/drizzle-attachment-ingestion';
import { DrizzleWorklogSubscriptionRepository } from './worklog/drizzle-subscription';
import { GeminiWorklogAttachmentNormalizer } from './worklog/gemini-attachment-normalizer';
import { createWorklogRoutes } from './worklog/routes';
import { WorklogSubscriptionService } from './worklog/subscription';

type ScheduledControllerLike = { scheduledTime: number };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const proactiveRoutes = createProactiveRoutes();
const adminRoutes = createAdminRoutes();
const worklogRoutes = createWorklogRoutes();

async function runtimeEnv(env: Bindings): Promise<Bindings> {
  const database = createDatabase(env.DATABASE_URL);
  const operational = await loadOperationalRuntimeEnv(database);
  const infrastructure = { ...env } as Record<string, unknown>;
  for (const definition of operationalSettingDefinitions) delete infrastructure[definition.key];
  return { ...infrastructure, ...operational } as Bindings;
}

function configureWorklogRuntime(env: Bindings): void {
  const database = createDatabase(env.DATABASE_URL);
  configureWorklogAttachmentRuntime(new WorklogAttachmentIngestionService(
    new DrizzleWorklogAttachmentRepository(database),
    new WorklogSubscriptionService(new DrizzleWorklogSubscriptionRepository(database)),
    new LineMessageContentResolver(env.LINE_CHANNEL_ACCESS_TOKEN),
    new GeminiWorklogAttachmentNormalizer({ apiKey: env.GEMINI_API_KEY }),
  ));
}

async function runReminderSchedule(controller: ScheduledControllerLike, env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new ReminderDeliveryService(new DrizzleUserReminderDeliveryRepository(database), new LineMessagingPushClient(env.LINE_CHANNEL_ACCESS_TOKEN));
  console.log(JSON.stringify({ event: 'reminder_delivery_run', ...(await service.deliverDue(new Date(controller.scheduledTime))) }));
}
async function runProactiveSchedule(controller: ScheduledControllerLike, env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new ProactiveDeliveryService(new DrizzleProactiveRepository(database), new LineMessagingPushClient(env.LINE_CHANNEL_ACCESS_TOKEN));
  console.log(JSON.stringify({ event: 'proactive_delivery_run', ...(await service.deliverDue(new Date(controller.scheduledTime))) }));
}
async function runRetentionSchedule(controller: ScheduledControllerLike, env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const service = new GroupRetentionService(new DrizzleRetentionRepository(database));
  console.log(JSON.stringify({ event: 'group_retention_run', ...(await service.purgeExpired(new Date(controller.scheduledTime))) }));
}

export default {
  async fetch(request: Request, rawEnv: Bindings, executionContext: ExecutionContextLike) {
    const env = await runtimeEnv(rawEnv);
    configureWorklogRuntime(env);
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/internal/proactive') {
      const rewritten = new URL(request.url); rewritten.pathname = '/';
      return proactiveRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (url.pathname === '/api/v1/admin' || url.pathname.startsWith('/api/v1/admin/')) {
      const rewritten = new URL(request.url); rewritten.pathname = url.pathname.slice('/api/v1/admin'.length) || '/';
      return adminRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (url.pathname === '/api/v1/worklog' || url.pathname.startsWith('/api/v1/worklog/')) {
      const rewritten = new URL(request.url); rewritten.pathname = url.pathname.slice('/api/v1/worklog'.length) || '/';
      return worklogRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    return app.fetch(request, env, executionContext as never);
  },
  scheduled(controller: ScheduledControllerLike, rawEnv: Bindings, executionContext: ExecutionContextLike) {
    executionContext.waitUntil((async () => {
      const env = await runtimeEnv(rawEnv);
      await Promise.all([runReminderSchedule(controller, env), runProactiveSchedule(controller, env), runRetentionSchedule(controller, env)]);
    })());
  },
};
