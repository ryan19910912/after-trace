import { describe, expect, it } from 'vitest';
import { issueWebSessionToken, verifyWebSessionToken } from './token';

const secret = '0123456789abcdef0123456789abcdef';
const now = new Date('2026-08-30T07:00:00.000Z');

describe('provider-neutral web session tokens', () => {
  it('issues and verifies a session from durable AFTERTRACE user id', async () => {
    const session = await issueWebSessionToken({ userId: 41, secret, now });
    await expect(verifyWebSessionToken(session, secret, now)).resolves.toEqual({
      type: 'WEB_SESSION',
      userId: 41,
      expiresAt: Math.floor(now.getTime() / 1000) + 60 * 60 * 24 * 30,
    });
  });

  it('rejects invalid user ids before issuing a session', async () => {
    await expect(issueWebSessionToken({ userId: 0, secret, now })).rejects.toThrow('invalid database id');
  });

  it('rejects expired sessions', async () => {
    const session = await issueWebSessionToken({ userId: 41, secret, now, ttlSeconds: 60 });
    await expect(verifyWebSessionToken(session, secret, new Date(now.getTime() + 61_000))).resolves.toBeNull();
  });

  it('rejects sessions signed by another secret', async () => {
    const session = await issueWebSessionToken({ userId: 41, secret, now });
    await expect(
      verifyWebSessionToken(session, 'fedcba9876543210fedcba9876543210', now),
    ).resolves.toBeNull();
  });
});
