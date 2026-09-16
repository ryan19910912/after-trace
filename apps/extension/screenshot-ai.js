const SCREENSHOT_AUTH_KEY = 'aftertraceAuth';
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_EXTENSION_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const screenshotAction = document.querySelector('#saveScreenshot');
const screenshotPreviewElement = document.querySelector('#screenshotPreview');
const screenshotSource = document.querySelector('#source');
const screenshotStatus = document.querySelector('#status');
const screenshotIncludePage = document.querySelector('#includePage');
const screenshotPageTitle = document.querySelector('#pageTitle');
const screenshotPageUrl = document.querySelector('#pageUrl');
const captureScreenshotButton = document.querySelector('#screenshot');

let submittingScreenshot = false;

captureScreenshotButton?.addEventListener('click', () => {
  queueMicrotask(() => syncScreenshotAction());
  setTimeout(() => syncScreenshotAction(), 50);
});

screenshotPreviewElement?.addEventListener('load', syncScreenshotAction);
screenshotSource?.addEventListener('change', syncScreenshotAction);

screenshotAction?.addEventListener('click', async () => {
  if (submittingScreenshot) return;
  const target = selectedScreenshotSource();
  if (!target) {
    setScreenshotStatus('請先選擇要儲存到哪個紀錄空間。');
    return;
  }

  const parsed = parsePngDataUrl(screenshotPreviewElement?.src ?? '');
  if (!parsed) {
    setScreenshotStatus('請先按「擷取可見畫面」。');
    syncScreenshotAction();
    return;
  }
  if (parsed.byteLength > MAX_SCREENSHOT_BYTES) {
    setScreenshotStatus('截圖超過 5 MB，請縮小可見範圍後再試一次。');
    return;
  }

  const stored = await chrome.storage.local.get(SCREENSHOT_AUTH_KEY);
  const auth = validScreenshotAuth(stored[SCREENSHOT_AUTH_KEY]);
  if (!auth) {
    await chrome.storage.local.remove(SCREENSHOT_AUTH_KEY);
    setScreenshotStatus('AFTERTRACE 登入已過期，請重新連接。');
    syncScreenshotAction();
    return;
  }

  const requestBody = {
    sourceId: target.sourceId,
    image: {
      mimeType: 'image/png',
      dataBase64: parsed.dataBase64,
    },
  };
  const context = requestedScreenshotPageContext();
  if (context) requestBody.captureContext = { page: context };

  submittingScreenshot = true;
  syncScreenshotAction();
  setScreenshotStatus('AI 正在整理截圖…');
  try {
    const response = await fetch(`${auth.apiBaseUrl}/api/v1/ai/capture/image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.sessionToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof body?.error === 'string' ? body.error : `HTTP_${response.status}`;
      if (response.status === 401) {
        await chrome.storage.local.remove(SCREENSHOT_AUTH_KEY);
        throw new Error('AFTERTRACE 登入已過期，請重新連接。');
      }
      if (code === 'TRIAL_EXHAUSTED' || code === 'AI_NOT_ENTITLED' || code === 'MONTHLY_POINT_CAP_REACHED'
        || code === 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED' || code === 'MONTHLY_PROVIDER_COST_CAP_REACHED') {
        throw new Error('目前 AI 額度已用完。FREE 手動紀錄仍可正常使用；可到 AFTERTRACE Web 升級訂閱方案。');
      }
      if (code === 'PER_REQUEST_POINT_CAP_EXCEEDED') {
        throw new Error('這張截圖超過目前單次 AI 使用上限，請縮小畫面後再試。');
      }
      throw new Error(code);
    }

    screenshotPreviewElement.src = '';
    screenshotPreviewElement.classList.add('hidden');
    setScreenshotStatus(`已用 ${body?.entitlementSource === 'FREE_TRIAL' ? 'AI 體驗額度' : '訂閱方案 AI 額度'} 整理截圖並儲存到 AFTERTRACE。`);
  } catch (error) {
    setScreenshotStatus(error instanceof Error ? error.message : '截圖 AI 儲存失敗，請稍後再試。');
  } finally {
    submittingScreenshot = false;
    syncScreenshotAction();
  }
});

function syncScreenshotAction() {
  if (!screenshotAction || !screenshotPreviewElement) return;
  const hasScreenshot = /^data:image\/png;base64,/i.test(screenshotPreviewElement.src || '');
  screenshotAction.classList.toggle('hidden', !hasScreenshot);
  screenshotAction.disabled = submittingScreenshot || !hasScreenshot || !selectedScreenshotSource();
  screenshotAction.textContent = submittingScreenshot ? 'AI 整理中…' : '用 AI 整理截圖並儲存';
}

function selectedScreenshotSource() {
  const [type, sourceIdText] = (screenshotSource?.value ?? '').split(':');
  const sourceId = Number(sourceIdText);
  if (!['PERSONAL', 'GROUP'].includes(type) || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  return { type, sourceId };
}

function requestedScreenshotPageContext() {
  if (!screenshotIncludePage?.checked) return null;
  const title = boundedTitle(screenshotPageTitle?.textContent);
  const url = boundedHttpUrl(screenshotPageUrl?.href);
  return title || url ? { title, url } : null;
}

function parsePngDataUrl(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  const dataBase64 = match[1];
  if (dataBase64.length % 4 !== 0) return null;
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0;
  const byteLength = (dataBase64.length / 4) * 3 - padding;
  return Number.isSafeInteger(byteLength) && byteLength > 0 ? { dataBase64, byteLength } : null;
}

function validScreenshotAuth(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.sessionToken !== 'string' || !value.sessionToken.trim() || value.sessionToken.length > 8192) return null;
  const apiBaseUrl = safeHttpsOrigin(value.apiBaseUrl);
  if (!apiBaseUrl || !/^https:\/\/after-trace-api-(?:dev|prod)\.after-lab\.workers\.dev$/.test(apiBaseUrl)) return null;
  const expiresAt = typeof value.sessionExpiresAt === 'string' ? new Date(value.sessionExpiresAt) : null;
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) return null;
  const remainingMs = expiresAt.getTime() - Date.now();
  if (remainingMs <= 0 || remainingMs > MAX_EXTENSION_SESSION_MS + 60_000) return null;
  return { sessionToken: value.sessionToken.trim(), apiBaseUrl, sessionExpiresAt: expiresAt.toISOString() };
}

function boundedTitle(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 255) : null;
}

function boundedHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch {
    return null;
  }
}

function safeHttpsOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function setScreenshotStatus(message) {
  if (screenshotStatus) screenshotStatus.textContent = message;
}

syncScreenshotAction();
