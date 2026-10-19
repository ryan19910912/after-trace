export type WorklogTextNormalizationOutput = {
  /** One grounded retrieval/display title for this Record, or null when the input does not support one safely. */
  title: string | null;
  /** Canonical Asia/Taipei day marker encoded as an ISO instant; null when the user expressed no event date. */
  occurredAt: string | null;
  /** Small grounded retrieval terms/synonyms only; never a replacement for durable raw text. */
  searchTerms: string[];
};

export type WorklogAiRuntimeConfigSnapshot = {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  audioUsdPerMillion: number | null;
  imageUsdPerMillion: number | null;
  usdTwdRate: number | null;
};

export type WorklogTextProviderInput = {
  text: string;
  /** Explicit reference timestamp used only to resolve relative date language. */
  referenceOccurredAt: string;
};

export type WorklogTextProviderResponse = {
  output: WorklogTextNormalizationOutput;
  inputTokens: number;
  /** Billed output, including thinking/reasoning when the provider bills it as output. */
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

/** Provider contract shared by target Web/PWA/Extension AI text capture. */
export interface WorklogTextNormalizationProvider {
  reservationPoints(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  normalize(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogTextProviderResponse>;
}

export function normalizeWorklogTextOutput(value: unknown): WorklogTextNormalizationOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI text interpretation output must be an object');
  }
  const row = value as Record<string, unknown>;
  const title = optionalText(row.title, 'title', 255);
  const occurredAt = optionalDayMarker(
    row.occurredAt ?? row.occurred_at ?? row.occurredOn ?? row.occurred_on,
    'occurredAt',
  );
  const searchTerms = searchTermsValue(row.searchTerms ?? row.search_terms);
  return { title, occurredAt, searchTerms };
}

/** Converts YYYY-MM-DD or an RFC3339 value to the canonical Taipei day-start instant. */
function optionalDayMarker(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return taipeiDayStartIso(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), label);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${label}`);
  const taipei = new Date(parsed.getTime() + 8 * 60 * 60 * 1000);
  return taipeiDayStartIso(taipei.getUTCFullYear(), taipei.getUTCMonth() + 1, taipei.getUTCDate(), label);
}

function taipeiDayStartIso(year: number, month: number, day: number, label: string): string {
  const utc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 8 * 60 * 60 * 1000);
  const roundTrip = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() + 1 !== month
    || roundTrip.getUTCDate() !== day
  ) throw new Error(`invalid ${label}`);
  return utc.toISOString();
}

function searchTermsValue(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('searchTerms must be an array');
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('searchTerms items must be text');
    const normalized = item.trim();
    if (!normalized) continue;
    if (normalized.length > 64) throw new Error('searchTerms item is too long');
    const key = normalized.toLocaleLowerCase('zh-TW');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= 12) break;
  }
  return result;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid ${label}`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(value, label, max);
}
