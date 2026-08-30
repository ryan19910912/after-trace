import {
  bootstrapAnonymousIdentity,
  deactivatePushSubscription,
  fetchPushConfig,
  registerPushSubscription,
} from './api';

const IDENTITY_STORAGE_KEY = 'aftertrace.anonymousToken.v1';

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

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function postServiceWorkerContext(registration: ServiceWorkerRegistration, token: string, apiBaseUrl: string) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  worker?.postMessage({ type: 'SET_AFTERTRACE_CONTEXT', token, apiBaseUrl });
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

  const config = await fetchPushConfig(apiBaseUrl);
  if (!config.configured || !config.applicationServerKey) return { status: 'NOT_CONFIGURED' };

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'DENIED' };

  const registration = await ensureServiceWorker();
  if (!registration) return { status: 'UNSUPPORTED' };
  await postServiceWorkerContext(registration, token, apiBaseUrl);

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.applicationServerKey),
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
