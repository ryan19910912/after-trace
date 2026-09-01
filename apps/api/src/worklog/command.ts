export type WorklogCommandMessage = {
  messageType: string;
  textContent: string | null;
  quotedLineMessageId: string | null;
};

export type WorklogCommand =
  | { kind: 'QUERY' }
  | { kind: 'CLAIM_GROUP' }
  | { kind: 'RECORD_TEXT'; text: string }
  | { kind: 'RECORD_QUOTED'; quotedLineMessageId: string; instruction: string | null };

function stripAftertraceMention(text: string): { mentioned: boolean; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^@AFTERTRACE\b[\s,:：-]*/i);
  if (!match) return { mentioned: false, body: trimmed };
  return { mentioned: true, body: trimmed.slice(match[0].length).trim() };
}

/**
 * Parses only the narrow V1 worklog interaction contract for either group or OA-private
 * LINE messages. The caller decides which commands are valid in the current source.
 *
 * - @AFTERTRACE 查詢 => open scoped PWA records.
 * - @AFTERTRACE 啟用 => explicitly claim/bind an otherwise-unowned group.
 * - @AFTERTRACE <text> => persist that text as a work record.
 * - Reply to an attachment + @AFTERTRACE => persist quoted content.
 *
 * This deliberately does not invoke AI and does not interpret accounting semantics.
 */
export function parseWorklogCommand(message: WorklogCommandMessage): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;

  const mention = stripAftertraceMention(message.textContent);
  if (!mention.mentioned) return null;

  const normalized = mention.body.replace(/[！!。.]$/, '').trim();
  if (/^(?:查詢|查询|查看|records?)$/i.test(normalized)) return { kind: 'QUERY' };
  if (/^(?:啟用|启用|啟用群組|启用群组|認領|认领|綁定|绑定)$/i.test(normalized)) {
    return { kind: 'CLAIM_GROUP' };
  }

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
