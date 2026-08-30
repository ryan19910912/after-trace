import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from './events';
import { aiMentionText, detectDeterministicAiCommand, isAiMention } from './commands';

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

describe('LINE AI commands', () => {
  it('keeps zero-ambiguity commands deterministic', () => {
    expect(detectDeterministicAiCommand(message('@AFTERTRACE 額度'))).toEqual({ kind: 'ENERGY_STATUS' });
    expect(detectDeterministicAiCommand(message('@AFTERTRACE 幫助'))).toEqual({ kind: 'HELP' });
    expect(detectDeterministicAiCommand(message('@AFTERTRACE 方案'))).toEqual({ kind: 'PLANS' });
  });

  it('does not classify natural-language intent in code', () => {
    expect(detectDeterministicAiCommand(message('@AFTERTRACE 幫我記錄一下'))).toBeNull();
    expect(detectDeterministicAiCommand(message('@AFTERTRACE 明天提醒我看醫生'))).toBeNull();
    expect(detectDeterministicAiCommand(message('@AFTERTRACE 這間我們去過嗎'))).toBeNull();
  });

  it('exposes the natural text for the AI router', () => {
    const input = message('@AFTERTRACE 幫我記錄一下', 'quoted-1');
    expect(isAiMention(input)).toBe(true);
    expect(aiMentionText(input)).toBe('幫我記錄一下');
    expect(isAiMention(message('普通群組聊天'))).toBe(false);
  });
});
