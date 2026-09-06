import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import { parseWorklogCommand, parseWorklogOaCommand } from './command';

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

describe('小跡 LINE command parser', () => {
  it('uses the same prefix contract in GROUP and OA', () => {
    expect(parseWorklogCommand(message('小跡 晴空案今天收了三千'))).toEqual({ kind: 'RECORD_TEXT', text: '晴空案今天收了三千' });
    expect(parseWorklogOaCommand(message('小跡 晴空案今天收了三千'))).toEqual({ kind: 'RECORD_TEXT', text: '晴空案今天收了三千' });
  });

  it('accepts natural punctuation after the bot name', () => {
    expect(parseWorklogCommand(message('小跡，晴空案今天收了三千'))).toEqual({ kind: 'RECORD_TEXT', text: '晴空案今天收了三千' });
    expect(parseWorklogCommand(message('小跡：晴空案今天收了三千'))).toEqual({ kind: 'RECORD_TEXT', text: '晴空案今天收了三千' });
  });

  it('requires an explicit query verb so work facts default to Record', () => {
    expect(parseWorklogCommand(message('小跡 晴空案目前收款進度如何'))).toEqual({ kind: 'RECORD_TEXT', text: '晴空案目前收款進度如何' });
    expect(parseWorklogCommand(message('小跡 查 晴空案目前收款進度如何'))).toEqual({ kind: 'QUERY', naturalText: '晴空案目前收款進度如何' });
    expect(parseWorklogCommand(message('小跡 查詢 晴空案收款'))).toEqual({ kind: 'QUERY', naturalText: '晴空案收款' });
  });

  it('supports today, recent and help shortcuts', () => {
    expect(parseWorklogCommand(message('小跡 今天'))).toEqual({ kind: 'QUERY', naturalText: '今天' });
    expect(parseWorklogCommand(message('小跡 最近'))).toEqual({ kind: 'QUERY', naturalText: null });
    expect(parseWorklogCommand(message('小跡 幫助'))).toEqual({ kind: 'HELP' });
  });

  it('records Reply content only with an explicit 記 command', () => {
    expect(parseWorklogCommand(message('小跡 記', 'quoted-1'))).toEqual({
      kind: 'RECORD_QUOTED',
      quotedLineMessageId: 'quoted-1',
      instruction: null,
    });
  });

  it('keeps Reply edit target deterministic', () => {
    expect(parseWorklogCommand(message('小跡 幫我改成 2800', 'quoted-record-1'))).toEqual({
      kind: 'EDIT_REQUEST',
      instruction: '幫我改成 2800',
      quotedLineMessageId: 'quoted-record-1',
    });
  });

  it('supports explicit group AI responsibility claim', () => {
    expect(parseWorklogCommand(message('小跡 啟用'))).toEqual({ kind: 'CLAIM_GROUP' });
  });

  it('ignores ordinary chat and the retired @AFTERTRACE syntax', () => {
    expect(parseWorklogCommand(message('王先生今天收五千'))).toBeNull();
    expect(parseWorklogCommand(message('@AFTERTRACE 王先生今天收五千'))).toBeNull();
  });
});
