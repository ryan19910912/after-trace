import type { BufferedGroupMessage } from './events';

export type ExplicitMemoryCommand = {
  kind: 'REMEMBER';
  quotedLineMessageId: string | null;
  instruction: string | null;
};

export type DeterministicAiCommand =
  | { kind: 'ENERGY_STATUS' }
  | { kind: 'HELP' }
  | { kind: 'PLANS' };

function stripAiMention(text: string): { text: string; mentioned: boolean } {
  const trimmed = text.trim();
  const match = trimmed.match(/^@AFTERTRACE\b[\s,:：-]*/i);
  if (!match) return { text: trimmed, mentioned: false };
  return { text: trimmed.slice(match[0].length).trim(), mentioned: true };
}

export function detectDeterministicAiCommand(
  message: BufferedGroupMessage,
): DeterministicAiCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;
  const stripped = stripAiMention(message.textContent);
  if (!stripped.mentioned) return null;
  const text = stripped.text.replace(/[！!。.]$/, '').trim();
  if (/^(?:額度|energy|餘額|余额)$/i.test(text)) return { kind: 'ENERGY_STATUS' };
  if (/^(?:幫助|帮助|help|說明|说明)$/i.test(text)) return { kind: 'HELP' };
  if (/^(?:方案|plans?|pricing)$/i.test(text)) return { kind: 'PLANS' };
  return null;
}

export function isAiMention(message: BufferedGroupMessage): boolean {
  return (
    message.messageType === 'text' &&
    !!message.textContent &&
    stripAiMention(message.textContent).mentioned
  );
}

export function detectExplicitMemoryCommand(
  message: BufferedGroupMessage,
): ExplicitMemoryCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;

  const stripped = stripAiMention(message.textContent);
  const isReply = message.quotedLineMessageId !== null;
  if (!stripped.mentioned && !isReply) return null;

  const text = stripped.text.replace(/[！!。.]$/, '').trim();
  const captureVerb = '(?:記住|記一下|記錄(?:一下|起來)?|紀錄(?:一下|起來)?|存一下|保存(?:一下|起來)?)';
  const replyOnly = new RegExp(`^(?:請)?(?:幫我)?(?:把)?(?:這(?:個|則|張)?\\s*)?${captureVerb}(?:吧)?$`);
  if (isReply && replyOnly.test(text)) {
    return {
      kind: 'REMEMBER',
      quotedLineMessageId: message.quotedLineMessageId,
      instruction: null,
    };
  }

  const explicit = new RegExp(`^(?:請)?(?:幫我)?(?:把)?${captureVerb}[\\s,:：-]*(.*)$`).exec(text);
  const trailing = explicit?.[1]?.trim();
  if (explicit) {
    return {
      kind: 'REMEMBER',
      quotedLineMessageId: message.quotedLineMessageId,
      instruction: trailing || null,
    };
  }

  const natural = /^(?:請)?幫我(?:把)?(.+?)(?:記住|記一下|記錄一下|紀錄一下|記錄起來|紀錄起來|存一下|保存一下|保存起來)(?:吧)?$/.exec(text);
  if (natural?.[1]?.trim()) {
    return {
      kind: 'REMEMBER',
      quotedLineMessageId: message.quotedLineMessageId,
      instruction: natural[1].trim(),
    };
  }

  return null;
}
