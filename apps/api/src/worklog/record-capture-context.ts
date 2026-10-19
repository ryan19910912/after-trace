export type RecordCaptureContext = {
  client: 'CHROME_EXTENSION';
  page: {
    title: string | null;
    url: string | null;
  };
};

export type RecordCaptureContextParseResult = RecordCaptureContext | null | 'INVALID';

const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const CAPTURE_CONTEXT_KEYS = new Set(['page']);
const PAGE_KEYS = new Set(['title', 'url']);

/**
 * Manual Record capture metadata is intentionally narrow.
 *
 * V1 accepts only explicit Chrome-extension current-page context. The client type is
 * derived from the authenticated product Origin rather than trusted from request JSON.
 * Arbitrary metadata is rejected so this field does not become an unbounded extension
 * storage surface or a backdoor for silently archiving page content.
 */
export function parseRecordCaptureContext(
  value: unknown,
  requestOrigin: string | undefined,
): RecordCaptureContextParseResult {
  if (value == null) return null;
  if (!isPlainObject(value)) return 'INVALID';
  if (!isChromeExtensionOrigin(requestOrigin)) return 'INVALID';
  if (!onlyKeys(value, CAPTURE_CONTEXT_KEYS)) return 'INVALID';

  const page = value.page;
  if (!isPlainObject(page) || !onlyKeys(page, PAGE_KEYS)) return 'INVALID';

  const title = optionalPageTitle(page.title);
  if (title === 'INVALID') return 'INVALID';
  const url = optionalPageUrl(page.url);
  if (url === 'INVALID') return 'INVALID';
  if (!title && !url) return 'INVALID';

  return {
    client: 'CHROME_EXTENSION',
    page: { title, url },
  };
}

export function isChromeExtensionOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && CHROME_EXTENSION_ORIGIN.test(origin.trim());
}

function optionalPageTitle(value: unknown): string | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'INVALID';
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized && normalized.length <= 255 ? normalized : 'INVALID';
}

function optionalPageUrl(value: unknown): string | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'INVALID';
  const normalized = value.trim();
  if (!normalized || normalized.length > 2048 || /[\u0000-\u001f\u007f]/.test(normalized)) return 'INVALID';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'INVALID';
    if (parsed.username || parsed.password) return 'INVALID';
    return normalized;
  } catch {
    return 'INVALID';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
