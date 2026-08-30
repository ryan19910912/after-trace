import { describe, expect, it, vi } from 'vitest';
import { ExplicitMemoryRequestService, type MemoryRequestRepository } from './requests';

describe('ExplicitMemoryRequestService', () => {
  it('uses the quoted message as the source for reply-based remember commands', async () => {
    const createExplicit = vi.fn(async () => ({
      id: 1,
      status: 'PENDING' as const,
      sourceLineMessageId: 'quoted-1',
    }));
    const repository: MemoryRequestRepository = { createExplicit };
    const service = new ExplicitMemoryRequestService(repository);
    const at = new Date('2026-08-29T03:00:00Z');

    await service.enqueue(
      9,
      { lineMessageId: 'command-1', lineUserId: 'U1', lineTimestamp: at },
      { quotedLineMessageId: 'quoted-1', instruction: '幫我記錄一下', preferRecentImage: true },
    );

    expect(createExplicit).toHaveBeenCalledWith({
      groupId: 9,
      requestLineMessageId: 'command-1',
      actorLineUserId: 'U1',
      sourceLineMessageId: 'quoted-1',
      instruction: '幫我記錄一下',
      preferRecentImage: false,
      createdAt: at,
    });
  });

  it('uses the command message as source for text capture', async () => {
    const createExplicit = vi.fn(async () => ({
      id: 2,
      status: 'PENDING' as const,
      sourceLineMessageId: 'command-2',
    }));
    const service = new ExplicitMemoryRequestService({ createExplicit });

    await service.enqueue(
      9,
      { lineMessageId: 'command-2', lineUserId: 'U1', lineTimestamp: new Date() },
      { quotedLineMessageId: null, instruction: '幫我記住明天要去台南', preferRecentImage: false },
    );

    expect(createExplicit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLineMessageId: 'command-2',
        instruction: '幫我記住明天要去台南',
        preferRecentImage: false,
      }),
    );
  });

  it('uses the AI router decision to prefer a recent image when there is no quoted message', async () => {
    const createExplicit = vi.fn(async () => ({
      id: 3,
      status: 'PENDING' as const,
      sourceLineMessageId: 'image-before-command',
    }));
    const service = new ExplicitMemoryRequestService({ createExplicit });

    await service.enqueue(
      9,
      { lineMessageId: 'command-3', lineUserId: 'U1', lineTimestamp: new Date() },
      { quotedLineMessageId: null, instruction: '幫我把這張行程圖記起來', preferRecentImage: true },
    );

    expect(createExplicit).toHaveBeenCalledWith(
      expect.objectContaining({ preferRecentImage: true, instruction: '幫我把這張行程圖記起來' }),
    );
  });
});
