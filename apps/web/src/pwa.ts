import {
  bootstrapAnonymousIdentity,
  deactivatePushSubscription,
  fetchPushConfig,
  registerPushSubscription,
  type PushConfig,
} from './api';

const IDENTITY_STORAGE_KEY = 'aftertrace.anonymousToken.v1';
const pushConfigCache = new Map<string, Promise<PushConfig>>();

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(IDENTITY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string) {
  try {
    window.localStorage.setItem(IDENTITY_STORAGE_KEY, token);
  } catch {
    // Radar still works for the current page session if persistent storage is unavailable.
  }
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function postServiceWorkerContext(registration: ServiceWorkerRegistration, token: string, apiBaseUrl: string) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  worker?.postMessage({ type: 'SET_AFTERTRACE_CONTEXT', token, apiBaseUrl });
}

export function prepareWebPush(apiBaseUrl: string): Promise<PushConfig> {
  const cacheKey = apiBaseUrl.replace(/\/$/, '');
  const existing = pushConfigCache.get(cacheKey);
  if (existing) return existing;
  const request = fetchPushConfig(apiBaseUrl).catch((error) => {
    pushConfigCache.delete(cacheKey);
    throw error;
  });
  pushConfigCache.set(cacheKey, request);
  return request;
}

export async function ensureRadarIdentity(apiBaseUrl: string): Promise<string> {
  const token = await bootstrapAnonymousIdentity(apiBaseUrl, readStoredToken());
  writeStoredToken(token);
  const registration = await ensureServiceWorker();
  if (registration) await postServiceWorkerContext(registration, token, apiBaseUrl);
  return token;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function syncServiceWorkerIdentity(token: string, apiBaseUrl: string) {
  const registration = await ensureServiceWorker();
  if (registration) await postServiceWorkerContext(registration, token, apiBaseUrl);
}

export type PushEnableResult =
  | { status: 'ENABLED' }
  | { status: 'UNSUPPORTED' }
  | { status: 'NOT_CONFIGURED' }
  | { status: 'DENIED' };

export async function enableWebPush(apiBaseUrl: string, token: string): Promise<PushEnableResult> {
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
    return { status: 'UNSUPPORTED' };
  }

  // Start non-gesture prerequisites without awaiting them. Notification
  // permission is requested immediately from the button event; this matters on
  // browsers that require Push opt-in to originate from transient user action.
  const configPromise = prepareWebPush(apiBaseUrl);
  const registrationPromise = ensureServiceWorker();
  const permissionPromise = Notification.permission === 'granted'
    ? Promise.resolve<NotificationPermission>('granted')
    : Notification.requestPermission();

  const permission = await permissionPromise;
  if (permission !== 'granted') return { status: 'DENIED' };

  const [config, registration] = await Promise.all([configPromise, registrationPromise]);
  if (!config.configured || !config.applicationServerKey) return { status: 'NOT_CONFIGURED' };
  if (!registration) return { status: 'UNSUPPORTED' };
  await postServiceWorkerContext(registration, token, apiBaseUrl);

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToArrayBuffer(config.applicationServerKey),
    });
  }

  await registerPushSubscription(apiBaseUrl, token, subscription.toJSON());
  return { status: 'ENABLED' };
}

export async function disableWebPush(apiBaseUrl: string, token: string): Promise<void> {
  const registration = await ensureServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await deactivatePushSubscription(apiBaseUrl, token, subscription.endpoint);
  await subscription.unsubscribe();
}

export async function currentPushEnabled(): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const registration = await ensureServiceWorker();
  return Boolean(await registration?.pushManager.getSubscription());
}
