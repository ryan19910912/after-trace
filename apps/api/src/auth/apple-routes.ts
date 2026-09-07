import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import { ensureAccountOnboarding } from './account-onboarding';
import { AccountIdentityService } from './account-identity';
import {
  AppleLoginError,
  createAppleClientSecret,
  createAppleNonce,
  verifyAppleIdentityToken,
} from './apple-login';
import { DrizzleAccountIdentityRepository } from './drizzle-account-identity';
import { issueAppleLoginState, verifyAppleLoginState } from './oauth-state';
import { issueWebSessionToken } from './token';

export type AppleAuthBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  APPLE_LOGIN_CLIENT_ID?: string;
  APPLE_LOGIN_TEAM_ID?: string;
  APPLE_LOGIN_KEY_ID?: string;
  APPLE_LOGIN_PRIVATE_KEY_P8_BASE64?: string;
};

type Env = { Bindings: AppleAuthBindings };
type AppleTokenResponse = { id_token?: unknown };

const COOKIE = 'aftertrace_apple_oauth';
const COOKIE_PATH = '/api/v1/auth/apple';

export function createAppleAuthRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowed === origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.get('/start', async (c) => {
    const secret = authSecret(c.env);
    const config = appleConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' }, 503);

    const state = await issueAppleLoginState(secret);
    const nonce = createAppleNonce();
    const redirectUri = new URL('/api/v1/auth/apple/callback', c.req.url).toString();
    const authorizeUrl = new URL('https://appleid.apple.com/auth/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('response_mode', 'query');
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('nonce', nonce);
    c.header('Set-Cookie', oauthCookie(`${state}|${nonce}`, c.req.url, 600));
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.get('/callback', async (c) => {
    const secret = authSecret(c.env);
    const config = appleConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' }, 503);

    const code = c.req.query('code')?.trim();
    const state = c.req.query('state')?.trim();
    const stored = splitCookie(cookieValue(c.req.header('cookie'), COOKIE));
    c.header('Set-Cookie', oauthCookie('', c.req.url, 0));
    if (
      !code
      || !state
      || !stored
      || stored.state !== state
      || !(await verifyAppleLoginState(state, secret))
    ) {
      return c.json({ ok: false, error: 'INVALID_APPLE_LOGIN_CALLBACK' }, 400);
    }

    let clientSecret: string;
    try {
      clientSecret = await createAppleClientSecret({
        clientId: config.clientId,
        teamId: config.teamId,
        keyId: config.keyId,
        privateKeyP8Base64: config.privateKeyP8Base64,
      });
    } catch (error) {
      console.error('APPLE_CLIENT_SECRET_CREATE_FAILED', error);
      return c.json({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' }, 503);
    }

    const redirectUri = new URL('/api/v1/auth/apple/callback', c.req.url).toString();
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: clientSecret,
        }),
      });
    } catch {
      return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502);
    }
    if (!tokenResponse.ok) return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502);

    let tokenBody: AppleTokenResponse;
    try { tokenBody = await tokenResponse.json() as AppleTokenResponse; }
    catch { return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502); }
    if (typeof tokenBody.id_token !== 'string' || !tokenBody.id_token) {
      return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502);
    }

    let identity;
    try {
      identity = await verifyAppleIdentityToken({
        idToken: tokenBody.id_token,
        clientId: config.clientId,
        expectedNonce: stored.nonce,
      });
    } catch (error) {
      const codeValue = error instanceof AppleLoginError ? error.code : 'APPLE_ID_TOKEN_INVALID';
      console.error('APPLE_ID_TOKEN_VERIFY_FAILED', codeValue);
      return c.json({ ok: false, error: codeValue }, codeValue === 'APPLE_KEYS_UNAVAILABLE' ? 502 : 401);
    }

    const at = new Date();
    const database = createDatabase(c.env.DATABASE_URL);
    const account = await new AccountIdentityService(
      new DrizzleAccountIdentityRepository(database),
    ).provision({
      provider: 'APPLE',
      subject: identity.subject,
      emailSnapshot: identity.emailSnapshot,
      displayNameSnapshot: null,
      at,
    });
    await ensureAccountOnboarding(database, account.userId, at);

    const sessionToken = await issueWebSessionToken({ userId: account.userId, secret });
    const webUrl = new URL(config.webAppUrl);
    webUrl.hash = new URLSearchParams({ session: sessionToken }).toString();
    return c.redirect(webUrl.toString(), 302);
  });

  return app;
}

function appleConfig(env: AppleAuthBindings): {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyP8Base64: string;
  webAppUrl: string;
} | null {
  const clientId = env.APPLE_LOGIN_CLIENT_ID?.trim();
  const teamId = env.APPLE_LOGIN_TEAM_ID?.trim();
  const keyId = env.APPLE_LOGIN_KEY_ID?.trim();
  const privateKeyP8Base64 = env.APPLE_LOGIN_PRIVATE_KEY_P8_BASE64?.trim();
  const webAppUrl = env.WEB_APP_URL?.trim();
  return clientId && teamId && keyId && privateKeyP8Base64 && webAppUrl
    ? { clientId, teamId, keyId, privateKeyP8Base64, webAppUrl }
    : null;
}

function authSecret(env: AppleAuthBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try { return decodeURIComponent(rest.join('=')); }
    catch { return null; }
  }
  return null;
}

function splitCookie(value: string | null): { state: string; nonce: string } | null {
  const separator = value?.lastIndexOf('|') ?? -1;
  if (!value || separator <= 0) return null;
  const state = value.slice(0, separator);
  const nonce = value.slice(separator + 1);
  return state && nonce ? { state, nonce } : null;
}

function oauthCookie(value: string, requestUrl: string, maxAge: number): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
