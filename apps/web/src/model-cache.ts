import { releaseLocalAi } from './local-ai';
// The configured Transformers.js cache only. Never delete sessions, records or other caches.
const CACHE = 'transformers-cache';
export async function localModelCacheInfo() {
  if (!('caches' in globalThis)) throw new Error('此瀏覽器不支援模型快取管理。');
  const names = await caches.keys();
  const files = names.includes(CACHE) ? (await (await caches.open(CACHE)).keys()).length : 0;
  const storage = await navigator.storage?.estimate();
  return { files, usedMiB: Math.round((storage?.usage ?? 0) / 1048576), availableMiB: Math.max(0, Math.round(((storage?.quota ?? 0) - (storage?.usage ?? 0)) / 1048576)) };
}
export async function clearLocalModelCache() {
  if (!('caches' in globalThis)) throw new Error('此瀏覽器不支援模型快取管理。');
  releaseLocalAi(); await caches.delete(CACHE);
}
