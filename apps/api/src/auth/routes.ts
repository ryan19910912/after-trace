import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import { ensureAccountOnboarding } from './account-onboarding';
import { AccountIdentityService } from './account-identity';
import { DrizzleAccountIdentityRepository } from './drizzle-account-identity';
import {
  issueGoogleLoginState,
  issueLineLoginState,
  verifyGoogleLoginState,
  verifyLineLoginState,
} from './oauth-state';
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
  GOOGLE_LOGIN_CLIENT_ID?: string;
  GOOGLE_LOGIN_CLIENT_SECRET?: string;
};

type AuthEnv = { Bindings: WebAuthBindings };

type LineTokenResponse = { access_token?: unknown };
type LineProfile = { userId?: unknown; displayName?: unknown };
type GoogleTokenResponse = { access_token?: unknown };
type GoogleUserInfo = { sub?: unknown; email?: unknown; name?: unknown };

const LINE_OAUTH_COOKIE = 'aftertrace_line_oauth';
const GOOGLE_OAUTH_COOKIE = 'aftertrace_google_oauth';

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

function googleLoginConfig(env: WebAuthBindings): { clientId: string; clientSecret: string; webAppUrl: string } | null {
  const clientId = env.GOOGLE_LOGIN_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_LOGIN_CLIENT_SECRET?.trim();
  const webAppUrl = env.WEB_APP_URL?.trim();
  return clientId && clientSecret && webAppUrl ? { clientId, clientSecret, webAppUrl } : null;
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

function oauthCookie(name: string, path: string, value: string, requestUrl: string, maxAge: number): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function storedOauthState(value: string | null): { state: string; verifier: string } | null {
  const separator = value?.lastIndexOf('|') ?? -1;
  if (!value || separator <= 0) return null;
  const state = value.slice(0, separator);
  const verifier = value.slice(separator + 1);
  return state && verifier ? { state, verifier } : null;
}

function webSessionRedirect(webAppUrl: string, sessionToken: string): string {
  const webUrl = new URL(webAppUrl);
  webUrl.hash = new URLSearchParams({ session: sessionToken }).toString();
  return webUrl.toString();
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

  app.get('/google/start', async (c) => {
    const secret = authSecret(c.env);
    const config = googleLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'GOOGLE_LOGIN_NOT_CONFIGURED' }, 503);
    const redirectUri = new URL('/api/v1/auth/google/callback', c.req.url).toString();
    const state = await issueGoogleLoginState(secret);
    const verifier = createPkceVerifier();
    const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'openid profile email');
    authorizeUrl.searchParams.set('code_challenge', await createPkceChallenge(verifier));
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('prompt', 'select_account');
    c.header('Set-Cookie', oauthCookie(GOOGLE_OAUTH_COOKIE, '/api/v1/auth/google', `${state}|${verifier}`, c.req.url, 600));
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.get('/google/callback', async (c) => {
    const secret = authSecret(c.env);
    const config = googleLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'GOOGLE_LOGIN_NOT_CONFIGURED' }, 503);
    const code = c.req.query('code')?.trim();
    const state = c.req.query('state')?.trim();
    const stored = storedOauthState(cookieValue(c.req.header('cookie'), GOOGLE_OAUTH_COOKIE));
    c.header('Set-Cookie', oauthCookie(GOOGLE_OAUTH_COOKIE, '/api/v1/auth/google', '', c.req.url, 0));
    if (!code || !state || !stored || state !== stored.state || !(await verifyGoogleLoginState(state, secret))) {
      return c.json({ ok: false, error: 'INVALID_GOOGLE_LOGIN_CALLBACK' }, 400);
    }

    const redirectUri = new URL('/api/v1/auth/google/callback', c.req.url).toString();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: stored.verifier,
      }),
    });
    if (!tokenResponse.ok) return c.json({ ok: false, error: 'GOOGLE_LOGIN_EXCHANGE_FAILED' }, 502);
    const tokenBody = (await tokenResponse.json()) as GoogleTokenResponse;
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      return c.json({ ok: false, error: 'GOOGLE_LOGIN_EXCHANGE_FAILED' }, 502);
    }

    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!userInfoResponse.ok) return c.json({ ok: false, error: 'GOOGLE_PROFILE_FAILED' }, 502);
    const profile = (await userInfoResponse.json()) as GoogleUserInfo;
    if (typeof profile.sub !== 'string' || !profile.sub.trim()) {
      return c.json({ ok: false, error: 'GOOGLE_PROFILE_FAILED' }, 502);
    }

    const at = new Date();
    const database = createDatabase(c.env.DATABASE_URL);
    const account = await new AccountIdentityService(
      new DrizzleAccountIdentityRepository(database),
    ).provision({
      provider: 'GOOGLE',
      subject: profile.sub,
      emailSnapshot: typeof profile.email === 'string' ? profile.email : null,
      displayNameSnapshot: typeof profile.name === 'string' ? profile.name : null,
      at,
    });
    await ensureAccountOnboarding(database, account.userId, at);

    const sessionToken = await issueWebSessionToken({ userId: account.userId, secret });
    return c.redirect(webSessionRedirect(config.webAppUrl, sessionToken), 302);
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
    c.header('Set-Cookie', oauthCookie(LINE_OAUTH_COOKIE, '/api/v1/auth/line', `${state}|${verifier}`, c.req.url, 600));
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.get('/line/callback', async (c) => {
    const secret = authSecret(c.env);
    const config = lineLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'LINE_LOGIN_NOT_CONFIGURED' }, 503);
    const code = c.req.query('code')?.trim();
    const state = c.req.query('state')?.trim();
    const stored = storedOauthState(cookieValue(c.req.header('cookie'), LINE_OAUTH_COOKIE));
    c.header('Set-Cookie', oauthCookie(LINE_OAUTH_COOKIE, '/api/v1/auth/line', '', c.req.url, 0));
    if (!code || !state || !stored || state !== stored.state || !(await verifyLineLoginState(state, secret))) {
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
        code_verifier: stored.verifier,
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

    const at = new Date();
    const database = createDatabase(c.env.DATABASE_URL);
    const account = await new AccountIdentityService(
      new DrizzleAccountIdentityRepository(database),
    ).provision({
      provider: 'LINE',
      subject: profile.userId,
      displayNameSnapshot: typeof profile.displayName === 'string' ? profile.displayName : null,
      legacyLineUserId: profile.userId,
      at,
    });
    await ensureAccountOnboarding(database, account.userId, at);

    const sessionToken = await issueWebSessionToken({
      userId: account.userId,
      lineUserId: profile.userId,
      secret,
    });
    return c.redirect(webSessionRedirect(config.webAppUrl, sessionToken), 302);
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
