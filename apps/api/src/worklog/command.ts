export type WorklogCommandMessage = {
  messageType: string;
  textContent: string | null;
  quotedLineMessageId: string | null;
};

export type WorklogCommand =
  | { kind: 'QUERY'; naturalText: string | null }
  | { kind: 'CLAIM_GROUP' }
  | { kind: 'EDIT_REQUEST'; instruction: string; quotedLineMessageId: string | null }
  | { kind: 'RECORD_TEXT'; text: string }
  | { kind: 'RECORD_QUOTED'; quotedLineMessageId: string; instruction: string | null };

function stripAftertraceMention(text: string): { mentioned: boolean; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^@AFTERTRACE\b[\s,:：-]*/i);
  if (!match) return { mentioned: false, body: trimmed };
  return { mentioned: true, body: trimmed.slice(match[0].length).trim() };
}

/**
 * Parses only deterministic/safety-sensitive LINE command boundaries.
 *
 * Natural-language history detection here is deliberately conservative: it exists to
 * prevent obvious lookup requests from being persisted as new Records before the
 * provider-backed intent layer is fully wired to the grant ledger. The actual history
 * result is still a deterministic PWA filter/link, never an AI-composed history answer.
 *
 * Likewise, obvious edit requests are separated before persistence so an edit command
 * cannot accidentally become a new Record. Runtime must require a reliable Reply target
 * before any future LINE AI edit is allowed to mutate data.
 */
export function parseWorklogCommand(message: WorklogCommandMessage): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;

  const mention = stripAftertraceMention(message.textContent);
  if (!mention.mentioned) return null;

  const normalized = mention.body.replace(/[！!。.]$/, '').trim();
  if (/^(?:查詢|查询|查看|records?)$/i.test(normalized)) {
    return { kind: 'QUERY', naturalText: null };
  }
  if (/^(?:啟用|启用|啟用群組|启用群组|認領|认领|綁定|绑定)$/i.test(normalized)) {
    return { kind: 'CLAIM_GROUP' };
  }

  if (looksLikeEditRequest(mention.body)) {
    return {
      kind: 'EDIT_REQUEST',
      instruction: mention.body,
      quotedLineMessageId: message.quotedLineMessageId,
    };
  }

  if (looksLikeHistoryRequest(mention.body)) {
    return { kind: 'QUERY', naturalText: mention.body };
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

export function looksLikeHistoryRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;

  // Strong lookup/query phrases only. Time words alone (for example "今天去施工")
  // never classify as history because they are common Record content.
  return /(?:查(?:一下|詢|看)?|查詢|查询|搜尋|搜索|找(?:一下|找)?|查看|看看).*(?:紀錄|記錄|資料|歷史|做|發生|工作)?/i.test(value)
    || /(?:做了什麼|做了哪些|做過什麼|發生什麼|發生了什麼|有哪些紀錄|有什麼紀錄|哪些紀錄|最近怎樣|最近如何)[？?]?$/i.test(value)
    || /(?:今天|昨天|這週|本週|上週|這個月|本月|上個月).*(?:做了什麼|做了哪些|發生什麼|發生了什麼)[？?]?$/i.test(value);
}

export function looksLikeEditRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return /^(?:請|麻煩)?(?:幫我)?(?:把)?(?:這筆|這則|這個)?(?:紀錄|記錄)?\s*(?:改|修改|更正|修正|更新)(?:成|為|一下)?\b?/i.test(value)
    || /(?:幫我改成|幫我修改|請改成|更正成|修正成)/i.test(value);
}
