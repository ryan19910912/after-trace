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
 * Group parser. Group chat must keep an explicit @AFTERTRACE prefix so ordinary
 * conversation can never become a Worklog command by accident.
 */
export function parseWorklogCommand(message: WorklogCommandMessage): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;

  const mention = stripAftertraceMention(message.textContent);
  if (!mention.mentioned) return null;
  return parseCommandBody(mention.body, message.quotedLineMessageId, true);
}

/**
 * LINE OA/private parser. The customer is already talking directly to AFTERTRACE,
 * therefore mentioning the OA itself is not required or expected.
 *
 * Record creation still requires an explicit record verb (for example 記錄 / 幫我記)
 * so greetings or ordinary human-support messages are not silently persisted.
 * History and edit requests are safe to recognize from their strong intent phrases.
 */
export function parseWorklogOaCommand(message: WorklogCommandMessage): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;

  const mention = stripAftertraceMention(message.textContent);
  if (mention.mentioned) return parseCommandBody(mention.body, message.quotedLineMessageId, false);

  const body = message.textContent.trim();
  if (!body) return null;

  if (looksLikeEditRequest(body)) {
    return {
      kind: 'EDIT_REQUEST',
      instruction: body,
      quotedLineMessageId: message.quotedLineMessageId,
    };
  }

  if (looksLikeHistoryRequest(body) || /^(?:查詢|查询|查看|records?)$/i.test(body.replace(/[！!。.]$/, '').trim())) {
    return { kind: 'QUERY', naturalText: /^(?:查詢|查询|查看|records?)$/i.test(body) ? null : body };
  }

  const record = explicitOaRecordBody(body);
  if (record !== null) {
    if (message.quotedLineMessageId) {
      return {
        kind: 'RECORD_QUOTED',
        quotedLineMessageId: message.quotedLineMessageId,
        instruction: record || null,
      };
    }
    return record ? { kind: 'RECORD_TEXT', text: record } : null;
  }

  return null;
}

function parseCommandBody(
  body: string,
  quotedLineMessageId: string | null,
  allowGroupClaim: boolean,
): WorklogCommand | null {
  const normalized = body.replace(/[！!。.]$/, '').trim();
  if (/^(?:查詢|查询|查看|records?)$/i.test(normalized)) {
    return { kind: 'QUERY', naturalText: null };
  }
  if (allowGroupClaim && /^(?:啟用|启用|啟用群組|启用群组|認領|认领|綁定|绑定)$/i.test(normalized)) {
    return { kind: 'CLAIM_GROUP' };
  }

  if (looksLikeEditRequest(body)) {
    return {
      kind: 'EDIT_REQUEST',
      instruction: body,
      quotedLineMessageId,
    };
  }

  if (looksLikeHistoryRequest(body)) {
    return { kind: 'QUERY', naturalText: body };
  }

  if (quotedLineMessageId) {
    return {
      kind: 'RECORD_QUOTED',
      quotedLineMessageId,
      instruction: body || null,
    };
  }

  if (!body) return null;
  return { kind: 'RECORD_TEXT', text: body };
}

function explicitOaRecordBody(text: string): string | null {
  const normalized = text.trim();
  const patterns = [
    /^(?:請|麻煩)?(?:幫我)?(?:記錄|紀錄|記下|記一下|記)\s*[：:,-]?\s*(.*)$/i,
    /^(?:新增|建立)(?:一筆)?(?:紀錄|記錄)?\s*[：:,-]?\s*(.*)$/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return (match[1] ?? '').trim();
  }
  return null;
}

export function looksLikeHistoryRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;

  // Strong lookup/query phrases only. Time words alone (for example "今天去施工")
  // never classify as history because they are common Record content.
  return /(?:查(?:一下|詢|看)?|查詢|查询|搜尋|搜索|找(?:一下|找)?|查看|看看).*(?:紀錄|記錄|資料|歷史|做|發生|工作)?/i.test(value)
    || /(?:做了什麼|做了哪些|做過什麼|發生什麼|發生了什麼|有哪些紀錄|有什麼紀錄|哪些紀錄|最近怎樣|最近如何)[？?]?$/i.test(value)
    || /(?:今天|昨天|這週|本週|上週|這個月|本月|上個月).*(?:做了什麼|做了哪些|發生什麼|發生了什麼)[？?]?$/i.test(value)
    || /(?:目前|現在|最近|當前)?.*(?:進度|狀況|情況|狀態).*(?:如何|怎樣|怎麼樣|怎麼)[？?]?$/i.test(value);
}

export function looksLikeEditRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return /^(?:請|麻煩)?(?:幫我)?(?:把)?(?:這筆|這則|這個)?(?:紀錄|記錄)?\s*(?:改|修改|更正|修正|更新)(?:成|為|一下)?/i.test(value)
    || /(?:幫我改成|幫我修改|請改成|更正成|修正成)/i.test(value);
}
