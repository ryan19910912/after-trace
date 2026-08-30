import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAvailabilityRoutes } from './availability/routes';
import { createIdentityRoutes } from './auth/routes';
import { createDatabase } from './db/client';
import { sports } from './db/schema';
import type { Bindings } from './env';
import { WebPushDispatcher } from './notifications/dispatcher';
import { DrizzleNotificationRepository } from './notifications/repository';
import { createNotificationRoutes } from './notifications/routes';
import { PollingOrchestrator } from './polling/orchestrator';
import { evaluateRuntimeReadiness } from './readiness';
import { ScheduledRadarRunner } from './scheduled/run';
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
app.get('/ready', async (c) => {
  const databaseUrl = c.env.DATABASE_URL?.trim();
  const readiness = await evaluateRuntimeReadiness(c.env, async () => {
    if (!databaseUrl) throw new Error('DATABASE_NOT_CONFIGURED');
    const database = createDatabase(databaseUrl);
    await database.select({ id: sports.id }).from(sports).limit(1);
  });

  if (readiness.status === 'ready') return c.json(readiness, 200);
  return c.json(readiness, 503);
});
app.route('/api/v1', createAvailabilityRoutes());
app.route('/api/v1/session', createIdentityRoutes());
app.route('/api/v1/watch-rules', createWatchRoutes());
app.route('/api/v1/push', createNotificationRoutes());

async function runScheduledRadar(env: Bindings) {
  const database = createDatabase(env.DATABASE_URL);
  const repository = new DrizzleAvailabilitySyncRepository(database);
  const synchronizer = new SourceSynchronizationService(repository, createDefaultSourceRegistry());
  const runner = new ScheduledRadarRunner(
    new PollingOrchestrator(repository, synchronizer),
    new DrizzleRadarMatcher(database),
    new WebPushDispatcher(new DrizzleNotificationRepository(database), env),
  );
  return runner.run();
}

export type { Bindings } from './env';
export { app };

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledRadar(env).then((summary) => {
        console.log(JSON.stringify({
          event: 'scheduled_radar_completed',
          ...summary,
        }));
      }),
    );
  },
} satisfies ExportedHandler<Bindings>;
