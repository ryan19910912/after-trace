import { describe, expect, it } from 'vitest';
import { LineUserProfileClient } from './user-profile';

describe('LineUserProfileClient', () => {
  it('loads a group member display name from LINE', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const client = new LineUserProfileClient('token', async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get('Authorization') });
      return new Response(JSON.stringify({ userId: 'U1', displayName: 'Ryan Hsu', pictureUrl: 'https://example.test/p.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(client.getGroupMemberProfile('C1', 'U1')).resolves.toEqual({
      userId: 'U1', displayName: 'Ryan Hsu', pictureUrl: 'https://example.test/p.png',
    });
    expect(calls).toEqual([{
      url: 'https://api.line.me/v2/bot/group/C1/member/U1',
      authorization: 'Bearer token',
    }]);
  });

  it('loads a private LINE profile and treats 404 as unavailable', async () => {
    let status = 200;
    const client = new LineUserProfileClient('token', async () => status === 404
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify({ userId: 'U1', displayName: 'Ryan Hsu' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));

    await expect(client.getUserProfile('U1')).resolves.toEqual({ userId: 'U1', displayName: 'Ryan Hsu', pictureUrl: null });
    status = 404;
    await expect(client.getUserProfile('U1')).resolves.toBeNull();
  });

  it('rejects a mismatched LINE user id', async () => {
    const client = new LineUserProfileClient('token', async () => new Response(JSON.stringify({
      userId: 'U2', displayName: 'Someone Else',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(client.getGroupMemberProfile('C1', 'U1')).rejects.toThrow('LINE_USER_PROFILE_INVALID_RESPONSE');
  });
});
