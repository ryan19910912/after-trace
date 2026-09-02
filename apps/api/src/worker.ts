import app, { type Bindings } from './index';
import { createAdminRoutes } from './admin/routes';
import { loadOperationalRuntimeEnv, operationalSettingDefinitions } from './config/operational-settings';
import { disableLegacyConversationRuntime } from './conversation/service';
import { createDatabase } from './db/client';
import { LineMessageContentResolver } from './line/content';
import { WorklogAttachmentIngestionService } from './worklog/attachment-ingestion';
import { configureWorklogAttachmentRuntime } from './worklog/attachment-runtime';
import { DrizzleWorklogAttachmentRepository } from './worklog/drizzle-attachment-ingestion';
import { DrizzleWorklogSubscriptionRepository } from './worklog/drizzle-subscription';
import { GeminiWorklogAttachmentNormalizer } from './worklog/gemini-attachment-normalizer';
import { createWorklogRoutes } from './worklog/routes';
import { createWorklogSubscriptionRoutes } from './worklog/subscription-routes';
import { WorklogSubscriptionService } from './worklog/subscription';

type ScheduledControllerLike = { scheduledTime: number };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const adminRoutes = createAdminRoutes();
const worklogRoutes = createWorklogRoutes();
const worklogSubscriptionRoutes = createWorklogSubscriptionRoutes();
const LEGACY_PREFIXES = ['/api/v1/management', '/api/v1/energy', '/api/v1/internal/commerce', '/api/v1/internal/proactive'];

async function runtimeEnv(env: Bindings): Promise<Bindings> {
  const database = createDatabase(env.DATABASE_URL);
  const operational = await loadOperationalRuntimeEnv(database);
  const infrastructure = { ...env } as Record<string, unknown>;
  for (const definition of operationalSettingDefinitions) delete infrastructure[definition.key];
  return { ...infrastructure, ...operational } as Bindings;
}

function configureWorklogRuntime(env: Bindings): void {
  // Ordinary group chat has already passed through the bounded Worklog TEXT cache.
  // Never persist it into the retired conversation/Memory/Energy product runtime.
  disableLegacyConversationRuntime();
  const database = createDatabase(env.DATABASE_URL);
  configureWorklogAttachmentRuntime(new WorklogAttachmentIngestionService(
    new DrizzleWorklogAttachmentRepository(database),
    new WorklogSubscriptionService(new DrizzleWorklogSubscriptionRepository(database)),
    new LineMessageContentResolver(env.LINE_CHANNEL_ACCESS_TOKEN),
    new GeminiWorklogAttachmentNormalizer({ apiKey: env.GEMINI_API_KEY }),
  ));
}

function legacyRoute(pathname: string): boolean {
  return LEGACY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default {
  async fetch(request: Request, rawEnv: Bindings, executionContext: ExecutionContextLike) {
    const env = await runtimeEnv(rawEnv);
    configureWorklogRuntime(env);
    const url = new URL(request.url);

    if (legacyRoute(url.pathname)) {
      return Response.json({ ok: false, error: 'LEGACY_AFTERTRACE_RUNTIME_DISABLED' }, { status: 410 });
    }
    if (url.pathname === '/api/v1/admin' || url.pathname.startsWith('/api/v1/admin/')) {
      const rewritten = new URL(request.url); rewritten.pathname = url.pathname.slice('/api/v1/admin'.length) || '/';
      return adminRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (url.pathname === '/api/v1/subscription' || url.pathname.startsWith('/api/v1/subscription/')) {
      const rewritten = new URL(request.url); rewritten.pathname = url.pathname.slice('/api/v1/subscription'.length) || '/';
      return worklogSubscriptionRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (url.pathname === '/api/v1/worklog' || url.pathname.startsWith('/api/v1/worklog/')) {
      const rewritten = new URL(request.url); rewritten.pathname = url.pathname.slice('/api/v1/worklog'.length) || '/';
      return worklogRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    // /webhooks/line, /api/v1/auth and /health still live in the main Hono app.
    return app.fetch(request, env, executionContext as never);
  },

  scheduled(controller: ScheduledControllerLike, _rawEnv: Bindings, executionContext: ExecutionContextLike) {
    // The previous scheduled reminder/proactive/legacy-retention product is retired.
    // Keep the handler harmless until the deployed Worker cron binding is removed.
    executionContext.waitUntil(Promise.resolve().then(() => {
      console.log(JSON.stringify({ event: 'worklog_scheduled_legacy_noop', scheduledTime: controller.scheduledTime }));
    }));
  },
};
