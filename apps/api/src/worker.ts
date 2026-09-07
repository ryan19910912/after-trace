import app, { type Bindings } from './index';
import { createAdminNotificationRoutes } from './admin/notification-routes';
import { createAdminProfitabilityRoutes } from './admin/profitability-routes';
import { createAdminRoutes } from './admin/routes';
import { createAccountRoutes } from './auth/account-routes';
import { createDatabase } from './db/client';
import { LineMessageContentResolver } from './line/content';
import {
  anomalyErrorCode,
  anomalyErrorSummary,
  DrizzleWorklogAnomalyRepository,
  recordAnomalySafely,
} from './worklog/anomalies';
import { WorklogAiPointLedgerService } from './worklog/ai-point-ledger';
import { WorklogAttachmentIngestionService } from './worklog/attachment-ingestion';
import { configureWorklogAttachmentRuntime } from './worklog/attachment-runtime';
import { WorklogAttachmentTitleNormalizationService } from './worklog/attachment-title-normalization';
import { createWorklogConfirmationRoutes } from './worklog/confirmation-routes';
import { DrizzleWorklogAiPointLedgerRepository } from './worklog/drizzle-ai-point-ledger';
import { DrizzleWorklogAttachmentRepository } from './worklog/drizzle-attachment-ingestion';
import { DrizzleWorklogRecordNormalizationRepository } from './worklog/drizzle-record-normalization-adapter';
import { createWorklogFundingRoutes } from './worklog/funding-routes';
import { GeminiWorklogAttachmentNormalizer } from './worklog/gemini-attachment-normalizer';
import { GeminiWorklogTextNormalizer } from './worklog/gemini-text-normalizer';
import { createManualRecordRoutes } from './worklog/manual-record-routes';
import { createNativeGroupRoutes } from './worklog/native-group-routes';
import { createNotificationRoutes } from './worklog/notification-routes';
import { deliverPendingPushBatch } from './worklog/push-runtime';
import { RecordNormalizationAiPointPort } from './worklog/record-normalization-ai-points';
import { createWorklogRoutes } from './worklog/routes';
import { runScheduledNotificationBatch } from './worklog/scheduled-notifications';
import { createWorklogSubscriptionRoutes } from './worklog/subscription-routes';
import { WorklogTextNormalizationService } from './worklog/text-normalization';

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };
type ApiBoundary = 'ADMIN_API' | 'SUBSCRIPTION_API' | 'WORKLOG_WEB_API';

const adminRoutes = createAdminRoutes();
const adminNotificationRoutes = createAdminNotificationRoutes();
const adminProfitabilityRoutes = createAdminProfitabilityRoutes();
const accountRoutes = createAccountRoutes();
const nativeGroupRoutes = createNativeGroupRoutes();
const notificationRoutes = createNotificationRoutes();
const manualRecordRoutes = createManualRecordRoutes();
const worklogRoutes = createWorklogRoutes();
const worklogConfirmationRoutes = createWorklogConfirmationRoutes();
const worklogFundingRoutes = createWorklogFundingRoutes();
const worklogSubscriptionRoutes = createWorklogSubscriptionRoutes();
const LEGACY_PREFIXES = ['/api/v1/management', '/api/v1/energy', '/api/v1/internal/commerce', '/api/v1/internal/proactive'];
const LEGACY_AUTH_PATHS = new Set(['/api/v1/auth/groups', '/api/v1/auth/memories']);

function configureWorklogRuntime(env: Bindings): void {
  const database = createDatabase(env.DATABASE_URL);
  const pointLedger = new WorklogAiPointLedgerService(new DrizzleWorklogAiPointLedgerRepository(database));
  const recordNormalization = new WorklogTextNormalizationService(
    new DrizzleWorklogRecordNormalizationRepository(database),
    new RecordNormalizationAiPointPort(database, pointLedger),
    new GeminiWorklogTextNormalizer({ apiKey: env.GEMINI_API_KEY }),
  );
  const attachmentIngestion = new WorklogAttachmentIngestionService(
    new DrizzleWorklogAttachmentRepository(database),
    pointLedger,
    new LineMessageContentResolver(env.LINE_CHANNEL_ACCESS_TOKEN),
    new GeminiWorklogAttachmentNormalizer({ apiKey: env.GEMINI_API_KEY }),
  );
  configureWorklogAttachmentRuntime(
    new WorklogAttachmentTitleNormalizationService(attachmentIngestion, recordNormalization),
  );
}

function legacyRoute(pathname: string): boolean {
  return LEGACY_AUTH_PATHS.has(pathname)
    || LEGACY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function manualRecordRoute(pathname: string): boolean {
  if (pathname === '/api/v1/worklog/surfaces') return true;
  if (/^\/api\/v1\/worklog\/records\/personal(?:\/deleted)?$/.test(pathname)) return true;
  if (/^\/api\/v1\/worklog\/records\/group\/\d+(?:\/deleted)?$/.test(pathname)) return true;
  return /^\/api\/v1\/worklog\/records\/\d+(?:\/restore|\/revisions)?$/.test(pathname);
}

function shouldKickPushAfterAdminAnnouncement(request: Request, response: Response): boolean {
  if (!response.ok || request.method !== 'POST') return false;
  const pathname = new URL(request.url).pathname;
  if (/^\/api\/v1\/admin\/notifications\/announcements\/\d+\/send$/.test(pathname)) return true;
  if (pathname !== '/api/v1/admin/notifications/announcements') return false;
  return response.status === 201;
}

function schedulePushDelivery(env: Bindings, executionContext: ExecutionContextLike): void {
  executionContext.waitUntil(
    deliverPendingPushBatch(env, 50).catch((error) => {
      console.error(JSON.stringify({
        event: 'worklog_push_delivery_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      }));
      return null;
    }),
  );
}

async function withApiAnomalyBoundary(
  boundary: ApiBoundary,
  request: Request,
  env: Bindings,
  run: () => Response | Promise<Response>,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  try {
    const response = await run();
    if (response.status >= 500) {
      await recordAnomalySafely(
        new DrizzleWorklogAnomalyRepository(createDatabase(env.DATABASE_URL)),
        {
          category: boundary,
          errorCode: `HTTP_${response.status}`,
          summary: `${boundary} returned HTTP ${response.status}`,
          requestRef: request.headers.get('cf-ray'),
          metadata: {
            method: request.method,
            pathname: requestUrl.pathname,
            status: response.status,
          },
        },
      );
    }
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'worklog_api_boundary_failed',
      boundary,
      method: request.method,
      pathname: requestUrl.pathname,
      message: error instanceof Error ? error.message : 'unknown error',
    }));
    await recordAnomalySafely(
      new DrizzleWorklogAnomalyRepository(createDatabase(env.DATABASE_URL)),
      {
        category: boundary,
        errorCode: anomalyErrorCode(error, 'UNHANDLED_API_ERROR'),
        summary: anomalyErrorSummary(error, `${boundary} unhandled failure`),
        requestRef: request.headers.get('cf-ray'),
        metadata: {
          method: request.method,
          pathname: requestUrl.pathname,
          unhandled: true,
        },
      },
    );
    return Response.json({ ok: false, error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContextLike) {
    const url = new URL(request.url);

    // Liveness/readiness must remain reachable even when a runtime binding is missing.
    // Readiness itself reports the exact configuration/schema/bootstrap blocker instead
    // of letting eager DB/Gemini initialization turn a diagnosable 503 into Error 1101.
    if (url.pathname === '/health' || url.pathname === '/health/ready') {
      return app.fetch(request, env, executionContext as never);
    }

    if (legacyRoute(url.pathname)) {
      return Response.json({ ok: false, error: 'LEGACY_AFTERTRACE_RUNTIME_DISABLED' }, { status: 410 });
    }
    if (
      url.pathname === '/api/v1/admin/notifications'
      || url.pathname.startsWith('/api/v1/admin/notifications/')
    ) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/admin/notifications'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      const response = await withApiAnomalyBoundary('ADMIN_API', request, env, () =>
        adminNotificationRoutes.fetch(routedRequest, env as never, executionContext as never));
      if (shouldKickPushAfterAdminAnnouncement(request, response)) {
        schedulePushDelivery(env, executionContext);
      }
      return response;
    }
    if (
      url.pathname === '/api/v1/admin/profitability'
      || url.pathname.startsWith('/api/v1/admin/profitability/')
    ) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/admin/profitability'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('ADMIN_API', request, env, () =>
        adminProfitabilityRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/admin' || url.pathname.startsWith('/api/v1/admin/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/admin'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('ADMIN_API', request, env, () =>
        adminRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/account' || url.pathname.startsWith('/api/v1/account/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/account'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        accountRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/notifications' || url.pathname.startsWith('/api/v1/notifications/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/notifications'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        notificationRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/subscription' || url.pathname.startsWith('/api/v1/subscription/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/subscription'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('SUBSCRIPTION_API', request, env, () =>
        worklogSubscriptionRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/groups' || url.pathname.startsWith('/api/v1/groups/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/groups'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        nativeGroupRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (manualRecordRoute(url.pathname)) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/worklog'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        manualRecordRoutes.fetch(routedRequest, env as never, executionContext as never));
    }

    // Everything below this boundary is still migration-era Worklog/LINE runtime and may
    // require provider/LINE bindings. Free manual Web/PWA routes above must not eagerly
    // construct Gemini or LINE attachment clients.
    configureWorklogRuntime(env);

    if (url.pathname === '/api/v1/worklog/confirmations' || url.pathname.startsWith('/api/v1/worklog/confirmations/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/worklog/confirmations'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        worklogConfirmationRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/worklog/funding' || url.pathname.startsWith('/api/v1/worklog/funding/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/worklog/funding'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        worklogFundingRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    if (url.pathname === '/api/v1/worklog' || url.pathname.startsWith('/api/v1/worklog/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = url.pathname.slice('/api/v1/worklog'.length) || '/';
      const routedRequest = new Request(rewritten, request);
      return withApiAnomalyBoundary('WORKLOG_WEB_API', request, env, () =>
        worklogRoutes.fetch(routedRequest, env as never, executionContext as never));
    }
    return app.fetch(request, env, executionContext as never);
  },

  async scheduled(_controller: unknown, env: Bindings, executionContext: ExecutionContextLike) {
    executionContext.waitUntil(
      runScheduledNotificationBatch(env, { announcementLimit: 25, pushLimit: 50 }).then((result) => {
        console.log(JSON.stringify({ event: 'worklog_notification_schedule_completed', ...result }));
      }).catch((error) => {
        console.error(JSON.stringify({
          event: 'worklog_notification_schedule_failed',
          message: error instanceof Error ? error.message : 'unknown error',
        }));
      }),
    );
  },
};
