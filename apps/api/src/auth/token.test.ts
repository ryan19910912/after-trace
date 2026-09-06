import { describe, expect, it } from 'vitest';
import {
  issuePrivateWebEntryToken,
  issueWebEntryToken,
  issueWebSessionToken,
  verifyPrivateWebEntryToken,
  verifyWebEntryToken,
  verifyWebSessionToken,
} from './token';

const secret = '0123456789abcdef0123456789abcdef';
const lineUserId = 'U0123456789abcdef0123456789abcdef';
const groupId = 'C0123456789abcdef0123456789abcdef';
const now = new Date('2026-08-30T07:00:00.000Z');

describe('web auth tokens', () => {
  it('issues and verifies a short-lived group entry token', async () => {
    const token = await issueWebEntryToken({
      lineUserId,
      lineGroupId: groupId,
      nonce: 'abcdefghijklmnop',
      secret,
      now,
      ttlSeconds: 300,
    });

    await expect(verifyWebEntryToken(token, secret, now)).resolves.toEqual({
      type: 'WEB_ENTRY',
      lineUserId,
      lineGroupId: groupId,
      nonce: 'abcdefghijklmnop',
      expiresAt: Math.floor(now.getTime() / 1000) + 300,
    });
  });

  it('issues and verifies a private entry token without inventing a group id', async () => {
    const token = await issuePrivateWebEntryToken({
      lineUserId,
      userId: 41,
      sourceId: 73,
      nonce: 'private-entry-nonce',
      secret,
      now,
      ttlSeconds: 300,
    });

    await expect(verifyPrivateWebEntryToken(token, secret, now)).resolves.toEqual({
      type: 'PRIVATE_WEB_ENTRY',
      lineUserId,
      userId: 41,
      sourceId: 73,
      nonce: 'private-entry-nonce',
      expiresAt: Math.floor(now.getTime() / 1000) + 300,
    });
    await expect(verifyWebEntryToken(token, secret, now)).resolves.toBeNull();
  });

  it('rejects invalid private database ids before issuing a token', async () => {
    await expect(issuePrivateWebEntryToken({
      lineUserId,
      userId: 0,
      sourceId: 73,
      nonce: 'private-entry-nonce',
      secret,
      now,
    })).rejects.toThrow('invalid database id');
  });

  it('rejects an expired entry token', async () => {
    const token = await issueWebEntryToken({
      lineUserId,
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

  it('issues target web sessions from durable user id without requiring LINE identity', async () => {
    const session = await issueWebSessionToken({ userId: 41, secret, now });
    await expect(verifyWebEntryToken(session, secret, now)).resolves.toBeNull();
    await expect(verifyPrivateWebEntryToken(session, secret, now)).resolves.toBeNull();
    await expect(verifyWebSessionToken(session, secret, now)).resolves.toEqual({
      type: 'WEB_SESSION',
      userId: 41,
      lineUserId: null,
      expiresAt: Math.floor(now.getTime() / 1000) + 60 * 60 * 24 * 30,
    });
  });

  it('keeps bounded compatibility with already-issued LINE-only web sessions', async () => {
    const session = await issueWebSessionToken({ lineUserId, secret, now });
    await expect(verifyWebSessionToken(session, secret, now)).resolves.toMatchObject({
      type: 'WEB_SESSION',
      userId: null,
      lineUserId,
    });
  });

  it('can carry both durable and legacy identities during migration', async () => {
    const session = await issueWebSessionToken({ userId: 41, lineUserId, secret, now });
    await expect(verifyWebSessionToken(session, secret, now)).resolves.toMatchObject({
      type: 'WEB_SESSION',
      userId: 41,
      lineUserId,
    });
  });

  it('requires at least one user identity for a web session', async () => {
    await expect(issueWebSessionToken({ secret, now })).rejects.toThrow('web session requires user identity');
  });

  it('rejects tokens signed by another secret', async () => {
    const token = await issueWebSessionToken({ userId: 41, secret, now });
    await expect(
      verifyWebSessionToken(token, 'fedcba9876543210fedcba9876543210', now),
    ).resolves.toBeNull();
  });
});
