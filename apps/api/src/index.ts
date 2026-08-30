import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAvailabilityRoutes } from './availability/routes';
import { createIdentityRoutes } from './auth/routes';
import { createDatabase } from './db/client';
import type { Bindings } from './env';
import { WebPushDispatcher } from './notifications/dispatcher';
import { DrizzleNotificationRepository } from './notifications/repository';
import { createNotificationRoutes } from './notifications/routes';
import { PollingOrchestrator } from './polling/orchestrator';
import { createDefaultSourceRegistry } from './sources/registry';
import { DrizzleAvailabilitySyncRepository } from './sources/sync-repository';
import { SourceSynchronizationService } from './sources/sync-service';
import { DrizzleRadarMatcher } from './watch/matcher';
import { createWatchRoutes } from './watch/routes';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));
app.get('/health', (c) => c.json({ service: 'after-trace-api', product: 'sports-availability-radar', status: 'ok' }));
app.route('/api/v1', createAvailabilityRoutes());
app.route('/api/v1/session', createIdentityRoutes());
app.route('/api/v1/watch-rules', createWatchRoutes());
app.route('/api/v1/push', createNotificationRoutes());

async function runScheduledPolling(env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const repository = new DrizzleAvailabilitySyncRepository(database);
  const synchronizer = new SourceSynchronizationService(repository, createDefaultSourceRegistry());
  const polling = await new PollingOrchestrator(repository, synchronizer).run();
  const radar = await new DrizzleRadarMatcher(database).matchPendingAvailableEvents();
  const push = await new WebPushDispatcher(new DrizzleNotificationRepository(database), env).run();
  console.log(JSON.stringify({ event: 'availability_polling_completed', ...polling, radar, push }));
}

export type { Bindings } from './env';
export { app };

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledPolling(env).catch((cause) => {
        console.error(JSON.stringify({
          event: 'availability_polling_failed',
          message: cause instanceof Error ? cause.message : 'unknown error',
        }));
        throw cause;
      }),
    );
  },
} satisfies ExportedHandler<Bindings>;
