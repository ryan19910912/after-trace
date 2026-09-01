import type { BufferedGroupMessage } from '../line/events';

export type WorklogCommand =
  | { kind: 'QUERY' }
  | { kind: 'RECORD_TEXT'; text: string }
  | { kind: 'RECORD_QUOTED'; quotedLineMessageId: string; instruction: string | null };

function stripAftertraceMention(text: string): { mentioned: boolean; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^@AFTERTRACE\b[\s,:：-]*/i);
  if (!match) return { mentioned: false, body: trimmed };
  return { mentioned: true, body: trimmed.slice(match[0].length).trim() };
}

/**
 * Parses only the narrow V1 worklog interaction contract.
 *
 * - @AFTERTRACE 查詢 => open current group's PWA records.
 * - @AFTERTRACE <text> => persist that text as a work record.
 * - Reply to an attachment + @AFTERTRACE => persist quoted content.
 *
 * This deliberately does not invoke AI and does not interpret accounting semantics.
 */
export function parseWorklogCommand(message: BufferedGroupMessage): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;

  const mention = stripAftertraceMention(message.textContent);
  if (!mention.mentioned) return null;

  const normalized = mention.body.replace(/[！!。.]$/, '').trim();
  if (/^(?:查詢|查询|查看|records?)$/i.test(normalized)) return { kind: 'QUERY' };

  if (message.quotedLineMessageId) {
    return {
      kind: 'RECORD_QUOTED',
      quotedLineMessageId: message.quotedLineMessageId,
      instruction: mention.body || null,
    };
  }

  if (!mention.body) return null;
  return { kind: 'RECORD_TEXT', text: mention.body };
}
