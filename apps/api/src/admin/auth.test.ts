import { describe, expect, it } from 'vitest';
import {
  adminAuthConfigured,
  authenticateAdminCredentials,
  issueAdminSessionToken,
  verifyAdminSessionToken,
} from './auth';

const env = {
  ADMIN_USERNAME: 'operator',
  ADMIN_PASSWORD: 'correct horse battery staple',
  ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('admin configured credential auth', () => {
  it('requires all configured secrets', () => {
    expect(adminAuthConfigured(env)).toBe(true);
    expect(adminAuthConfigured({ ...env, ADMIN_PASSWORD: '' })).toBe(false);
  });

  it('accepts only the configured username and password', async () => {
    await expect(authenticateAdminCredentials('operator', 'correct horse battery staple', env)).resolves.toEqual({ username: 'operator' });
    await expect(authenticateAdminCredentials('operator', 'wrong', env)).resolves.toBeNull();
    await expect(authenticateAdminCredentials('other', 'correct horse battery staple', env)).resolves.toBeNull();
  });

  it('issues an expiring signed bearer session', async () => {
    const now = new Date('2026-09-02T04:00:00Z');
    const token = await issueAdminSessionToken({ username: 'operator', env, now, ttlSeconds: 3600 });
    await expect(verifyAdminSessionToken(token, env, new Date('2026-09-02T04:30:00Z'))).resolves.toEqual({ username: 'operator' });
    await expect(verifyAdminSessionToken(token, env, new Date('2026-09-02T05:00:00Z'))).resolves.toBeNull();
    await expect(verifyAdminSessionToken(`${token}x`, env, new Date('2026-09-02T04:30:00Z'))).resolves.toBeNull();
  });
});
