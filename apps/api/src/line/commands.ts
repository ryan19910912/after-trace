import type { BufferedGroupMessage } from './events';

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
  return aiMentionText(message) !== null;
}

export function aiMentionText(message: BufferedGroupMessage): string | null {
  if (message.messageType !== 'text' || !message.textContent) return null;
  const stripped = stripAiMention(message.textContent);
  return stripped.mentioned ? stripped.text : null;
}
