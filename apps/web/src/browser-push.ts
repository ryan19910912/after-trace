import type { PushSubscriptionRegistration } from './account-notification-api';

export type BrowserPushCapability = 'SUPPORTED' | 'UNSUPPORTED' | 'PERMISSION_DENIED';

export function browserPushCapability(): BrowserPushCapability {
  if (
    typeof window === 'undefined'
    || !('serviceWorker' in navigator)
    || typeof PushManager === 'undefined'
    || typeof Notification === 'undefined'
  ) {
    return 'UNSUPPORTED';
  }
  return Notification.permission === 'denied' ? 'PERMISSION_DENIED' : 'SUPPORTED';
}

/**
 * Must only be called from an explicit user gesture (for example the 開啟通知 button).
 * It is intentionally never invoked during page/bootstrap effects.
 */
export async function enableBrowserPush(publicKey: string): Promise<PushSubscriptionRegistration> {
  if (browserPushCapability() === 'UNSUPPORTED') throw new Error('PUSH_UNSUPPORTED');
  if (Notification.permission === 'denied') throw new Error('PUSH_PERMISSION_DENIED');

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('PUSH_PERMISSION_DENIED');

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  return pushSubscriptionRegistration(subscription);
}

export async function currentBrowserPushSubscription(): Promise<PushSubscription | null> {
  if (browserPushCapability() === 'UNSUPPORTED') return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function disableCurrentBrowserPush(): Promise<string | null> {
  const subscription = await currentBrowserPushSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

export function pushSubscriptionRegistration(subscription: PushSubscription): PushSubscriptionRegistration {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh?.trim();
  const auth = json.keys?.auth?.trim();
  if (!subscription.endpoint || !p256dh || !auth) throw new Error('INVALID_BROWSER_PUSH_SUBSCRIPTION');
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    platform: browserPlatform(),
  };
}

export function browserPlatform(): string | null {
  if (typeof navigator === 'undefined') return null;
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const candidate = userAgentData?.platform || navigator.platform || '';
  return candidate.trim().slice(0, 64) || null;
}

export function iosHomeScreenPushHint(): string {
  return 'iPhone / iPad 請先將 AFTERTRACE 加入主畫面，再從主畫面的 PWA 點「開啟通知」。一般 Safari 分頁不視為相同的推播使用方式。';
}

export function applicationServerKey(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) throw new Error('INVALID_PUSH_PUBLIC_KEY');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let raw: string;
  try {
    raw = atob(padded);
  } catch {
    throw new Error('INVALID_PUSH_PUBLIC_KEY');
  }
  if (!raw) throw new Error('INVALID_PUSH_PUBLIC_KEY');
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
