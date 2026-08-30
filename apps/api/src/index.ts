import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAvailabilityRoutes } from './availability/routes';
import { createDatabase } from './db/client';
import type { Bindings } from './env';
import { PollingOrchestrator } from './polling/orchestrator';
import { createDefaultSourceRegistry } from './sources/registry';
import { DrizzleAvailabilitySyncRepository } from './sources/sync-repository';
import { SourceSynchronizationService } from './sources/sync-service';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.get('/health', (c) => c.json({ service: 'after-trace-api', product: 'sports-availability-radar', status: 'ok' }));
app.route('/api/v1', createAvailabilityRoutes());

async function runScheduledPolling(env: Bindings): Promise<void> {
  const database = createDatabase(env.DATABASE_URL);
  const repository = new DrizzleAvailabilitySyncRepository(database);
  const synchronizer = new SourceSynchronizationService(repository, createDefaultSourceRegistry());
  const result = await new PollingOrchestrator(repository, synchronizer).run();
  console.log(JSON.stringify({ event: 'availability_polling_completed', ...result }));
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
};
