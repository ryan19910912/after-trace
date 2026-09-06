import { describe, expect, it } from 'vitest';
import { LineGroupSummaryClient } from './group-summary';

describe('LineGroupSummaryClient', () => {
  it('returns LINE-owned group name and optional picture URL', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = new LineGroupSummaryClient('token', async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({
        groupId: 'C-group-1',
        groupName: '晴空案-水電群',
        pictureUrl: 'https://example.test/group.png',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await expect(client.getGroupSummary('C-group-1')).resolves.toEqual({
      status: 'OK',
      groupId: 'C-group-1',
      groupName: '晴空案-水電群',
      pictureUrl: 'https://example.test/group.png',
    });
    expect(calls[0]?.input).toBe('https://api.line.me/v2/bot/group/C-group-1/summary');
    expect(calls[0]?.init?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('accepts a group without a profile picture', async () => {
    const client = new LineGroupSummaryClient('token', async () => new Response(JSON.stringify({
      groupId: 'C-group-1',
      groupName: '晴空案-行銷群',
    }), { status: 200 }));

    await expect(client.getGroupSummary('C-group-1')).resolves.toEqual({
      status: 'OK',
      groupId: 'C-group-1',
      groupName: '晴空案-行銷群',
      pictureUrl: null,
    });
  });

  it('maps LINE 404 to NOT_FOUND without guessing a profile', async () => {
    const client = new LineGroupSummaryClient('token', async () => new Response('', { status: 404 }));
    await expect(client.getGroupSummary('C-group-1')).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  it('fails closed when LINE returns a mismatched group id', async () => {
    const client = new LineGroupSummaryClient('token', async () => new Response(JSON.stringify({
      groupId: 'C-other',
      groupName: '錯誤群組',
    }), { status: 200 }));
    await expect(client.getGroupSummary('C-group-1')).rejects.toThrow('LINE_GROUP_SUMMARY_INVALID_RESPONSE');
  });
});
