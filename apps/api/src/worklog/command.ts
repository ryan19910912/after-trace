export type WorklogCommandMessage = {
  messageType: string;
  textContent: string | null;
  quotedLineMessageId: string | null;
};

export type WorklogCommand =
  | { kind: 'HELP' }
  | { kind: 'CLAIM_GROUP' }
  | { kind: 'RELEASE_GROUP' }
  | { kind: 'NATURAL_TEXT'; text: string; quotedLineMessageId: string | null }
  // Transitional internal variants retained until the old runtimes are removed.
  | { kind: 'QUERY'; naturalText: string | null }
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
 * Only help and GROUP AI responsibility controls are deterministic commands.
 * Every other non-empty `小跡 ...` text goes to the bounded one-call AI interpreter.
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
  const normalized = prefix.body.replace(/[！!。.]$/, '').trim();
  if (!normalized) return null;

  if (/^(?:幫助|帮助|說明|说明|help)$/i.test(normalized)) return { kind: 'HELP' };
  if (/^啟用\s*AI$/iu.test(normalized)) return { kind: 'CLAIM_GROUP' };
  if (/^取消\s*AI$/iu.test(normalized)) return { kind: 'RELEASE_GROUP' };

  return { kind: 'NATURAL_TEXT', text: prefix.body, quotedLineMessageId: message.quotedLineMessageId };
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
