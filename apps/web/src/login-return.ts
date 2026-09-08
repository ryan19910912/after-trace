import { aiTaskDeepLinkFromSearch, aiTaskDeepLinkUrl } from './ai-task-deep-link';
import { aiToolsDeepLinkFromSearch, aiToolsDeepLinkUrl } from './ai-tools-deep-link';

const FIXED_RETURN_PATHS = new Set(['/capture', '/ai-search', '/ai-tools', '/ai-task', '/subscription', '/feedback', '/tasks']);
const EXTENSION_ID = /^[a-p]{32}$/;
const CONNECT_NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const TASK_DETAIL_PATH = /^\/tasks\/([1-9]\d*)\/?$/;

export function safeLoginReturn(value: string | null): string | null {
  if (!value) return null;
  if (FIXED_RETURN_PATHS.has(value)) return value;

  let url: URL;
  try {
    url = new URL(value, 'https://aftertrace.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://aftertrace.invalid' || url.hash) return null;

  const taskMatch = TASK_DETAIL_PATH.exec(url.pathname);
  if (taskMatch && !url.search) {
    const id = Number(taskMatch[1]);
    return Number.isSafeInteger(id) && id > 0 ? `/tasks/${id}` : null;
  }

  if (url.pathname === '/ai-tools') {
    const deepLink = aiToolsDeepLinkFromSearch(url.search);
    return deepLink ? aiToolsDeepLinkUrl(deepLink) : null;
  }

  if (url.pathname === '/ai-task') {
    const deepLink = aiTaskDeepLinkFromSearch(url.search);
    return deepLink ? aiTaskDeepLinkUrl(deepLink) : null;
  }

  if (url.pathname !== '/extension/connect') return null;

  const extensionId = url.searchParams.get('extensionId')?.trim() ?? '';
  const nonce = url.searchParams.get('nonce')?.trim() ?? '';
  if (!EXTENSION_ID.test(extensionId) || !CONNECT_NONCE.test(nonce)) return null;
  if ([...url.searchParams.keys()].some((key) => key !== 'extensionId' && key !== 'nonce')) return null;

  const params = new URLSearchParams({ extensionId, nonce });
  return `/extension/connect?${params.toString()}`;
}
