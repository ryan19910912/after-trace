import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import { parseWorklogCommand, parseWorklogOaCommand, worklogLineHelpText } from './command';

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
  it('routes every non-system 小跡 sentence to the natural interpreter in GROUP and OA', () => {
    expect(parseWorklogCommand(message('小跡 晴空案今天收了三千'))).toEqual({ kind: 'NATURAL_TEXT', text: '晴空案今天收了三千', quotedLineMessageId: null });
    expect(parseWorklogOaCommand(message('小跡 我要查詢一下今天晴空案'))).toEqual({ kind: 'NATURAL_TEXT', text: '我要查詢一下今天晴空案', quotedLineMessageId: null });
    expect(parseWorklogCommand(message('小跡 今天'))).toEqual({ kind: 'NATURAL_TEXT', text: '今天', quotedLineMessageId: null });
    expect(parseWorklogCommand(message('小跡 最近'))).toEqual({ kind: 'NATURAL_TEXT', text: '最近', quotedLineMessageId: null });
    expect(parseWorklogCommand(message('小跡 紀錄一下今天收三千'))).toEqual({ kind: 'NATURAL_TEXT', text: '紀錄一下今天收三千', quotedLineMessageId: null });
  });

  it('accepts natural punctuation after the bot name', () => {
    expect(parseWorklogCommand(message('小跡，晴空案今天收了三千'))).toMatchObject({ kind: 'NATURAL_TEXT', text: '晴空案今天收了三千' });
    expect(parseWorklogCommand(message('小跡：幫我查晴空案'))).toMatchObject({ kind: 'NATURAL_TEXT', text: '幫我查晴空案' });
  });

  it('preserves Reply target context for the interpreter instead of hard-coding edit or record intent', () => {
    expect(parseWorklogCommand(message('小跡 記一下', 'quoted-1'))).toEqual({ kind: 'NATURAL_TEXT', text: '記一下', quotedLineMessageId: 'quoted-1' });
    expect(parseWorklogCommand(message('小跡 我想把金額改成 2800', 'quoted-record-1'))).toEqual({ kind: 'NATURAL_TEXT', text: '我想把金額改成 2800', quotedLineMessageId: 'quoted-record-1' });
  });

  it('keeps only help and GROUP AI responsibility as fixed system commands', () => {
    expect(parseWorklogCommand(message('小跡 幫助'))).toEqual({ kind: 'HELP' });
    expect(parseWorklogCommand(message('小跡 啟用 AI'))).toEqual({ kind: 'CLAIM_GROUP' });
    expect(parseWorklogCommand(message('小跡 取消 AI'))).toEqual({ kind: 'RELEASE_GROUP', text: '取消 AI' });
    expect(parseWorklogCommand(message('小跡 啟用'))).toEqual({ kind: 'NATURAL_TEXT', text: '啟用', quotedLineMessageId: null });

    const help = worklogLineHelpText();
    expect(help).toContain('小跡 啟用 AI');
    expect(help).toContain('小跡 取消 AI');
    expect(help).toContain('自然語言');
  });

  it('lets OA runtime reject group-only AI controls explicitly', () => {
    expect(parseWorklogOaCommand(message('小跡 啟用 AI'))).toEqual({ kind: 'CLAIM_GROUP' });
    expect(parseWorklogOaCommand(message('小跡 取消 AI'))).toEqual({ kind: 'RELEASE_GROUP', text: '取消 AI' });
  });

  it('ignores ordinary chat and retired @AFTERTRACE syntax', () => {
    expect(parseWorklogCommand(message('王先生今天收五千'))).toBeNull();
    expect(parseWorklogCommand(message('@AFTERTRACE 王先生今天收五千'))).toBeNull();
  });
});
