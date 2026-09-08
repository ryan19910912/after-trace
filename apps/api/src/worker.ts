import app, { type Bindings } from './index';
import { createAdminAccountLookupRoutes } from './admin/account-lookup-routes';
import { createAdminCommercialConfigRoutes } from './admin/commercial-config-routes';
import { createAdminFeedbackManagementRoutes } from './admin/feedback-management-routes';
import { createAdminNotificationRoutes } from './admin/notification-routes';
import { createAdminProfitabilityRoutes } from './admin/profitability-routes';
import { createAdminRoutes } from './admin/routes';
import { createAccountRoutes } from './auth/account-routes';
import { createNewebPayRoutes } from './payments/newebpay-routes';
import { createAiEntitlementRoutes } from './worklog/ai-entitlement-routes';
import { createAiTaskProposalRoutes } from './worklog/ai-task-proposal-routes';
import { createAiTextCaptureRoutes } from './worklog/ai-text-capture-routes';
import { createFeedbackRoutes } from './worklog/feedback-routes';
import { createManualRecordRoutes } from './worklog/manual-record-routes';
import { createNativeGroupRoutes } from './worklog/native-group-routes';
import { createNotificationRoutes } from './worklog/notification-routes';
import { deliverPendingPushBatch } from './worklog/push-runtime';
import { runScheduledNotificationBatch } from './worklog/scheduled-notifications';
import { createWorklogSubscriptionRoutes } from './worklog/subscription-routes';
import { createTaskRoutes } from './worklog/task-routes';

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };
type ApiBoundary = 'ADMIN_API' | 'SUBSCRIPTION_API' | 'WORKLOG_WEB_API';

const adminRoutes = createAdminRoutes();
const adminAccountLookupRoutes = createAdminAccountLookupRoutes();
const adminCommercialConfigRoutes = createAdminCommercialConfigRoutes();
const adminFeedbackManagementRoutes = createAdminFeedbackManagementRoutes();
const adminNotificationRoutes = createAdminNotificationRoutes();
const adminProfitabilityRoutes = createAdminProfitabilityRoutes();
const accountRoutes = createAccountRoutes();
const aiEntitlementRoutes = createAiEntitlementRoutes();
const aiTaskProposalRoutes = createAiTaskProposalRoutes();
const aiTextCaptureRoutes = createAiTextCaptureRoutes();
const feedbackRoutes = createFeedbackRoutes();
const newebPayRoutes = createNewebPayRoutes();
const nativeGroupRoutes = createNativeGroupRoutes();
const notificationRoutes = createNotificationRoutes();
const taskRoutes = createTaskRoutes();
const manualRecordRoutes = createManualRecordRoutes();
const subscriptionRoutes = createWorklogSubscriptionRoutes();

export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/webhooks/line') return retired('LINE_WEBHOOK_RETIRED');
    if (isRetiredLegacyPath(path)) return retired('LEGACY_AFTERTRACE_RUNTIME_RETIRED');

    if (path === '/api/v1/admin/accounts') {
      return routed(adminAccountLookupRoutes, request, env, executionContext, '/api/v1/admin/accounts', 'ADMIN_API');
    }
    if (path === '/api/v1/admin/feedback-management' || path.startsWith('/api/v1/admin/feedback-management/')) {
      return routed(adminFeedbackManagementRoutes, request, env, executionContext, '/api/v1/admin/feedback-management', 'ADMIN_API');
    }
    if (path === '/api/v1/admin/notifications' || path.startsWith('/api/v1/admin/notifications/')) {
      const response = await routed(adminNotificationRoutes, request, env, executionContext, '/api/v1/admin/notifications', 'ADMIN_API');
      if (await shouldKickPushAfterAdminAnnouncement(request, response)) schedulePushDelivery(env, executionContext);
      return response;
    }
    if (path === '/api/v1/admin/commercial-config' || path.startsWith('/api/v1/admin/commercial-config/')) {
      return routed(adminCommercialConfigRoutes, request, env, executionContext, '/api/v1/admin/commercial-config', 'ADMIN_API');
    }
    if (path === '/api/v1/admin/profitability' || path.startsWith('/api/v1/admin/profitability/')) {
      return routed(adminProfitabilityRoutes, request, env, executionContext, '/api/v1/admin/profitability', 'ADMIN_API');
    }
    if (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) {
      return routed(adminRoutes, request, env, executionContext, '/api/v1/admin', 'ADMIN_API');
    }

    if (path === '/api/v1/payments/newebpay' || path.startsWith('/api/v1/payments/newebpay/')) {
      return routed(newebPayRoutes, request, env, executionContext, '/api/v1/payments/newebpay', 'SUBSCRIPTION_API');
    }
    if (path === '/api/v1/subscription' || path.startsWith('/api/v1/subscription/')) {
      return routed(subscriptionRoutes, request, env, executionContext, '/api/v1/subscription', 'SUBSCRIPTION_API');
    }
    if (path === '/api/v1/account' || path.startsWith('/api/v1/account/')) {
      return routed(accountRoutes, request, env, executionContext, '/api/v1/account', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/ai/entitlement') {
      return routed(aiEntitlementRoutes, request, env, executionContext, '/api/v1/ai/entitlement', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/ai/task-proposal') {
      return routed(aiTaskProposalRoutes, request, env, executionContext, '/api/v1/ai/task-proposal', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/ai/capture' || path.startsWith('/api/v1/ai/capture/')) {
      return routed(aiTextCaptureRoutes, request, env, executionContext, '/api/v1/ai/capture', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/notifications' || path.startsWith('/api/v1/notifications/')) {
      return routed(notificationRoutes, request, env, executionContext, '/api/v1/notifications', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/tasks' || path.startsWith('/api/v1/tasks/')) {
      return routed(taskRoutes, request, env, executionContext, '/api/v1/tasks', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/groups' || path.startsWith('/api/v1/groups/')) {
      return routed(nativeGroupRoutes, request, env, executionContext, '/api/v1/groups', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/worklog/feedback') {
      return routed(feedbackRoutes, request, env, executionContext, '/api/v1/worklog/feedback', 'WORKLOG_WEB_API');
    }
    if (isManualRecordPath(path)) {
      return routed(manualRecordRoutes, request, env, executionContext, '/api/v1/worklog', 'WORKLOG_WEB_API');
    }
    if (path === '/api/v1/worklog' || path.startsWith('/api/v1/worklog/')) {
      return retired('LEGACY_WORKLOG_ROUTE_RETIRED');
    }

    return app.fetch(request, env, executionContext as never);
  },

  async scheduled(_controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    executionContext.waitUntil(
      runScheduledNotificationBatch(env, { announcementLimit: 25, taskLimit: 50, pushLimit: 50 })
        .then((result) => console.log(JSON.stringify({ event: 'worklog_notification_schedule_completed', ...result })))
        .catch((error) => console.error(JSON.stringify({
          event: 'worklog_notification_schedule_failed',
          message: error instanceof Error ? error.message : 'unknown error',
        }))),
    );
  },
};

function isManualRecordPath(path: string): boolean {
  if (path === '/api/v1/worklog/surfaces') return true;
  if (/^\/api\/v1\/worklog\/records\/personal(?:\/deleted)?$/.test(path)) return true;
  if (/^\/api\/v1\/worklog\/records\/group\/\d+(?:\/deleted)?$/.test(path)) return true;
  return /^\/api\/v1\/worklog\/records\/\d+(?:\/restore|\/revisions)?$/.test(path);
}

function isRetiredLegacyPath(path: string): boolean {
  if (path === '/api/v1/auth/groups' || path === '/api/v1/auth/memories' || path === '/api/v1/auth/entry/exchange') return true;
  if (path === '/api/v1/worklog/funding' || path.startsWith('/api/v1/worklog/funding/')) return true;
  if (path === '/api/v1/worklog/confirmations' || path.startsWith('/api/v1/worklog/confirmations/')) return true;
  return ['/api/v1/management', '/api/v1/energy', '/api/v1/internal/commerce', '/api/v1/internal/proactive']
    .some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

async function routed(
  routeApp: { fetch(request: Request, env?: unknown, executionCtx?: unknown): Response | Promise<Response> },
  request: Request,
  env: Bindings,
  executionContext: ExecutionContextLike,
  prefix: string,
  boundary: ApiBoundary,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const rewritten = new URL(request.url);
  rewritten.pathname = sourceUrl.pathname.slice(prefix.length) || '/';
  return withApiErrorBoundary(boundary, request, () =>
    routeApp.fetch(new Request(rewritten, request), env as never, executionContext as never));
}

function retired(error: string): Response {
  return Response.json({ ok: false, error }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

async function shouldKickPushAfterAdminAnnouncement(request: Request, response: Response): Promise<boolean> {
  if (!response.ok || request.method !== 'POST') return false;
  const path = new URL(request.url).pathname;
  const isSend = /^\/api\/v1\/admin\/notifications\/announcements\/\d+\/send$/.test(path);
  const isCreate = path === '/api/v1/admin/notifications/announcements';
  if (!isSend && !isCreate) return false;
  try {
    const body = await response.clone().json() as { announcement?: { status?: unknown } };
    return body?.announcement?.status === 'SENT';
  } catch { return false; }
}

function schedulePushDelivery(env: Bindings, executionContext: ExecutionContextLike): void {
  executionContext.waitUntil(deliverPendingPushBatch(env, 50).catch(() => null));
}

async function withApiErrorBoundary(
  boundary: ApiBoundary,
  request: Request,
  run: () => Response | Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    const response = await run();
    if (response.status >= 500) {
      console.error(JSON.stringify({
        event: 'worklog_api_boundary_error_response',
        boundary,
        method: request.method,
        pathname: url.pathname,
        status: response.status,
        requestRef: request.headers.get('cf-ray'),
      }));
    }
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'worklog_api_boundary_failed',
      boundary,
      method: request.method,
      pathname: url.pathname,
      requestRef: request.headers.get('cf-ray'),
      message: error instanceof Error ? error.message : 'unknown error',
    }));
    return Response.json({ ok: false, error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}
