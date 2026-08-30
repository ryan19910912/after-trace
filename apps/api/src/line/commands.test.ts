import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from './events';
import { detectExplicitMemoryCommand } from './commands';

function message(text: string, quotedLineMessageId: string | null = null): BufferedGroupMessage {
  return {
    webhookEventId: 'evt-1',
    lineGroupId: 'group-1',
    lineMessageId: 'msg-1',
    quotedLineMessageId,
    lineUserId: 'user-1',
    messageType: 'text',
    textContent: text,
    charCount: text.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-08-29T04:00:00Z'),
    metadata: null,
  };
}

describe('detectExplicitMemoryCommand', () => {
  it('detects an @AFTERTRACE remember instruction', () => {
    expect(detectExplicitMemoryCommand(message('@AFTERTRACE 記住 Amy 不吃香菜'))).toEqual({
      kind: 'REMEMBER',
      quotedLineMessageId: null,
      instruction: 'Amy 不吃香菜',
    });
  });

  it('uses a quoted LINE message as the source when the reply only says 記住', () => {
    expect(detectExplicitMemoryCommand(message('記住', 'quoted-123'))).toEqual({
      kind: 'REMEMBER',
      quotedLineMessageId: 'quoted-123',
      instruction: null,
    });
  });

  it('does not treat ordinary group conversation as a command', () => {
    expect(detectExplicitMemoryCommand(message('記住明天要下雨'))).toBeNull();
  });
});
