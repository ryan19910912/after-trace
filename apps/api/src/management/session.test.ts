import { describe, expect, it, vi } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import type { Database } from '../db/client';
import { LineWebGroupSessionVerifier } from './session';

const SECRET = 'web-auth-secret-web-auth-secret-1234';
const LINE_USER_ID = `U${'1'.repeat(32)}`;
const LINE_GROUP_ID = `C${'2'.repeat(32)}`;

function fakeDb(row: unknown): Database {
  return {
    execute: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
  } as unknown as Database;
}

async function webBearer() {
  return `Bearer ${await issueWebSessionToken({ lineUserId: LINE_USER_ID, secret: SECRET })}`;
}

describe('LineWebGroupSessionVerifier', () => {
  it('verifies the signed web session and confirms current group membership', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ displayName: 'member' }), { status: 200 }),
    );
    const verifier = new LineWebGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      SECRET,
      fetcher,
    );

    await expect(verifier.verify(await webBearer(), LINE_GROUP_ID)).resolves.toEqual({
      status: 'AUTHORIZED',
      session: { groupId: 7, lineGroupId: LINE_GROUP_ID, lineUserId: LINE_USER_ID },
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(`/group/${LINE_GROUP_ID}/member/${LINE_USER_ID}`),
      expect.objectContaining({ headers: { Authorization: 'Bearer bot-token' } }),
    );
  });

  it('rejects an invalid web session', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const verifier = new LineWebGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      SECRET,
      fetcher,
    );

    await expect(verifier.verify('Bearer invalid', LINE_GROUP_ID)).resolves.toEqual({
      status: 'INVALID_USER_TOKEN',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a valid web user who is not currently a member of the group', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 404 }));
    const verifier = new LineWebGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      SECRET,
      fetcher,
    );

    await expect(verifier.verify(await webBearer(), LINE_GROUP_ID)).resolves.toEqual({
      status: 'NOT_GROUP_MEMBER',
    });
  });

  it('does not misclassify LINE rate limits as a membership failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 }));
    const verifier = new LineWebGroupSessionVerifier(
      fakeDb({ id: '7', status: 'ACTIVE' }),
      'bot-token',
      SECRET,
      fetcher,
    );

    await expect(verifier.verify(await webBearer(), LINE_GROUP_ID)).resolves.toEqual({
      status: 'LINE_VERIFICATION_UNAVAILABLE',
    });
  });
});
