import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import { WorklogAiGrantService } from '../worklog/ai-grants';
import { DrizzleWorklogAiGrantRepository } from '../worklog/drizzle-ai-grants';
import { DrizzleWorklogBootstrapRepository } from '../worklog/drizzle-bootstrap';
import { issueLineLoginState, verifyLineLoginState } from './oauth-state';
import { createPkceChallenge, createPkceVerifier } from './pkce';
import { DrizzleWebAuthRepository } from './repository';
import { WebAuthService } from './service';
import { issueWebSessionToken } from './token';

export type WebAuthBindings = {
  DATABASE_URL: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
};

type AuthEnv = { Bindings: WebAuthBindings };

type LineTokenResponse = { access_token?: unknown };
type LineProfile = { userId?: unknown; displayName?: unknown };

const OAUTH_COOKIE = 'aftertrace_line_oauth';

function authSecret(env: WebAuthBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function lineLoginConfig(env: WebAuthBindings): { channelId: string; channelSecret: string; webAppUrl: string } | null {
  const channelId = env.LINE_LOGIN_CHANNEL_ID?.trim();
  const channelSecret = env.LINE_LOGIN_CHANNEL_SECRET?.trim();
  const webAppUrl = env.WEB_APP_URL?.trim();
  return channelId && channelSecret && webAppUrl ? { channelId, channelSecret, webAppUrl } : null;
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function oauthCookie(value: string, requestUrl: string, maxAge: number): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${OAUTH_COOKIE}=${encodeURIComponent(value)}; Path=/api/v1/auth/line; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function createWebAuthRoutes() {
  const app = new Hono<AuthEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    if (origin && allowedOrigin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.get('/line/start', async (c) => {
    const secret = authSecret(c.env);
    const config = lineLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'LINE_LOGIN_NOT_CONFIGURED' }, 503);
    const redirectUri = new URL('/api/v1/auth/line/callback', c.req.url).toString();
    const state = await issueLineLoginState(secret);
    const verifier = createPkceVerifier();
    const authorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', config.channelId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'profile openid');
    authorizeUrl.searchParams.set('code_challenge', await createPkceChallenge(verifier));
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    c.header('Set-Cookie', oauthCookie(`${state}|${verifier}`, c.req.url, 600));
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.get('/line/callback', async (c) => {
    const secret = authSecret(c.env);
    const config = lineLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'LINE_LOGIN_NOT_CONFIGURED' }, 503);
    const code = c.req.query('code')?.trim();
    const state = c.req.query('state')?.trim();
    const stored = cookieValue(c.req.header('cookie'), OAUTH_COOKIE);
    c.header('Set-Cookie', oauthCookie('', c.req.url, 0));
    const separator = stored?.lastIndexOf('|') ?? -1;
    const storedState = separator > 0 ? stored!.slice(0, separator) : null;
    const verifier = separator > 0 ? stored!.slice(separator + 1) : null;
    if (!code || !state || !storedState || state !== storedState || !verifier || !(await verifyLineLoginState(state, secret))) {
      return c.json({ ok: false, error: 'INVALID_LINE_LOGIN_CALLBACK' }, 400);
    }

    const redirectUri = new URL('/api/v1/auth/line/callback', c.req.url).toString();
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.channelId,
        client_secret: config.channelSecret,
        code_verifier: verifier,
      }),
    });
    if (!tokenResponse.ok) return c.json({ ok: false, error: 'LINE_LOGIN_EXCHANGE_FAILED' }, 502);
    const tokenBody = (await tokenResponse.json()) as LineTokenResponse;
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      return c.json({ ok: false, error: 'LINE_LOGIN_EXCHANGE_FAILED' }, 502);
    }

    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileResponse.ok) return c.json({ ok: false, error: 'LINE_PROFILE_FAILED' }, 502);
    const profile = (await profileResponse.json()) as LineProfile;
    if (typeof profile.userId !== 'string') return c.json({ ok: false, error: 'LINE_PROFILE_FAILED' }, 502);

    // LINE Login is currently a migration-era provider only. The durable AFTERTRACE
    // session now carries numeric userId so future providers do not need LINE identity.
    const at = new Date();
    const database = createDatabase(c.env.DATABASE_URL);
    const bootstrap = new DrizzleWorklogBootstrapRepository(database);
    const user = await bootstrap.upsertLineUser({
      lineUserId: profile.userId,
      displayName: typeof profile.displayName === 'string' ? profile.displayName : null,
      at,
    });
    const workspaceId = await bootstrap.ensureWorkspace(user.userId, at);
    const privateSourceId = await bootstrap.ensurePrivateSource(user.userId, workspaceId, at);
    await new WorklogAiGrantService(new DrizzleWorklogAiGrantRepository(database)).ensureInitialFreeGrant({
      userId: user.userId,
      privateSourceId,
      at,
    });

    const sessionToken = await issueWebSessionToken({
      userId: user.userId,
      lineUserId: profile.userId,
      secret,
    });
    const webUrl = new URL(config.webAppUrl);
    webUrl.hash = new URLSearchParams({ session: sessionToken }).toString();
    return c.redirect(webUrl.toString(), 302);
  });

  app.post('/entry/exchange', async (c) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { token?: unknown }).token !== 'string') {
      return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    }
    const service = new WebAuthService(
      new DrizzleWebAuthRepository(createDatabase(c.env.DATABASE_URL)),
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      secret,
    );
    const result = await service.exchangeBotEntry((body as { token: string }).token);
    if (result.status === 'INVALID_OR_EXPIRED' || result.status === 'ALREADY_USED') {
      return c.json({ ok: false, error: result.status }, 401);
    }
    if (result.status === 'NOT_GROUP_MEMBER' || result.status === 'PRIVATE_ACCESS_REVOKED') {
      return c.json({ ok: false, error: result.status }, 403);
    }
    if (result.status === 'LINE_UNAVAILABLE') return c.json({ ok: false, error: result.status }, 503);

    return c.json({
      ok: true,
      sessionToken: result.sessionToken,
      lineUserId: result.lineUserId,
      entryContext: result.entryContext,
    });
  });

  return app;
}