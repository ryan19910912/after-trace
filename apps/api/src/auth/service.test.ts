import { describe, expect, it, vi } from 'vitest';
import type { DrizzleWebAuthRepository } from './repository';
import { WebAuthService } from './service';
import { issuePrivateWebEntryToken, issueWebEntryToken } from './token';

const secret = '0123456789abcdef0123456789abcdef';
const lineUserId = 'U0123456789abcdef0123456789abcdef';
const lineGroupId = 'C0123456789abcdef0123456789abcdef';
const now = new Date('2026-09-02T02:30:00.000Z');

function repository(overrides: Partial<Record<keyof DrizzleWebAuthRepository, unknown>> = {}): DrizzleWebAuthRepository {
  return {
    registerEntry: vi.fn().mockResolvedValue(true),
    consumeEntry: vi.fn().mockResolvedValue(true),
    registerPrivateEntry: vi.fn().mockResolvedValue(true),
    consumePrivateEntry: vi.fn().mockResolvedValue('CONSUMED'),
    ...overrides,
  } as unknown as DrizzleWebAuthRepository;
}

describe('WebAuthService Worklog entry', () => {
  it('creates a one-time private URL bound to exact user and source ids', async () => {
    const registerPrivateEntry = vi.fn().mockResolvedValue(true);
    const service = new WebAuthService(repository({ registerPrivateEntry }), 'unused-line-token', secret);
    const url = await service.createPrivateBotEntry({
      webAppUrl: 'https://web.example.test/records', lineUserId, userId: 41, sourceId: 73, at: now,
    });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('t')).toBeTruthy();
    expect(parsed.searchParams.get('openExternalBrowser')).toBe('1');
    expect(registerPrivateEntry).toHaveBeenCalledWith(expect.objectContaining({
      lineUserId, userId: 41, sourceId: 73, expiresAt: new Date(now.getTime() + 300_000),
    }));
  });

  it('exchanges private entry without calling LINE group membership API', async () => {
    const consumePrivateEntry = vi.fn().mockResolvedValue('CONSUMED');
    const fetcher = vi.fn();
    const service = new WebAuthService(repository({ consumePrivateEntry }), 'unused-line-token', secret, fetcher as unknown as typeof fetch);
    const token = await issuePrivateWebEntryToken({
      lineUserId, userId: 41, sourceId: 73, nonce: 'private-entry-nonce', secret, now,
    });
    const result = await service.exchangeBotEntry(token, now);
    expect(fetcher).not.toHaveBeenCalled();
    expect(consumePrivateEntry).toHaveBeenCalledWith({ nonce: 'private-entry-nonce', lineUserId, userId: 41, sourceId: 73, at: now });
    expect(result).toMatchObject({ status: 'AUTHORIZED', lineUserId, entryContext: { type: 'PRIVATE', userId: 41, sourceId: 73 } });
  });

  it('rejects a private entry when OA friendship or exact source ownership was revoked', async () => {
    const service = new WebAuthService(
      repository({ consumePrivateEntry: vi.fn().mockResolvedValue('ACCESS_REVOKED') }),
      'unused-line-token',
      secret,
      vi.fn() as unknown as typeof fetch,
    );
    const token = await issuePrivateWebEntryToken({
      lineUserId, userId: 41, sourceId: 73, nonce: 'private-entry-nonce', secret, now,
    });
    await expect(service.exchangeBotEntry(token, now)).resolves.toEqual({ status: 'PRIVATE_ACCESS_REVOKED' });
  });

  it('exchanges a group entry only after LINE confirms exact current membership', async () => {
    const consumeEntry = vi.fn().mockResolvedValue(true);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: lineUserId, displayName: 'Ryan' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const service = new WebAuthService(repository({ consumeEntry }), 'line-token', secret, fetcher as unknown as typeof fetch);
    const token = await issueWebEntryToken({
      lineUserId, lineGroupId, nonce: 'group-entry-nonce', secret, now,
    });
    const result = await service.exchangeBotEntry(token, now);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(consumeEntry).toHaveBeenCalledWith({ nonce: 'group-entry-nonce', lineUserId, lineGroupId, at: now });
    expect(result).toMatchObject({ status: 'AUTHORIZED', lineUserId, entryContext: { type: 'GROUP', lineGroupId } });
  });

  it('does not consume a group entry when LINE says the user is no longer a member', async () => {
    const consumeEntry = vi.fn().mockResolvedValue(true);
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const service = new WebAuthService(repository({ consumeEntry }), 'line-token', secret, fetcher as unknown as typeof fetch);
    const token = await issueWebEntryToken({
      lineUserId, lineGroupId, nonce: 'group-entry-nonce', secret, now,
    });
    await expect(service.exchangeBotEntry(token, now)).resolves.toEqual({ status: 'NOT_GROUP_MEMBER' });
    expect(consumeEntry).not.toHaveBeenCalled();
  });
});
