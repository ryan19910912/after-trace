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
  const match = trimmed.match(/^@(?:AI|AFTERTRACE)\b[\s,:：-]*/i);
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
  const replyOnly = /^(?:請)?(?:幫我)?(?:把)?(?:這(?:個|則)?\s*)?(?:記住|記一下)(?:吧)?$/;
  if (isReply && replyOnly.test(text)) {
    return {
      kind: 'REMEMBER',
      quotedLineMessageId: message.quotedLineMessageId,
      instruction: null,
    };
  }

  const explicit = text.match(/^(?:請)?(?:幫我)?(?:記住|記一下)[\s,:：-]*(.+)$/);
  const instruction = explicit?.[1]?.trim();
  if (!instruction) return null;

  return {
    kind: 'REMEMBER',
    quotedLineMessageId: message.quotedLineMessageId,
    instruction,
  };
}
