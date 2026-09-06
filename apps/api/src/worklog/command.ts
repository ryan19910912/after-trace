export type WorklogCommandMessage = {
  messageType: string;
  textContent: string | null;
  quotedLineMessageId: string | null;
};

export type WorklogCommand =
  | { kind: 'QUERY'; naturalText: string | null }
  | { kind: 'HELP' }
  | { kind: 'CLAIM_GROUP' }
  | { kind: 'EDIT_REQUEST'; instruction: string; quotedLineMessageId: string | null }
  | { kind: 'RECORD_TEXT'; text: string }
  | { kind: 'RECORD_QUOTED'; quotedLineMessageId: string; instruction: string | null };

const BOT_NAME = '小跡';

function stripBotPrefix(text: string): { addressed: boolean; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^小跡(?:\s*[,，:：-]\s*|\s+|$)/u);
  if (!match) return { addressed: false, body: trimmed };
  return { addressed: true, body: trimmed.slice(match[0].length).trim() };
}

/**
 * LINE OA and GROUP share one customer-facing command language.
 * A command must start with the Chinese bot name `小跡`; this avoids LINE @mention UI
 * conflicts and prevents ordinary conversation from becoming a Worklog operation.
 */
export function parseWorklogCommand(message: WorklogCommandMessage): WorklogCommand | null {
  return parsePrefixedCommand(message, true);
}

export function parseWorklogOaCommand(message: WorklogCommandMessage): WorklogCommand | null {
  return parsePrefixedCommand(message, false);
}

function parsePrefixedCommand(message: WorklogCommandMessage, allowGroupClaim: boolean): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;
  const prefix = stripBotPrefix(message.textContent);
  if (!prefix.addressed) return null;
  return parseCommandBody(prefix.body, message.quotedLineMessageId, allowGroupClaim);
}

function parseCommandBody(
  body: string,
  quotedLineMessageId: string | null,
  allowGroupClaim: boolean,
): WorklogCommand | null {
  const normalized = body.replace(/[！!。.]$/, '').trim();

  if (/^(?:幫助|帮助|說明|说明|help)$/i.test(normalized)) return { kind: 'HELP' };
  if (/^今天$/u.test(normalized)) return { kind: 'QUERY', naturalText: '今天' };
  if (/^最近$/u.test(normalized)) return { kind: 'QUERY', naturalText: null };

  const query = normalized.match(/^(?:查詢|查询|查)\s*[：:,-]?\s*(.*)$/iu);
  if (query) return { kind: 'QUERY', naturalText: (query[1] ?? '').trim() || null };

  if (allowGroupClaim && /^(?:啟用|启用|啟用群組|启用群组|認領|认领|綁定|绑定)$/iu.test(normalized)) {
    return { kind: 'CLAIM_GROUP' };
  }

  if (looksLikeEditRequest(body)) {
    return {
      kind: 'EDIT_REQUEST',
      instruction: body,
      quotedLineMessageId,
    };
  }

  if (quotedLineMessageId) {
    const quoted = normalized.match(/^(?:記|記錄|紀錄)(?:\s*[：:,-]?\s*(.*))?$/u);
    if (quoted) {
      return {
        kind: 'RECORD_QUOTED',
        quotedLineMessageId,
        instruction: (quoted[1] ?? '').trim() || null,
      };
    }
  }

  const explicitRecord = normalized.match(/^(?:記錄|紀錄|記下|記一下)\s*[：:,-]?\s*(.*)$/u);
  if (explicitRecord) {
    const text = (explicitRecord[1] ?? '').trim();
    if (!text) return null;
    return { kind: 'RECORD_TEXT', text };
  }

  if (!normalized) return null;

  // `小跡 <內容>` is intentionally the shortest common path and defaults to Record.
  // Query must be explicit (`小跡 查 ...`) so a work fact is never silently reclassified.
  return { kind: 'RECORD_TEXT', text: body.trim() };
}

export function worklogLineHelpText(): string {
  return [
    `${BOT_NAME} 使用方式`,
    '',
    `${BOT_NAME} 晴空案今天收了三千`,
    '→ 記錄一件事',
    '',
    `${BOT_NAME} 查 晴空案收款`,
    '→ 查詢相關紀錄',
    '',
    `${BOT_NAME} 今天`,
    '→ 查看今天的紀錄',
    '',
    `${BOT_NAME} 最近`,
    '→ 查看最近紀錄',
    '',
    `Reply 一則訊息後輸入「${BOT_NAME} 記」`,
    '→ 記錄被 Reply 的內容',
  ].join('\n');
}

export function looksLikeHistoryRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
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
