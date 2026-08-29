import type { RewardedAdNonce } from './api';

type RewardedSlot = unknown;
type RewardedReadyEvent = { slot: RewardedSlot; makeRewardedVisible(): void };
type RewardedGrantedEvent = { slot: RewardedSlot };
type RewardedClosedEvent = { slot: RewardedSlot };

type GoogleTag = {
  cmd: Array<() => void>;
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  defineOutOfPageSlot(path: string, format: unknown): RewardedSlot | null;
  pubads(): {
    addEventListener(name: 'rewardedSlotReady', callback: (event: RewardedReadyEvent) => void): void;
    addEventListener(name: 'rewardedSlotGranted', callback: (event: RewardedGrantedEvent) => void): void;
    addEventListener(name: 'rewardedSlotClosed', callback: (event: RewardedClosedEvent) => void): void;
    removeEventListener(name: string, callback: (event: never) => void): void;
  };
  enableServices(): void;
  display(slot: RewardedSlot): void;
  destroySlots(slots: RewardedSlot[]): boolean;
};

declare global {
  interface Window {
    googletag?: GoogleTag;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGpt(): Promise<void> {
  if (window.googletag?.defineOutOfPageSlot) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    window.googletag = window.googletag ?? ({ cmd: [] } as unknown as GoogleTag);
    const existing = document.querySelector<HTMLScriptElement>('script[data-aftertrace-gpt]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Publisher Tag 載入失敗')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
    script.dataset.aftertraceGpt = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Publisher Tag 載入失敗'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type RewardedAdRunResult = {
  providerEventId: string;
};

/**
 * Runs one user-initiated Google Ad Manager Web Rewarded impression.
 * The server nonce is issued before the slot is displayed. A backend claim must only
 * be submitted after GPT emits rewardedSlotGranted.
 */
export async function runGoogleRewardedAd(
  issued: RewardedAdNonce,
): Promise<RewardedAdRunResult> {
  if (issued.client.provider !== 'GOOGLE_AD_MANAGER_WEB') {
    throw new Error('不支援的 Rewarded Ad provider');
  }
  await loadGpt();

  return new Promise<RewardedAdRunResult>((resolve, reject) => {
    const googletag = window.googletag;
    if (!googletag) {
      reject(new Error('Google Publisher Tag 尚未初始化'));
      return;
    }

    googletag.cmd.push(() => {
      const slot = googletag.defineOutOfPageSlot(
        issued.client.adUnitPath,
        googletag.enums.OutOfPageFormat.REWARDED,
      );
      if (!slot) {
        reject(new Error('目前裝置或版面無法顯示 Rewarded Ad'));
        return;
      }

      let granted = false;
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        googletag.destroySlots([slot]);
      };
      const isThisSlot = (eventSlot: RewardedSlot) => eventSlot === slot;

      const onReady = (event: RewardedReadyEvent) => {
        if (!isThisSlot(event.slot)) return;
        // This function is reached only from the explicit "看廣告取得 Energy" user action.
        event.makeRewardedVisible();
      };
      const onGranted = (event: RewardedGrantedEvent) => {
        if (!isThisSlot(event.slot) || granted) return;
        granted = true;
        resolve({ providerEventId: `gam-web:${crypto.randomUUID()}` });
      };
      const onClosed = (event: RewardedClosedEvent) => {
        if (!isThisSlot(event.slot)) return;
        cleanup();
        if (!granted) reject(new Error('廣告尚未完成，因此沒有取得 Energy'));
      };

      googletag.pubads().addEventListener('rewardedSlotReady', onReady);
      googletag.pubads().addEventListener('rewardedSlotGranted', onGranted);
      googletag.pubads().addEventListener('rewardedSlotClosed', onClosed);
      googletag.enableServices();
      googletag.display(slot);
    });
  });
}
