import type { BufferedGroupMessage } from './events';

export type ExplicitMemoryCommand = {
  kind: 'REMEMBER';
  quotedLineMessageId: string | null;
  instruction: string | null;
};

function stripAiMention(text: string): { text: string; mentioned: boolean } {
  const trimmed = text.trim();
  const match = trimmed.match(/^@(?:AI|AFTERTRACE)\b[\s,:：-]*/i);
  if (!match) return { text: trimmed, mentioned: false };
  return { text: trimmed.slice(match[0].length).trim(), mentioned: true };
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
