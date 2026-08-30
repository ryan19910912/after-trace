import { describe, expect, it } from 'vitest';
import {
  issueWebEntryToken,
  issueWebSessionToken,
  verifyWebEntryToken,
  verifyWebSessionToken,
} from './token';

const secret = '0123456789abcdef0123456789abcdef';
const userId = 'U0123456789abcdef0123456789abcdef';
const groupId = 'C0123456789abcdef0123456789abcdef';
const now = new Date('2026-08-30T07:00:00.000Z');

 describe('web auth tokens', () => {
  it('issues and verifies a short-lived group entry token', async () => {
    const token = await issueWebEntryToken({
      lineUserId: userId,
      lineGroupId: groupId,
      nonce: 'abcdefghijklmnop',
      secret,
      now,
      ttlSeconds: 300,
    });

    await expect(verifyWebEntryToken(token, secret, now)).resolves.toEqual({
      type: 'WEB_ENTRY',
      lineUserId: userId,
      lineGroupId: groupId,
      nonce: 'abcdefghijklmnop',
      expiresAt: Math.floor(now.getTime() / 1000) + 300,
    });
  });

  it('rejects an expired entry token', async () => {
    const token = await issueWebEntryToken({
      lineUserId: userId,
      lineGroupId: groupId,
      nonce: 'abcdefghijklmnop',
      secret,
      now,
      ttlSeconds: 60,
    });

    await expect(
      verifyWebEntryToken(token, secret, new Date(now.getTime() + 61_000)),
    ).resolves.toBeNull();
  });

  it('keeps entry and session token types separate', async () => {
    const session = await issueWebSessionToken({ lineUserId: userId, secret, now });
    await expect(verifyWebEntryToken(session, secret, now)).resolves.toBeNull();
    await expect(verifyWebSessionToken(session, secret, now)).resolves.toMatchObject({
      type: 'WEB_SESSION',
      lineUserId: userId,
    });
  });

  it('rejects tokens signed by another secret', async () => {
    const token = await issueWebSessionToken({ lineUserId: userId, secret, now });
    await expect(
      verifyWebSessionToken(token, 'fedcba9876543210fedcba9876543210', now),
    ).resolves.toBeNull();
  });
});
