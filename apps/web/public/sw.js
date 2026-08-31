const DB_NAME = 'aftertrace-pwa-v1';
const STORE_NAME = 'context';
const CONTEXT_KEY = 'radar';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeContext(context) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(context, CONTEXT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readContext() {
  const database = await openDatabase();
  const value = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(CONTEXT_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

async function showGenericNotification() {
  await self.registration.showNotification('AFTERTRACE 空位雷達', {
    body: '空位雷達收到更新，開啟 AFTERTRACE 重新整理最新狀態。',
    tag: 'aftertrace-radar-generic',
    data: { deepLink: '/' },
  });
}

async function handlePush() {
  const context = await readContext().catch(() => null);
  const subscription = await self.registration.pushManager.getSubscription();
  if (!context?.token || !context?.apiBaseUrl || !subscription) {
    await showGenericNotification();
    return;
  }

  try {
    const response = await fetch(`${String(context.apiBaseUrl).replace(/\/$/, '')}/api/v1/push/presentation`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!response.ok) {
      await showGenericNotification();
      return;
    }

    const body = await response.json();
    const notification = body.notification;
    // The Push service can race with a later availability transition. The API
    // returns a successful null presentation when no delivery is still current;
    // do not turn that stale wake-up into a false "空位" notification.
    if (!notification) return;

    await self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      renotify: true,
      data: {
        deliveryId: notification.deliveryId,
        deepLink: notification.deepLink,
      },
    });
  } catch {
    await showGenericNotification();
  }
}

async function acknowledgeOpened(deliveryId) {
  const context = await readContext().catch(() => null);
  if (!context?.token || !context?.apiBaseUrl || !deliveryId) return;
  try {
    await fetch(`${String(context.apiBaseUrl).replace(/\/$/, '')}/api/v1/push/deliveries/${deliveryId}/opened`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${context.token}`,
      },
    });
  } catch {
    // Click navigation must not fail just because analytics acknowledgement failed.
  }
}

async function focusOrOpen(deepLink) {
  const target = new URL(deepLink || '/', self.location.origin).href;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    if ('navigate' in client) await client.navigate(target);
    await client.focus();
    return;
  }
  await clients.openWindow(target);
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SET_AFTERTRACE_CONTEXT') return;
  const token = typeof event.data.token === 'string' ? event.data.token : '';
  const apiBaseUrl = typeof event.data.apiBaseUrl === 'string' ? event.data.apiBaseUrl : '';
  if (!token || !apiBaseUrl) return;
  event.waitUntil(writeContext({ token, apiBaseUrl }));
});

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deliveryId = event.notification.data?.deliveryId;
  const deepLink = event.notification.data?.deepLink || '/';
  event.waitUntil(Promise.all([
    acknowledgeOpened(deliveryId),
    focusOrOpen(deepLink),
  ]));
});
