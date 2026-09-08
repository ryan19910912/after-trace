import worker from './worker';
import type { Bindings } from './index';
import { targetReadinessResponse } from './target-readiness';

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

/**
 * Thin target-first Worker entry.
 *
 * `/health/ready` validates the accepted Web/PWA V1 target and intentionally does not
 * require retired LINE webhook/group/funding schema. Retired LINE webhook product traffic
 * is rejected here before it can reach the legacy runtime. All other traffic and the shared
 * scheduler remain delegated while migration residue is removed after executable validation.
 */
export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health/ready') {
      return targetReadinessResponse(env);
    }
    if (pathname === '/webhooks/line') {
      return Response.json({ ok: false, error: 'LEGACY_LINE_WEBHOOK_DISABLED' }, {
        status: 410,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return worker.fetch(request, env, executionContext);
  },

  scheduled(controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    return worker.scheduled(controller, env, executionContext);
  },
};
