import { Hono } from 'hono';
import { createWebAuthRoutes } from './auth/routes';
import { targetReadinessResponse } from './target-readiness';

export type Bindings = {
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  WEB_AUTH_SECRET?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GOOGLE_LOGIN_CLIENT_ID?: string;
  GOOGLE_LOGIN_CLIENT_SECRET?: string;
  APPLE_LOGIN_CLIENT_ID?: string;
  APPLE_LOGIN_TEAM_ID?: string;
  APPLE_LOGIN_KEY_ID?: string;
  APPLE_LOGIN_PRIVATE_KEY_P8_BASE64?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_WEB_ORIGIN?: string;
  WEB_PUSH_PUBLIC_KEY?: string;
  WEB_PUSH_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
  NEWEBPAY_MERCHANT_ID?: string;
  NEWEBPAY_HASH_KEY?: string;
  NEWEBPAY_HASH_IV?: string;
  NEWEBPAY_MODE?: string;
  NEWEBPAY_PERIOD_VERSION?: string;
  NEWEBPAY_PERIOD_TIMES?: string;
  NEWEBPAY_NOTIFY_URL?: string;
  NEWEBPAY_RETURN_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/api/v1/auth', createWebAuthRoutes());
app.get('/health', (c) => c.json({ service: 'after-trace-api', product: 'worklog', status: 'ok' }));
app.get('/health/ready', (c) => targetReadinessResponse(c.env));

export default app;
