import app, { type Bindings } from './index';
import { createAdminRoutes } from './admin/routes';
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
const LEGACY_AUTH_PATHS = new Set(['/api/v1/auth/groups', '/api/v1/auth/memories']);

function configureWorklogRuntime(env: Bindings): void {
  const database = createDatabase(env.DATABASE_URL);
  configureWorklogAttachmentRuntime(new WorklogAttachmentIngestionService(
    new DrizzleWorklogAttachmentRepository(database),
    new WorklogSubscriptionService(new DrizzleWorklogSubscriptionRepository(database)),
    new LineMessageContentResolver(env.LINE_CHANNEL_ACCESS_TOKEN),
    new GeminiWorklogAttachmentNormalizer({ apiKey: env.GEMINI_API_KEY }),
  ));
}

function legacyRoute(pathname: string): boolean {
  return LEGACY_AUTH_PATHS.has(pathname)
    || LEGACY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    configureWorklogRuntime(env);
    const url = new URL(request.url);

    if (legacyRoute(url.pathname)) {
      return Response.json({ ok: false, error: 'LEGACY_AFTERTRACE_RUNTIME_DISABLED' }, { status: 410 });
    }
    if (url.pathname === '/api/v1/admin' || url.pathname.startsWith('/api/v1/admin/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/admin'.length) || '/';
      return adminRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (url.pathname === '/api/v1/subscription' || url.pathname.startsWith('/api/v1/subscription/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/subscription'.length) || '/';
      return worklogSubscriptionRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (url.pathname === '/api/v1/worklog' || url.pathname.startsWith('/api/v1/worklog/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/worklog'.length) || '/';
      return worklogRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    return app.fetch(request, env, executionContext as never);
  },

  scheduled(controller: ScheduledControllerLike, _env: Bindings, executionContext: ExecutionContextLike) {
    executionContext.waitUntil(Promise.resolve().then(() => {
      console.log(JSON.stringify({ event: 'worklog_scheduled_noop', scheduledTime: controller.scheduledTime }));
    }));
  },
};
