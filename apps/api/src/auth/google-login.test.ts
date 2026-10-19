import { describe, expect, it, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createWebAuthRoutes } from './routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  LINE_CHANNEL_ACCESS_TOKEN: 'unused',
  LINE_CHANNEL_SECRET: 'unused',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_URL: 'https://web.example.test',
  WEB_APP_ORIGIN: 'https://web.example.test',
  GOOGLE_LOGIN_CLIENT_ID: 'google-client-id',
  GOOGLE_LOGIN_CLIENT_SECRET: 'google-client-secret',
};

describe('Google Login route', () => {
  it('starts Google OAuth with PKCE and provider-specific state cookie', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('/google/start', { method: 'GET' }, env);

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const authorize = new URL(location!);
    expect(authorize.origin).toBe('https://accounts.google.com');
    expect(authorize.searchParams.get('client_id')).toBe('google-client-id');
    expect(authorize.searchParams.get('scope')).toBe('openid profile email');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorize.searchParams.get('state')).toBeTruthy();
    expect(response.headers.get('set-cookie')).toMatch(/aftertrace_google_oauth_[A-Za-z0-9_-]{43}=/);
    expect(response.headers.get('set-cookie')).toContain('Path=/;');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed when Google Login is not configured', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('/google/start', { method: 'GET' }, {
      ...env,
      GOOGLE_LOGIN_CLIENT_ID: undefined,
      GOOGLE_LOGIN_CLIENT_SECRET: undefined,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'GOOGLE_LOGIN_NOT_CONFIGURED' });
  });
});

describe('Google callback cookie isolation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function app() {
    return new Hono().route('/api/v1/auth', createWebAuthRoutes());
  }
  async function start(instance: ReturnType<typeof app>) {
    const response = await instance.request('https://api.example.test/api/v1/auth/google/start', {}, env);
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { state, cookie, response };
  }
  function callback(instance: ReturnType<typeof app>, state: string, cookie?: string) {
    return instance.request('https://api.example.test/api/v1/auth/google/callback?' + new URLSearchParams({ state, code: 'invalid-test-code' }),
      { headers: cookie ? { Cookie: cookie } : {} }, env);
  }
  it('issues secure host cookies with a unique name per attempt', async () => {
    const instance=app(); const a=await start(instance); const b=await start(instance);
    expect(a.cookie.split('=')[0]).toMatch(/^__Host-aftertrace_google_oauth_/);
    expect(a.cookie.split('=')[0]).not.toBe(b.cookie.split('=')[0]);
    expect(a.response.headers.get('set-cookie')).toContain('; Secure');
    expect(a.response.headers.get('set-cookie')).toContain('; HttpOnly');
    expect(a.response.headers.get('set-cookie')).toContain('; SameSite=Lax');
    expect(a.response.headers.get('set-cookie')).not.toContain('Domain=');
  });
  it('lets either parallel login pass state validation without selecting a stale legacy cookie', async () => {
    const instance=app(); const a=await start(instance); const b=await start(instance);
    const fetcher=vi.fn().mockResolvedValue(new Response('{}', {status:400})); vi.stubGlobal('fetch',fetcher);
    const cookies='aftertrace_google_oauth=stale; '+a.cookie+'; '+b.cookie;
    for (const attempt of [a,b]) {
      const response=await callback(instance,attempt.state,cookies);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ok:false,error:'GOOGLE_LOGIN_EXCHANGE_FAILED'});
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toContain(attempt.cookie.split('=')[0]+'=;');
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects a missing or different transaction cookie without calling Google', async () => {
    const instance=app(); const a=await start(instance); const b=await start(instance);
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher); const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    for (const cookie of [undefined,b.cookie]) {
      const response=await callback(instance,a.state,cookie);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ok:false,error:'INVALID_GOOGLE_LOGIN_CALLBACK',reason:'MISSING_LOGIN_COOKIE'});
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(a.state);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('invalid-test-code');
  });
  it('accepts an in-flight legacy cookie even when a stale duplicate appears first', async () => {
    const instance=app(); const a=await start(instance);
    const legacy='aftertrace_google_oauth='+a.cookie.split('=').slice(1).join('=');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:400})));
    const response=await callback(instance,a.state,'aftertrace_google_oauth=stale; '+legacy);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ok:false,error:'GOOGLE_LOGIN_EXCHANGE_FAILED'});
  });
  it('rejects tampered state without fetching Google or deleting another login cookie', async () => {
    const instance=app(); const a=await start(instance);
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher); vi.spyOn(console,'warn').mockImplementation(()=>{});
    const response=await callback(instance,'tampered-state',a.cookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({reason:'INVALID_OR_EXPIRED_STATE'});
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
