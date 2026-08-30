import { describe, expect, it } from 'vitest';
import { buildGroupLiffUrl, issueGroupContextToken, verifyGroupContextToken } from './group-context';

const groupId = 'C1234567890abcdef1234567890abcdef';
const secret = 'test-line-channel-secret';
const now = new Date('2026-08-30T06:00:00.000Z');

describe('LINE LIFF signed group context', () => {
  it('round-trips a valid group id', async () => {
    const token = await issueGroupContextToken(groupId, secret, now, 60);
    await expect(verifyGroupContextToken(token, secret, now)).resolves.toBe(groupId);
  });

  it('rejects tampered and expired tokens', async () => {
    const token = await issueGroupContextToken(groupId, secret, now, 60);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    await expect(verifyGroupContextToken(tampered, secret, now)).resolves.toBeNull();
    await expect(verifyGroupContextToken(token, secret, new Date(now.getTime() + 61_000))).resolves.toBeNull();
  });

  it('embeds only the signed context in the LIFF URL', async () => {
    const url = new URL(await buildGroupLiffUrl('https://liff.line.me/example', groupId, secret, now));
    expect(url.searchParams.get('gc')).toBeTruthy();
    expect(url.searchParams.get('groupId')).toBeNull();
  });
});
