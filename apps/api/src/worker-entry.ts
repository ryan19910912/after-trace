import worker from './worker';
import type { Bindings } from './index';
import { targetReadinessResponse } from './target-readiness';
import { createFeedbackRoutes } from './worklog/feedback-routes';

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const feedbackRoutes = createFeedbackRoutes();

/**
 * Thin target-first Worker entry.
 *
 * `/health/ready` validates the accepted Web/PWA V1 target and intentionally does not
 * require retired LINE webhook/group/funding schema. Retired LINE webhook product traffic
 * is rejected here before it can reach the legacy runtime. Provider-neutral feedback is
 * also intercepted here so Google/Apple/LINE accounts all resolve through AFTERTRACE user id.
 * All other traffic and the shared scheduler remain delegated while migration residue is
 * removed after executable validation.
 */
export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/health/ready') {
      return targetReadinessResponse(env);
    }
    if (pathname === '/webhooks/line') {
      return Response.json({ ok: false, error: 'LEGACY_LINE_WEBHOOK_DISABLED' }, {
        status: 410,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (pathname === '/api/v1/worklog/feedback') {
      const rewritten = new URL(request.url);
      rewritten.pathname = '/';
      return feedbackRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    return worker.fetch(request, env, executionContext);
  },

  scheduled(controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    return worker.scheduled(controller, env, executionContext);
  },
};
