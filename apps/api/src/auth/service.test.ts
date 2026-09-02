import { describe, expect, it, vi } from 'vitest';
import type { DrizzleWebAuthRepository } from './repository';
import { WebAuthService } from './service';
import { issuePrivateWebEntryToken } from './token';

const secret = '0123456789abcdef0123456789abcdef';
const lineUserId = 'U0123456789abcdef0123456789abcdef';
const now = new Date('2026-09-02T02:30:00.000Z');

function repository(overrides: Partial<Record<keyof DrizzleWebAuthRepository, unknown>> = {}): DrizzleWebAuthRepository {
  return {
    registerEntry: vi.fn(),
    consumeEntry: vi.fn(),
    registerPrivateEntry: vi.fn().mockResolvedValue(true),
    consumePrivateEntry: vi.fn().mockResolvedValue('CONSUMED'),
    listActiveGroups: vi.fn().mockResolvedValue([]),
    listGroupMemories: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DrizzleWebAuthRepository;
}

describe('WebAuthService private worklog entry', () => {
  it('creates a one-time private URL bound to exact user and source ids', async () => {
    const registerPrivateEntry = vi.fn().mockResolvedValue(true);
    const repo = repository({ registerPrivateEntry });
    const service = new WebAuthService(repo, 'unused-line-token', secret);

    const url = await service.createPrivateBotEntry({
      webAppUrl: 'https://web.example.test/records',
      lineUserId,
      userId: 41,
      sourceId: 73,
      at: now,
    });

    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('t')).toBeTruthy();
    expect(parsed.searchParams.get('openExternalBrowser')).toBe('1');
    expect(registerPrivateEntry).toHaveBeenCalledOnce();
    expect(registerPrivateEntry).toHaveBeenCalledWith(expect.objectContaining({
      lineUserId,
      userId: 41,
      sourceId: 73,
      expiresAt: new Date(now.getTime() + 300_000),
    }));
  });

  it('exchanges private entry without calling LINE group membership API', async () => {
    const consumePrivateEntry = vi.fn().mockResolvedValue('CONSUMED');
    const repo = repository({ consumePrivateEntry });
    const fetcher = vi.fn();
    const service = new WebAuthService(repo, 'unused-line-token', secret, fetcher as unknown as typeof fetch);
    const token = await issuePrivateWebEntryToken({
      lineUserId,
      userId: 41,
      sourceId: 73,
      nonce: 'private-entry-nonce',
      secret,
      now,
    });

    const result = await service.exchangeBotEntry(token, now);

    expect(fetcher).not.toHaveBeenCalled();
    expect(consumePrivateEntry).toHaveBeenCalledWith({
      nonce: 'private-entry-nonce',
      lineUserId,
      userId: 41,
      sourceId: 73,
      at: now,
    });
    expect(result).toMatchObject({
      status: 'AUTHORIZED',
      lineUserId,
      entryContext: { type: 'PRIVATE', userId: 41, sourceId: 73 },
    });
  });

  it('rejects a private entry when OA friendship or exact source ownership was revoked', async () => {
    const repo = repository({
      consumePrivateEntry: vi.fn().mockResolvedValue('ACCESS_REVOKED'),
    });
    const service = new WebAuthService(repo, 'unused-line-token', secret, vi.fn() as unknown as typeof fetch);
    const token = await issuePrivateWebEntryToken({
      lineUserId,
      userId: 41,
      sourceId: 73,
      nonce: 'private-entry-nonce',
      secret,
      now,
    });

    await expect(service.exchangeBotEntry(token, now)).resolves.toEqual({ status: 'PRIVATE_ACCESS_REVOKED' });
  });
});
