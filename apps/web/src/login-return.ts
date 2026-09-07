const FIXED_RETURN_PATHS = new Set(['/capture', '/ai-search', '/ai-tools', '/ai-task', '/subscription', '/feedback', '/tasks']);
const EXTENSION_ID = /^[a-p]{32}$/;
const CONNECT_NONCE = /^[A-Za-z0-9_-]{16,128}$/;

export function safeLoginReturn(value: string | null): string | null {
  if (!value) return null;
  if (FIXED_RETURN_PATHS.has(value)) return value;

  let url: URL;
  try {
    url = new URL(value, 'https://aftertrace.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://aftertrace.invalid' || url.pathname !== '/extension/connect' || url.hash) return null;

  const extensionId = url.searchParams.get('extensionId')?.trim() ?? '';
  const nonce = url.searchParams.get('nonce')?.trim() ?? '';
  if (!EXTENSION_ID.test(extensionId) || !CONNECT_NONCE.test(nonce)) return null;
  if ([...url.searchParams.keys()].some((key) => key !== 'extensionId' && key !== 'nonce')) return null;

  const params = new URLSearchParams({ extensionId, nonce });
  return `/extension/connect?${params.toString()}`;
}
