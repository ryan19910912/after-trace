import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
const database = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../db/client', () => ({ createDatabase: database.create }));
import { createWebAuthRoutes } from './routes';
const env = {
  DATABASE_URL:'postgresql://private.invalid/db', WEB_AUTH_SECRET:'0123456789abcdef0123456789abcdef',
  WEB_APP_URL:'https://web.example.test', GOOGLE_LOGIN_CLIENT_ID:'client', GOOGLE_LOGIN_CLIENT_SECRET:'secret',
};
describe('Google account setup failures', () => {
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();database.create.mockReset();});
  async function login(error: Error) {
    database.create.mockImplementation(()=>{throw error;});
    vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({access_token:'test-access-token'})))
      .mockResolvedValueOnce(new Response(JSON.stringify({sub:'test-subject',email:'private@example.test'}))));
    const app=new Hono().route('/api/v1/auth',createWebAuthRoutes());
    const start=await app.request('https://api.example.test/api/v1/auth/google/start',{},env);
    const state=new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cookie=start.headers.get('set-cookie')!.split(';')[0];
    return app.request('https://api.example.test/api/v1/auth/google/callback?'+new URLSearchParams({state,code:'test-code'}),{headers:{Cookie:cookie}},env);
  }
  it('returns a safe 503 for nested Neon quota errors instead of plain Internal Server Error',async()=>{
    const error=new Error('Failed query with private SQL parameters',{cause:new Error('Server error (HTTP status 402): Your account or project has exceeded the quota. Upgrade your plan to increase limits.')});
    const response=await login(error); expect(response.status).toBe(503);
    const text=await response.text();expect(JSON.parse(text).error).toBe('DATABASE_QUOTA_EXCEEDED');
    expect(text).not.toContain('private SQL');expect(text).not.toContain('test-access-token');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private SQL');
  });
  it('does not label arbitrary account errors as quota errors or leak their message',async()=>{
    const response=await login(new Error('Sensitive database failure'));expect(response.status).toBe(500);
    const text=await response.text();expect(JSON.parse(text).error).toBe('GOOGLE_ACCOUNT_SETUP_FAILED');
    expect(text).not.toContain('Sensitive');
  });
});
