import {withRequestDiagnostics} from './diagnostics/capture';
import {errorIngestion,errorAdminRoutes} from './diagnostics/routes';
import {cleanupErrors,bindErrorAdmin} from './diagnostics/store';
import { bearerToken, verifyAdminSessionToken } from './admin/auth';
import { permissionForAdminPath } from './admin/permissions';
import { createAdminManagementRoutes } from './admin/management-routes';
import { createLocalModelRoutes } from './admin/model-routes';
import { createLocalPromptRoutes } from './admin/local-prompt-routes';
import app, { type Bindings } from './index';
import { createAdminFeedbackManagementRoutes } from './admin/feedback-management-routes';
import { createAdminNotificationRoutes } from './admin/notification-routes';
import { createAccountRoutes } from './auth/account-routes';
import { createFeedbackRoutes } from './worklog/feedback-routes';
import { createManualRecordRoutes } from './worklog/manual-record-routes';
import { createNativeGroupRoutes } from './worklog/native-group-routes';
import { createNotificationRoutes } from './worklog/notification-routes';
import { deliverPendingPushBatch } from './worklog/push-runtime';
import { runScheduledNotificationBatch } from './worklog/scheduled-notifications';
import { createTaskRoutes } from './worklog/task-routes';

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };
type ApiBoundary = 'ADMIN_API' | 'SUBSCRIPTION_API' | 'WORKLOG_WEB_API';

const diagnosticWeb=errorIngestion(),diagnosticAdmin=errorIngestion(true),diagnosticManagement=errorAdminRoutes();
const managementRoutes = createAdminManagementRoutes();
const adminModelRoutes = createLocalModelRoutes(true);
const publicModelRoutes = createLocalModelRoutes();
const adminPromptRoutes = createLocalPromptRoutes(true);
const publishedPromptRoutes = createLocalPromptRoutes();
const adminFeedbackManagementRoutes = createAdminFeedbackManagementRoutes();
const adminNotificationRoutes = createAdminNotificationRoutes();
const accountRoutes = createAccountRoutes();
const feedbackRoutes = createFeedbackRoutes();
const nativeGroupRoutes = createNativeGroupRoutes();
const notificationRoutes = createNotificationRoutes();
const taskRoutes = createTaskRoutes();
const manualRecordRoutes = createManualRecordRoutes();

const worker = {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/api/v1/admin/') && path !== '/api/v1/admin/login' && request.method !== 'OPTIONS') {
      const origin = request.headers.get('origin');
      const failure = (error: string, status: number) => { const headers = new Headers({'Content-Type':'application/json','Cache-Control':'no-store'}); if (origin === env.ADMIN_WEB_ORIGIN) { headers.set('Access-Control-Allow-Origin',origin!); headers.set('Vary','Origin'); } return new Response(JSON.stringify({error}),{status,headers}); };
      if (origin && origin !== env.ADMIN_WEB_ORIGIN) return failure('ORIGIN_NOT_ALLOWED',403);
      const token = bearerToken(request.headers.get('authorization') ?? undefined); if (!token) return failure('ADMIN_SESSION_REQUIRED',401);
      let identity; try { identity = await verifyAdminSessionToken(token,env); } catch { return failure('ADMIN_AUTH_UNAVAILABLE',503); }
      if (!identity) return failure('ADMIN_SESSION_INVALID',401);
      if(identity.id)bindErrorAdmin(request,identity.id);
      const permission = permissionForAdminPath(path,request.method);
      if (permission === 'RETIRED_ADMIN_PAGE') return failure('ADMIN_PAGE_RETIRED',410);
      if (identity.mustChangePassword && !['/api/v1/admin/session','/api/v1/admin/password'].includes(path)) return failure('PASSWORD_CHANGE_REQUIRED',403);
      if (permission && !identity.isSuperAdmin && !identity.permissions?.includes(permission)) return failure('ADMIN_PERMISSION_DENIED',403);
      env = {...env,__verifiedAdminToken:token,__verifiedAdmin:identity} as typeof env;
    }
    if(path==='/api/v1/diagnostics/errors')return routed(diagnosticWeb,request,env,executionContext,'/api/v1/diagnostics/errors','WORKLOG_WEB_API');
    if(path==='/api/v1/admin/client-errors')return routed(diagnosticAdmin,request,env,executionContext,'/api/v1/admin/client-errors','ADMIN_API');
    if(path==='/api/v1/admin/error-logs'||path.startsWith('/api/v1/admin/error-logs/'))return routed(diagnosticManagement,request,env,executionContext,'/api/v1/admin/error-logs','ADMIN_API');
    if (path === '/api/v1/local-ai/models') return routed(publicModelRoutes,request,env,executionContext,'/api/v1/local-ai/models','WORKLOG_WEB_API');
    if (path === '/api/v1/admin/local-ai-models') return routed(adminModelRoutes,request,env,executionContext,'/api/v1/admin/local-ai-models','ADMIN_API');
    if (/^\/api\/v1\/admin\/(login|session|password|users|roles|permissions|staff)(?:\/|$)/.test(path)) return routed(managementRoutes,request,env,executionContext,'/api/v1/admin','ADMIN_API');

    if (path === '/api/v1/local-ai/prompts') return routed(publishedPromptRoutes, request, env, executionContext, '/api/v1/local-ai/prompts', 'WORKLOG_WEB_API');
    if (path === '/api/v1/admin/local-ai-prompts' || path.startsWith('/api/v1/admin/local-ai-prompts/')) return routed(adminPromptRoutes, request, env, executionContext, '/api/v1/admin/local-ai-prompts', 'ADMIN_API');
    if (path === '/api/v1/admin/feedback-management' || path.startsWith('/api/v1/admin/feedback-management/')) {
      return routed(adminFeedbackManagementRoutes, request, env, executionContext, '/api/v1/admin/feedback-management', 'ADMIN_API');
    }
    if (path === '/api/v1/admin/notifications' || path.startsWith('/api/v1/admin/notifications/')) {
      const response = await routed(adminNotificationRoutes, request, env, executionContext, '/api/v1/admin/notifications', 'ADMIN_API');
      if (await shouldKickPushAfterAdminAnnouncement(request, response)) schedulePushDelivery(env, executionContext);
      return response;
    }
    if (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) return new Response(JSON.stringify({error:'ADMIN_PAGE_RETIRED'}),{status:410,headers:{'Content-Type':'application/json'}});

    if (path === '/api/v1/payments' || path.startsWith('/api/v1/payments/') || path === '/api/v1/subscription' || path.startsWith('/api/v1/subscription/')) {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (request.headers.get('origin') === env.WEB_APP_ORIGIN) {
        headers.set('Access-Control-Allow-Origin', env.WEB_APP_ORIGIN!);
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        headers.set('Vary', 'Origin');
      }
      return request.method === 'OPTIONS' ? new Response(null, { status: 204, headers }) : new Response(JSON.stringify({ error: 'BILLING_RETIRED', message: '本產品已取消訂閱與金流功能。' }), { status: 410, headers });
    }
    if (path === '/api/v1/account' || path.startsWith('/api/v1/account/')) {
      return routed(accountRoutes, request, env, executionContext, '/api/v1/account', 'WORKLOG_WEB_API');
    }
    // Retired provider routes fail closed, including older installed clients.
    if (path === '/api/v1/ai' || path.startsWith('/api/v1/ai/')) {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (request.headers.get('origin') === env.WEB_APP_ORIGIN) {
        headers.set('Access-Control-Allow-Origin', env.WEB_APP_ORIGIN!);
        headers.set('Vary', 'Origin');
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify({ error: 'LOCAL_AI_ONLY', message: 'AI 已改為裝置本機執行，請更新網頁。' }), { status: 410, headers });
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

    return app.fetch(request, env, executionContext as never);
  },

  async scheduled(_controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    executionContext.waitUntil(cleanupErrors(env.DATABASE_URL).catch(()=>console.error('ERROR_LOG_CLEANUP_FAILED')));
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
        requestRef: request.headers.get('x-aftertrace-request-id'),
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

export default {...worker,fetch(request:Request,env:Bindings,context:ExecutionContextLike){return withRequestDiagnostics(request,env,context,(r,e,c)=>worker.fetch(r,e,c));}};
