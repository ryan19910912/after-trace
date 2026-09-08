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
import { parseAppleUserSnapshot } from './apple-user';
import { DrizzleAccountIdentityRepository } from './drizzle-account-identity';
import {
  issueAppleLoginState,
  issueGoogleLoginState,
  issueLineLoginState,
  verifyAppleLoginState,
  verifyGoogleLoginState,
  verifyLineLoginState,
} from './oauth-state';
import { createPkceChallenge, createPkceVerifier } from './pkce';
import { loginProviderAvailability } from './provider-availability';
import { issueWebSessionToken } from './token';

export type WebAuthBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GOOGLE_LOGIN_CLIENT_ID?: string;
  GOOGLE_LOGIN_CLIENT_SECRET?: string;
  APPLE_LOGIN_CLIENT_ID?: string;
  APPLE_LOGIN_TEAM_ID?: string;
  APPLE_LOGIN_KEY_ID?: string;
  APPLE_LOGIN_PRIVATE_KEY_P8_BASE64?: string;
};

type AuthEnv = { Bindings: WebAuthBindings };
type LineTokenResponse = { access_token?: unknown };
type LineProfile = { userId?: unknown; displayName?: unknown };
type GoogleTokenResponse = { access_token?: unknown };
type GoogleUserInfo = { sub?: unknown; email?: unknown; name?: unknown };
type AppleTokenResponse = { id_token?: unknown };

const LINE_OAUTH_COOKIE = 'aftertrace_line_oauth';
const GOOGLE_OAUTH_COOKIE = 'aftertrace_google_oauth';
const APPLE_OAUTH_COOKIE = 'aftertrace_apple_oauth';

export function createWebAuthRoutes() {
  const app = new Hono<AuthEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    const providerFormPost = new URL(c.req.url).pathname.endsWith('/apple/callback');
    if (origin && !providerFormPost && (!allowedOrigin || origin !== allowedOrigin)) {
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

  app.get('/providers', (c) => c.json({ ok: true, providers: loginProviderAvailability(c.env) }));

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
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: config.clientId, client_secret: config.clientSecret, code_verifier: stored.verifier,
      }),
    });
    if (!tokenResponse.ok) return c.json({ ok: false, error: 'GOOGLE_LOGIN_EXCHANGE_FAILED' }, 502);
    const tokenBody = await tokenResponse.json() as GoogleTokenResponse;
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      return c.json({ ok: false, error: 'GOOGLE_LOGIN_EXCHANGE_FAILED' }, 502);
    }
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileResponse.ok) return c.json({ ok: false, error: 'GOOGLE_PROFILE_FAILED' }, 502);
    const profile = await profileResponse.json() as GoogleUserInfo;
    if (typeof profile.sub !== 'string' || !profile.sub.trim()) return c.json({ ok: false, error: 'GOOGLE_PROFILE_FAILED' }, 502);

    const account = await provision(c.env.DATABASE_URL, {
      provider: 'GOOGLE',
      subject: profile.sub,
      emailSnapshot: typeof profile.email === 'string' ? profile.email : null,
      displayNameSnapshot: typeof profile.name === 'string' ? profile.name : null,
    });
    return c.redirect(webSessionRedirect(config.webAppUrl, await issueWebSessionToken({ userId: account.userId, secret })), 302);
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
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: config.channelId, client_secret: config.channelSecret, code_verifier: stored.verifier,
      }),
    });
    if (!tokenResponse.ok) return c.json({ ok: false, error: 'LINE_LOGIN_EXCHANGE_FAILED' }, 502);
    const tokenBody = await tokenResponse.json() as LineTokenResponse;
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      return c.json({ ok: false, error: 'LINE_LOGIN_EXCHANGE_FAILED' }, 502);
    }
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileResponse.ok) return c.json({ ok: false, error: 'LINE_PROFILE_FAILED' }, 502);
    const profile = await profileResponse.json() as LineProfile;
    if (typeof profile.userId !== 'string' || !profile.userId.trim()) return c.json({ ok: false, error: 'LINE_PROFILE_FAILED' }, 502);

    const account = await provision(c.env.DATABASE_URL, {
      provider: 'LINE',
      subject: profile.userId,
      displayNameSnapshot: typeof profile.displayName === 'string' ? profile.displayName : null,
    });
    return c.redirect(webSessionRedirect(config.webAppUrl, await issueWebSessionToken({ userId: account.userId, secret })), 302);
  });

  app.get('/apple/start', async (c) => {
    const secret = authSecret(c.env);
    const config = appleLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' }, 503);
    const redirectUri = new URL('/api/v1/auth/apple/callback', c.req.url);
    if (redirectUri.protocol !== 'https:') return c.json({ ok: false, error: 'APPLE_LOGIN_HTTPS_CALLBACK_REQUIRED' }, 503);
    const state = await issueAppleLoginState(secret);
    const nonce = createAppleNonce();
    const authorizeUrl = new URL('https://appleid.apple.com/auth/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('response_mode', 'form_post');
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri.toString());
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'name email');
    authorizeUrl.searchParams.set('nonce', nonce);
    c.header('Set-Cookie', oauthCookie(APPLE_OAUTH_COOKIE, '/api/v1/auth/apple', `${state}|${nonce}`, c.req.url, 600, 'None'));
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.post('/apple/callback', async (c) => {
    const secret = authSecret(c.env);
    const config = appleLoginConfig(c.env);
    if (!secret || !config) return c.json({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' }, 503);
    c.header('Set-Cookie', oauthCookie(APPLE_OAUTH_COOKIE, '/api/v1/auth/apple', '', c.req.url, 0, 'None'));
    const form = new URLSearchParams(await c.req.text());
    if (form.get('error')) return c.json({ ok: false, error: 'APPLE_LOGIN_DENIED' }, 400);
    const code = form.get('code')?.trim();
    const state = form.get('state')?.trim();
    const stored = storedOauthState(cookieValue(c.req.header('cookie'), APPLE_OAUTH_COOKIE));
    if (!code || !state || !stored || state !== stored.state || !(await verifyAppleLoginState(state, secret))) {
      return c.json({ ok: false, error: 'INVALID_APPLE_LOGIN_CALLBACK' }, 400);
    }

    const redirectUri = new URL('/api/v1/auth/apple/callback', c.req.url).toString();
    let clientSecret: string;
    try {
      clientSecret = await createAppleClientSecret({
        clientId: config.clientId, teamId: config.teamId, keyId: config.keyId,
        privateKeyP8Base64: config.privateKeyP8Base64,
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'apple_login_client_secret_failed', code: error instanceof AppleLoginError ? error.code : 'APPLE_CLIENT_SECRET_FAILED' }));
      return c.json({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' }, 503);
    }
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: config.clientId, client_secret: clientSecret }),
      });
    } catch {
      return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502);
    }
    if (!tokenResponse.ok) return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502);
    const tokenBody = await tokenResponse.json() as AppleTokenResponse;
    if (typeof tokenBody.id_token !== 'string' || !tokenBody.id_token.trim()) return c.json({ ok: false, error: 'APPLE_LOGIN_EXCHANGE_FAILED' }, 502);

    try {
      const identity = await verifyAppleIdentityToken({ idToken: tokenBody.id_token, clientId: config.clientId, expectedNonce: stored.verifier });
      const userSnapshot = parseAppleUserSnapshot(form.get('user'));
      const account = await provision(c.env.DATABASE_URL, {
        provider: 'APPLE', subject: identity.subject,
        emailSnapshot: identity.emailSnapshot ?? userSnapshot.emailSnapshot,
        displayNameSnapshot: userSnapshot.displayNameSnapshot,
      });
      return c.redirect(webSessionRedirect(config.webAppUrl, await issueWebSessionToken({ userId: account.userId, secret })), 302);
    } catch (error) {
      console.error(JSON.stringify({ event: 'apple_login_identity_failed', code: error instanceof AppleLoginError ? error.code : 'APPLE_IDENTITY_FAILED' }));
      return c.json({ ok: false, error: 'APPLE_IDENTITY_VERIFICATION_FAILED' }, 502);
    }
  });

  return app;
}

async function provision(databaseUrl: string, input: Parameters<AccountIdentityService['provision']>[0]) {
  const at = new Date();
  const database = createDatabase(databaseUrl);
  const account = await new AccountIdentityService(new DrizzleAccountIdentityRepository(database)).provision({ ...input, at });
  await ensureAccountOnboarding(database, account.userId, at);
  return account;
}

function authSecret(env: WebAuthBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function lineLoginConfig(env: WebAuthBindings) {
  const channelId = env.LINE_LOGIN_CHANNEL_ID?.trim();
  const channelSecret = env.LINE_LOGIN_CHANNEL_SECRET?.trim();
  const webAppUrl = validWebUrl(env.WEB_APP_URL);
  return channelId && channelSecret && webAppUrl ? { channelId, channelSecret, webAppUrl } : null;
}

function googleLoginConfig(env: WebAuthBindings) {
  const clientId = env.GOOGLE_LOGIN_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_LOGIN_CLIENT_SECRET?.trim();
  const webAppUrl = validWebUrl(env.WEB_APP_URL);
  return clientId && clientSecret && webAppUrl ? { clientId, clientSecret, webAppUrl } : null;
}

function appleLoginConfig(env: WebAuthBindings) {
  const clientId = env.APPLE_LOGIN_CLIENT_ID?.trim();
  const teamId = env.APPLE_LOGIN_TEAM_ID?.trim();
  const keyId = env.APPLE_LOGIN_KEY_ID?.trim();
  const privateKeyP8Base64 = env.APPLE_LOGIN_PRIVATE_KEY_P8_BASE64?.trim();
  const webAppUrl = validWebUrl(env.WEB_APP_URL, true);
  return clientId && teamId && keyId && privateKeyP8Base64 && webAppUrl
    ? { clientId, teamId, keyId, privateKeyP8Base64, webAppUrl }
    : null;
}

function validWebUrl(value: string | undefined, httpsOnly = false): string | null {
  try {
    const url = new URL(value?.trim() ?? '');
    if ((httpsOnly && url.protocol !== 'https:') || (!httpsOnly && url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return null; }
    }
  }
  return null;
}

function oauthCookie(name: string, path: string, value: string, requestUrl: string, maxAge: number, sameSite: 'Lax' | 'None' = 'Lax') {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure}`;
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
