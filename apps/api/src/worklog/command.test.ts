import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import { parseWorklogCommand } from './command';

function message(textContent: string, quotedLineMessageId: string | null = null): BufferedGroupMessage {
  return {
    webhookEventId: 'event-1',
    replyToken: 'reply-1',
    lineGroupId: 'group-1',
    lineMessageId: 'message-1',
    quotedLineMessageId,
    lineUserId: 'user-1',
    messageType: 'text',
    textContent,
    charCount: textContent.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-09-02T00:00:00+08:00'),
    metadata: null,
  };
}

describe('parseWorklogCommand', () => {
  it('opens PWA records with 查詢', () => {
    expect(parseWorklogCommand(message('@AFTERTRACE 查詢'))).toEqual({ kind: 'QUERY' });
  });

  it('supports an explicit group owner claim instead of guessing ownership', () => {
    expect(parseWorklogCommand(message('@AFTERTRACE 啟用'))).toEqual({ kind: 'CLAIM_GROUP' });
    expect(parseWorklogCommand(message('@AFTERTRACE 認領'))).toEqual({ kind: 'CLAIM_GROUP' });
  });

  it('records mention text without asking user to type 紀錄', () => {
    expect(parseWorklogCommand(message('@AFTERTRACE 三重王先生二樓漏水已修復，三樓缺料下次處理'))).toEqual({
      kind: 'RECORD_TEXT',
      text: '三重王先生二樓漏水已修復，三樓缺料下次處理',
    });
  });

  it('records quoted content when mention replies to an earlier message', () => {
    expect(parseWorklogCommand(message('@AFTERTRACE', 'quoted-audio-1'))).toEqual({
      kind: 'RECORD_QUOTED',
      quotedLineMessageId: 'quoted-audio-1',
      instruction: null,
    });
  });

  it('keeps optional instruction beside quoted content', () => {
    expect(parseWorklogCommand(message('@AFTERTRACE 王先生現場問題', 'quoted-image-1'))).toEqual({
      kind: 'RECORD_QUOTED',
      quotedLineMessageId: 'quoted-image-1',
      instruction: '王先生現場問題',
    });
  });

  it('ignores ordinary group chat', () => {
    expect(parseWorklogCommand(message('王先生今天收五千'))).toBeNull();
  });
});
