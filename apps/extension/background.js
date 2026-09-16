const MENU_ID = 'aftertrace-save-selection';
const AUTH_KEY = 'aftertraceAuth';
const PENDING_CONNECT_KEY = 'aftertracePendingConnectNonce';

const WEB_TO_API = new Map([
  ['https://after-trace-web-dev.after-lab.workers.dev', 'https://after-trace-api-dev.after-lab.workers.dev'],
  ['https://after-trace-web-prod.after-lab.workers.dev', 'https://after-trace-api-prod.after-lab.workers.dev'],
]);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '儲存到 AFTERTRACE',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  await chrome.storage.local.set({
    aftertracePendingCapture: {
      kind: 'SELECTION',
      text: info.selectionText,
      pageTitle: tab?.title ?? null,
      pageUrl: tab?.url ?? null,
      capturedAt: new Date().toISOString(),
    },
  });

  try {
    await chrome.action.openPopup();
  } catch {
    // Some Chrome versions/policies may reject openPopup outside supported user-gesture paths.
    // The pending capture remains in extension storage until the popup loads it.
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void acceptWebSessionHandoff(message, sender)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'EXTENSION_CONNECT_FAILED',
    }));
  return true;
});

async function acceptWebSessionHandoff(message, sender) {
  if (!message || message.type !== 'AFTERTRACE_EXTENSION_CONNECT') {
    throw new Error('EXTENSION_CONNECT_MESSAGE_INVALID');
  }

  const claimedWebAppUrl = origin(message.webAppUrl);
  // externally_connectable in the manifest already restricts which web origins can
  // reach this listener. Some Chrome builds do not expose sender.origin/url here,
  // so use the validated message webAppUrl as the final fallback.
  const senderOrigin = safeOrigin(sender?.origin) ?? safeOrigin(sender?.url) ?? claimedWebAppUrl;
  const expectedApiBaseUrl = senderOrigin ? WEB_TO_API.get(senderOrigin) : null;
  if (!senderOrigin || !expectedApiBaseUrl) throw new Error('EXTENSION_CONNECT_ORIGIN_FORBIDDEN');

  const nonce = text(message.nonce, 128);
  const sessionToken = text(message.sessionToken, 8192);
  const sessionExpiresAt = futureIso(message.sessionExpiresAt, 60 * 60 * 24 * 7);
  const apiBaseUrl = origin(message.apiBaseUrl);
  const webAppUrl = claimedWebAppUrl;
  if (!nonce || !sessionToken || !sessionExpiresAt || !apiBaseUrl || !webAppUrl) {
    throw new Error('EXTENSION_CONNECT_PAYLOAD_INVALID');
  }
  if (webAppUrl !== senderOrigin || apiBaseUrl !== expectedApiBaseUrl) throw new Error('EXTENSION_CONNECT_ENVIRONMENT_MISMATCH');

  const pending = await chrome.storage.session.get(PENDING_CONNECT_KEY);
  if (pending[PENDING_CONNECT_KEY] !== nonce) throw new Error('EXTENSION_CONNECT_NONCE_MISMATCH');

  await chrome.storage.local.set({
    [AUTH_KEY]: {
      sessionToken,
      sessionExpiresAt,
      apiBaseUrl,
      webAppUrl,
      connectedAt: new Date().toISOString(),
    },
  });
  await chrome.storage.session.remove(PENDING_CONNECT_KEY);
}

function safeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

function origin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function futureIso(value, maxFutureSeconds) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const now = Date.now();
  const delta = parsed.getTime() - now;
  if (delta <= 0 || delta > maxFutureSeconds * 1000 + 60_000) return null;
  return parsed.toISOString();
}
