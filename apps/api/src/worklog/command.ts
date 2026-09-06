export type WorklogCommandMessage = {
  messageType: string;
  textContent: string | null;
  quotedLineMessageId: string | null;
};

export type WorklogCommand =
  | { kind: 'QUERY'; naturalText: string | null }
  | { kind: 'HELP' }
  | { kind: 'CLAIM_GROUP' }
  | { kind: 'RELEASE_GROUP' }
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
 * LINE OA and GROUP share one customer-facing command boundary.
 *
 * `幫助` and GROUP AI responsibility controls are deterministic system commands.
 * The remaining legacy parsing branches are transitional compatibility only while the
 * bounded one-call natural-language interpreter is wired into both LINE surfaces.
 */
export function parseWorklogCommand(message: WorklogCommandMessage): WorklogCommand | null {
  return parsePrefixedCommand(message, true);
}

export function parseWorklogOaCommand(message: WorklogCommandMessage): WorklogCommand | null {
  return parsePrefixedCommand(message, false);
}

function parsePrefixedCommand(message: WorklogCommandMessage, allowGroupControl: boolean): WorklogCommand | null {
  if (message.messageType !== 'text' || !message.textContent) return null;
  const prefix = stripBotPrefix(message.textContent);
  if (!prefix.addressed) return null;
  return parseCommandBody(prefix.body, message.quotedLineMessageId, allowGroupControl);
}

function parseCommandBody(
  body: string,
  quotedLineMessageId: string | null,
  allowGroupControl: boolean,
): WorklogCommand | null {
  const normalized = body.replace(/[！!。.]$/, '').trim();

  if (/^(?:幫助|帮助|說明|说明|help)$/i.test(normalized)) return { kind: 'HELP' };
  if (/^啟用\s*AI$/iu.test(normalized)) return allowGroupControl ? { kind: 'CLAIM_GROUP' } : { kind: 'CLAIM_GROUP' };
  if (/^取消\s*AI$/iu.test(normalized)) return allowGroupControl ? { kind: 'RELEASE_GROUP' } : { kind: 'RELEASE_GROUP' };

  // Transitional compatibility while natural-language intent interpretation is being
  // migrated. These are no longer customer-facing fixed commands.
  if (/^今天$/u.test(normalized)) return { kind: 'QUERY', naturalText: '今天' };
  if (/^最近$/u.test(normalized)) return { kind: 'QUERY', naturalText: null };

  const query = normalized.match(/^(?:查詢|查询|查)\s*[：:,-]?\s*(.*)$/iu);
  if (query) return { kind: 'QUERY', naturalText: (query[1] ?? '').trim() || null };

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

  // Temporary fallback until the one-call AI interpreter replaces this branch.
  return { kind: 'RECORD_TEXT', text: body.trim() };
}

export function worklogLineHelpText(): string {
  return [
    `${BOT_NAME} 使用方式`,
    '',
    `直接用自然語言告訴${BOT_NAME}你想做什麼，例如：`,
    `${BOT_NAME} 幫我記一下今天晴空案收了三千清潔費`,
    `${BOT_NAME} 我要查詢一下今天晴空案的內容`,
    `Reply 一筆紀錄後說「${BOT_NAME} 我想把金額改成 2800」`,
    '',
    '固定系統指令：',
    `${BOT_NAME} 幫助`,
    `${BOT_NAME} 啟用 AI`,
    `${BOT_NAME} 取消 AI`,
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
