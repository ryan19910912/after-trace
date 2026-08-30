import { describe, expect, it } from 'vitest';
import { issueLineLoginState, verifyLineLoginState } from './oauth-state';

const secret = '0123456789abcdef0123456789abcdef';
const now = new Date('2026-08-30T07:00:00.000Z');

describe('LINE Login OAuth state', () => {
  it('verifies a signed state inside its lifetime', async () => {
    const state = await issueLineLoginState(secret, now, 600);
    await expect(verifyLineLoginState(state, secret, now)).resolves.toBe(true);
  });

  it('rejects expired state', async () => {
    const state = await issueLineLoginState(secret, now, 60);
    await expect(
      verifyLineLoginState(state, secret, new Date(now.getTime() + 61_000)),
    ).resolves.toBe(false);
  });

  it('rejects tampering and another secret', async () => {
    const state = await issueLineLoginState(secret, now, 600);
    await expect(verifyLineLoginState(`${state}x`, secret, now)).resolves.toBe(false);
    await expect(
      verifyLineLoginState(state, 'fedcba9876543210fedcba9876543210', now),
    ).resolves.toBe(false);
  });
});
