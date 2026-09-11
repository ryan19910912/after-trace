self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// AFTERTRACE intentionally does not cache authenticated Record/API responses here.
// Offline data policy can be added later only with explicit product/security rules.

self.addEventListener('push', (event) => {
  event.waitUntil(showAftertracePush(event));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openAftertraceNotification(event.notification.data));
});

async function showAftertracePush(event) {
  const payload = parsePushPayload(event.data);
  if (!payload) return;
  const deepLink = safeRelativePath(payload.deepLink);
  await self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag || `aftertrace-${payload.notificationId || 'notification'}`,
    icon: '/aftertrace-icon.svg',
    badge: '/aftertrace-icon.svg',
    data: { deepLink },
  });
}

async function openAftertraceNotification(data) {
  const deepLink = safeRelativePath(data && data.deepLink) || '/';
  const target = new URL(deepLink, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    if ('navigate' in client && client.url !== target) await client.navigate(target);
    if ('focus' in client) return client.focus();
  }
  if (self.clients.openWindow) return self.clients.openWindow(target);
}

function parsePushPayload(data) {
  if (!data) return null;
  let value;
  try {
    value = data.json();
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const title = boundedText(value.title, 120);
  const body = boundedText(value.body, 1000);
  if (!title || !body) return null;
  return {
    title,
    body,
    deepLink: typeof value.deepLink === 'string' ? value.deepLink : null,
    tag: boundedText(value.tag, 160),
    notificationId: Number.isSafeInteger(Number(value.notificationId)) ? Number(value.notificationId) : null,
  };
}

function safeRelativePath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const parsed = new URL(raw, self.location.origin);
    if (parsed.origin !== self.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function boundedText(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
}
