const DB_NAME = 'aftertrace-pwa-v1';
const STORE_NAME = 'context';
const CONTEXT_KEY = 'radar';
const PRESENTATION_ATTEMPTS = 5;

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryablePresentationStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchPresentation(context, endpoint) {
  const url = `${String(context.apiBaseUrl).replace(/\/$/, '')}/api/v1/push/presentation`;

  for (let attempt = 0; attempt < PRESENTATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${context.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint }),
      });

      if (response.ok) {
        const body = await response.json();
        return body.notification ?? null;
      }

      // 425 is returned when this bare wake arrived before the dispatching
      // Worker had time to persist Push-service acceptance. Retry only
      // transient statuses; auth/validation failures should fail closed now.
      if (!isRetryablePresentationStatus(response.status)) return null;
    } catch {
      // Retry short-lived network/API failures inside this Push event. If all
      // attempts fail we stay silent because current availability was not
      // revalidated and must never be replaced with an unverified fallback.
    }

    if (attempt + 1 < PRESENTATION_ATTEMPTS) await sleep(250 * (attempt + 1));
  }

  return null;
}

async function handlePush() {
  const context = await readContext().catch(() => null);
  const subscription = await self.registration.pushManager.getSubscription();
  if (!context?.token || !context?.apiBaseUrl || !subscription) return;

  const notification = await fetchPresentation(context, subscription.endpoint);
  // A successful null response means the accepted wake is stale, while a
  // failed presentation fetch means current truth could not be verified. Both
  // cases must stay silent rather than producing a false availability alert.
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
