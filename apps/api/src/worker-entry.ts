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
 * require retired LINE webhook/group/funding schema. Retired LINE webhook, GROUP funding
 * and legacy title/entity confirmation product traffic is rejected here before it can reach
 * legacy runtime. Provider-neutral feedback is intercepted here so Google/Apple/LINE
 * accounts all resolve through AFTERTRACE user id. Only the accepted V1 manual Worklog
 * paths are allowed to pass through to the existing manual-record router; all other legacy
 * `/api/v1/worklog/*` paths are tombstoned until their source is physically removed.
 */
export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/health/ready') {
      return targetReadinessResponse(env);
    }
    if (pathname === '/webhooks/line') {
      return tombstone('LEGACY_LINE_WEBHOOK_DISABLED');
    }
    if (pathname === '/api/v1/worklog/feedback') {
      const rewritten = new URL(request.url);
      rewritten.pathname = '/';
      return feedbackRoutes.fetch(new Request(rewritten, request), env as never, executionContext as never);
    }
    if (pathname === '/api/v1/worklog/funding' || pathname.startsWith('/api/v1/worklog/funding/')) {
      return tombstone('LEGACY_GROUP_FUNDING_DISABLED');
    }
    if (pathname === '/api/v1/worklog/confirmations' || pathname.startsWith('/api/v1/worklog/confirmations/')) {
      return tombstone('LEGACY_CONFIRMATION_FLOW_DISABLED');
    }
    if (pathname === '/api/v1/worklog' || pathname.startsWith('/api/v1/worklog/')) {
      if (!isTargetManualWorklogPath(pathname)) {
        return tombstone('LEGACY_WORKLOG_ROUTE_DISABLED');
      }
    }
    return worker.fetch(request, env, executionContext);
  },

  scheduled(controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    return worker.scheduled(controller, env, executionContext);
  },
};

function isTargetManualWorklogPath(pathname: string): boolean {
  if (pathname === '/api/v1/worklog/surfaces') return true;
  if (/^\/api\/v1\/worklog\/records\/personal(?:\/deleted)?$/.test(pathname)) return true;
  if (/^\/api\/v1\/worklog\/records\/group\/\d+(?:\/deleted)?$/.test(pathname)) return true;
  return /^\/api\/v1\/worklog\/records\/\d+(?:\/restore|\/revisions)?$/.test(pathname);
}

function tombstone(error: string): Response {
  return Response.json({ ok: false, error }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  });
}
