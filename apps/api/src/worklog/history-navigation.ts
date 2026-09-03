export type WorklogHistoryFilters = {
  entityId?: number;
  query?: string;
  from?: string;
  to?: string;
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a bounded natural-language history request into deterministic PWA filters.
 *
 * This is intentionally conservative and provider-free. It is the safety bridge that
 * prevents obvious history requests from being saved as Records while the final
 * provider-backed CREATE/EDIT/HISTORY interpreter is waiting on durable grant/idempotent
 * accounting. It never reads Record history and never composes an answer.
 */
export function historyFiltersFromText(text: string | null, at: Date): WorklogHistoryFilters {
  if (!text?.trim()) return {};
  const value = text.trim();
  const range = resolveRange(value, at);
  const query = historyKeyword(value);
  return {
    ...(query ? { query } : {}),
    ...(range ? { from: range.from, to: range.to } : {}),
  };
}

function resolveRange(text: string, at: Date): { from: string; to: string } | null {
  const now = validDate(at);
  const local = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const todayStart = localMidnightUtc(local);

  if (/今天/.test(text)) return range(todayStart, new Date(todayStart.getTime() + DAY_MS));
  if (/昨天/.test(text)) return range(new Date(todayStart.getTime() - DAY_MS), todayStart);

  const day = local.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const thisWeekStart = new Date(todayStart.getTime() - daysFromMonday * DAY_MS);
  if (/(?:這週|本週)/.test(text)) return range(thisWeekStart, new Date(thisWeekStart.getTime() + 7 * DAY_MS));
  if (/上週/.test(text)) return range(new Date(thisWeekStart.getTime() - 7 * DAY_MS), thisWeekStart);

  const thisMonthStart = taipeiLocalToUtc(local.getUTCFullYear(), local.getUTCMonth(), 1);
  const nextMonthStart = taipeiLocalToUtc(
    local.getUTCMonth() === 11 ? local.getUTCFullYear() + 1 : local.getUTCFullYear(),
    (local.getUTCMonth() + 1) % 12,
    1,
  );
  if (/(?:這個月|本月)/.test(text)) return range(thisMonthStart, nextMonthStart);
  if (/上個月/.test(text)) {
    const previousYear = local.getUTCMonth() === 0 ? local.getUTCFullYear() - 1 : local.getUTCFullYear();
    const previousMonth = (local.getUTCMonth() + 11) % 12;
    return range(taipeiLocalToUtc(previousYear, previousMonth, 1), thisMonthStart);
  }

  if (/(?:最近|近)\s*(?:7|七)\s*天/.test(text)) {
    return range(new Date(now.getTime() - 7 * DAY_MS), now);
  }

  return null;
}

function historyKeyword(text: string): string | null {
  let value = text
    .replace(/[？?！!。,.，、:：]/g, ' ')
    .replace(/(?:今天|昨天|這週|本週|上週|這個月|本月|上個月|最近\s*(?:7|七)\s*天|近\s*(?:7|七)\s*天)/g, ' ')
    .replace(/(?:請|麻煩)?(?:幫我)?(?:查詢|查询|查一下|查看|看看|搜尋|搜索|找一下|找找|查|找)/g, ' ')
    .replace(/(?:做了什麼|做了哪些|做過什麼|發生了什麼|發生什麼|有哪些紀錄|有什麼紀錄|哪些紀錄|最近怎樣|最近如何)/g, ' ')
    .replace(/(?:工作紀錄|工作記錄|紀錄|記錄|歷史|資料)/g, ' ')
    .replace(/(?:這個群組|本群組|群組)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  value = value.replace(/^(?:的|有|是)\s*/, '').replace(/\s*(?:的|有|是)$/g, '').trim();
  if (!value || /^(?:什麼|哪些|有什麼)$/.test(value)) return null;
  return value.slice(0, 200);
}

function localMidnightUtc(local: Date): Date {
  return taipeiLocalToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

function taipeiLocalToUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - TAIPEI_OFFSET_MS);
}

function range(from: Date, to: Date) {
  return { from: from.toISOString(), to: to.toISOString() };
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('history reference time must be valid');
  return new Date(value.getTime());
}
