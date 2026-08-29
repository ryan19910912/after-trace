import { describe, expect, it, vi } from 'vitest';
import {
  GoogleAdManagerWebRewardedProvider,
  UserRewardedAdService,
} from './rewarded-ad';

describe('UserRewardedAdService', () => {
  it('issues a short-lived server nonce bound to authenticated user', async () => {
    const issueNonce = vi.fn(async () => 'ISSUED' as const);
    const service = new UserRewardedAdService(
      { issueNonce, claim: vi.fn(), completeGrant: vi.fn() },
      { grant: vi.fn() },
      new GoogleAdManagerWebRewardedProvider('1234', '/1234/aftertrace_reward'),
      10n,
      5,
      15,
    );
    const at = new Date('2026-08-29T00:00:00Z');
    const result = await service.issueNonce('U1', at);
    expect(result?.expiresAt).toEqual(new Date('2026-08-29T00:10:00Z'));
    expect(result?.client.provider).toBe('GOOGLE_AD_MANAGER_WEB');
    expect(issueNonce).toHaveBeenCalledWith(expect.objectContaining({
      lineUserId: 'U1',
      nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('mints AD Energy only after an accepted one-time claim', async () => {
    const grant = vi.fn(async (request: { expiresAt: Date | null }) => ({
      status: 'GRANTED' as const,
      lotId: 8,
      operationId: 9,
      expiresAt: request.expiresAt,
    }));
    const completeGrant = vi.fn(async () => 'COMPLETED' as const);
    const service = new UserRewardedAdService(
      {
        issueNonce: vi.fn(),
        claim: vi.fn(async () => ({
          id: 7,
          userId: 2,
          status: 'PENDING' as const,
          grantOperationId: null,
        })),
        completeGrant,
      },
      { grant },
      new GoogleAdManagerWebRewardedProvider('1234', '/1234/aftertrace_reward'),
      10n,
      5,
      15,
    );
    const at = new Date('2026-08-29T00:00:00Z');
    const result = await service.claim({
      lineUserId: 'U1',
      nonce: 'server-nonce',
      providerEventId: 'browser-event-1',
      at,
    });
    expect(result).toEqual({ status: 'GRANTED', claimId: 7, operationId: 9, units: 10n });
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({
      userId: 2,
      bucket: 'AD',
      units: 10n,
      expiresAt: new Date('2026-09-05T00:00:00Z'),
    }));
    expect(completeGrant).toHaveBeenCalledWith(7, 9, at);
  });

  it('does not mint Energy when policy rejects the browser completion claim', async () => {
    const grant = vi.fn();
    const service = new UserRewardedAdService(
      {
        issueNonce: vi.fn(),
        claim: vi.fn(async () => ({
          id: 7,
          userId: 2,
          status: 'REJECTED_POLICY' as const,
          grantOperationId: null,
        })),
        completeGrant: vi.fn(),
      },
      { grant },
      new GoogleAdManagerWebRewardedProvider('1234', '/1234/aftertrace_reward'),
      10n,
      5,
      15,
    );
    await expect(service.claim({
      lineUserId: 'U1',
      nonce: 'server-nonce',
      providerEventId: 'browser-event-1',
    })).resolves.toEqual({ status: 'POLICY_REJECTED' });
    expect(grant).not.toHaveBeenCalled();
  });
});
