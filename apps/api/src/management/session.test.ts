import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client';
import { LineLiffGroupSessionVerifier } from './session';

function fakeDb(row: unknown): Database {
  return {
    execute: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
  } as unknown as Database;
}

describe('LineLiffGroupSessionVerifier', () => {
  it('verifies the LIFF channel, derives the LINE user and confirms current group membership', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: '1234567890', expires_in: 3600 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: 'U-real' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ displayName: 'member' }), { status: 200 }));
    const verifier = new LineLiffGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      '1234567890',
      fetcher,
    );

    await expect(verifier.verify('Bearer user-token', 'C-group')).resolves.toEqual({
      status: 'AUTHORIZED',
      session: { groupId: 7, lineGroupId: 'C-group', lineUserId: 'U-real' },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/oauth2/v2.1/verify?access_token=user-token'),
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.stringContaining('/group/C-group/member/U-real'),
      expect.objectContaining({ headers: { Authorization: 'Bearer bot-token' } }),
    );
  });

  it('rejects access tokens issued for a different LIFF channel', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: 'other-channel', expires_in: 3600 }), { status: 200 }),
    );
    const verifier = new LineLiffGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      'expected-channel',
      fetcher,
    );

    await expect(verifier.verify('Bearer user-token', 'C-group')).resolves.toEqual({
      status: 'WRONG_LIFF_CHANNEL',
    });
  });

  it('rejects a valid LINE user who is not currently a member of the group', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: '1234567890', expires_in: 3600 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: 'U-real' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const verifier = new LineLiffGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      '1234567890',
      fetcher,
    );

    await expect(verifier.verify('Bearer user-token', 'C-group')).resolves.toEqual({
      status: 'NOT_GROUP_MEMBER',
    });
  });

  it('does not misclassify LINE rate limits as a membership failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 }));
    const verifier = new LineLiffGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      '1234567890',
      fetcher,
    );

    await expect(verifier.verify('Bearer user-token', 'C-group')).resolves.toEqual({
      status: 'LINE_VERIFICATION_UNAVAILABLE',
    });
  });
});
