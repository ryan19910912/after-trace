import worker from './worker';
import type { Bindings } from './index';
import { targetReadinessResponse } from './target-readiness';

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

/**
 * Thin target-first Worker entry.
 *
 * `/health/ready` validates the accepted Web/PWA V1 target and intentionally does not
 * require retired LINE webhook/group/funding schema. All other traffic and the shared
 * scheduler remain delegated to the existing Worker while migration residue is removed
 * after executable dependency validation.
 */
export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    if (new URL(request.url).pathname === '/health/ready') {
      return targetReadinessResponse(env);
    }
    return worker.fetch(request, env, executionContext);
  },

  scheduled(controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    return worker.scheduled(controller, env, executionContext);
  },
};
