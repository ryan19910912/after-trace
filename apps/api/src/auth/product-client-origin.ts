const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/**
 * CORS allowlist helper for authenticated product clients only.
 * Web remains exact-origin. Chrome extension origins must use Chrome's canonical
 * 32-character extension id and still require the normal AFTERTRACE bearer session.
 */
export function allowedProductClientOrigin(
  origin: string | undefined,
  webAppOrigin: string | undefined,
): string | null {
  if (!origin) return null;
  const normalized = origin.trim();
  const web = webAppOrigin?.trim();
  if (web && normalized === web) return normalized;
  return CHROME_EXTENSION_ORIGIN.test(normalized) ? normalized : null;
}
