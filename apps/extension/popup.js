const AUTH_KEY = 'aftertraceAuth';
const SELECTED_SOURCE_KEY = 'aftertraceSelectedSource';
const PENDING_CONNECT_KEY = 'aftertracePendingConnectNonce';
const LAST_WEB_APP_KEY = 'aftertraceLastWebAppUrl';
const DEFAULT_WEB_APP_URL = 'https://after-trace-web-prod.a0955625660.workers.dev';
const WEB_APP_ORIGINS = new Set([
  'https://after-trace-web-dev.a0955625660.workers.dev',
  'https://after-trace-web-prod.a0955625660.workers.dev',
]);

const authState = document.querySelector('#authState');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const source = document.querySelector('#source');
const content = document.querySelector('#content');
const includePage = document.querySelector('#includePage');
const pageContext = document.querySelector('#pageContext');
const pageTitle = document.querySelector('#pageTitle');
const pageUrl = document.querySelector('#pageUrl');
const voiceButton = document.querySelector('#voice');
const screenshotButton = document.querySelector('#screenshot');
const screenshotPreview = document.querySelector('#screenshotPreview');
const status = document.querySelector('#status');
const saveButton = document.querySelector('#save');
const openWeb = document.querySelector('#openWeb');

let activeTab = null;
let auth = null;
let draftPageContext = null;
let screenshotDataUrl = null;
let recognition = null;
let recognizing = false;
let saving = false;

function setStatus(message) {
  status.textContent = message ?? '';
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;
  draftPageContext = normalizedPageContext(activeTab?.title, activeTab?.url);
  renderPageContext(draftPageContext);
}

async function loadPendingSelection() {
  const { aftertracePendingCapture } = await chrome.storage.local.get('aftertracePendingCapture');
  if (!aftertracePendingCapture) return;

  if (aftertracePendingCapture.kind === 'SELECTION' && aftertracePendingCapture.text) {
    content.value = aftertracePendingCapture.text;
    const selectionPage = normalizedPageContext(
      aftertracePendingCapture.pageTitle,
      aftertracePendingCapture.pageUrl,
    );
    if (selectionPage) {
      draftPageContext = selectionPage;
      renderPageContext(draftPageContext);
      includePage.checked = true;
      pageContext.classList.remove('hidden');
      setStatus('已帶入你剛剛選取的文字與來源頁面。儲存前可取消「附上目前頁面」。');
    } else {
      setStatus('已帶入你剛剛選取的文字。');
    }
  }

  await chrome.storage.local.remove('aftertracePendingCapture');
  updateSaveState();
}

async function loadAuth() {
  const stored = await chrome.storage.local.get([AUTH_KEY, LAST_WEB_APP_KEY]);
  auth = validAuth(stored[AUTH_KEY]) ? stored[AUTH_KEY] : null;
  if (!auth) {
    renderDisconnected();
    return;
  }

  authState.textContent = '已連接 AFTERTRACE';
  connectButton.classList.add('hidden');
  disconnectButton.classList.remove('hidden');
  openWeb.href = auth.webAppUrl;
  await chrome.storage.local.set({ [LAST_WEB_APP_KEY]: auth.webAppUrl });
  await loadSources();
}

function renderDisconnected() {
  auth = null;
  authState.textContent = '尚未連接 AFTERTRACE';
  connectButton.classList.remove('hidden');
  disconnectButton.classList.add('hidden');
  source.innerHTML = '<option value="">請先連接 AFTERTRACE</option>';
  source.disabled = true;
  openWeb.href = DEFAULT_WEB_APP_URL;
  updateSaveState();
}

async function loadSources() {
  if (!auth) return;
  source.disabled = true;
  source.innerHTML = '<option value="">載入紀錄空間中…</option>';
  try {
    const response = await authenticatedFetch('/api/v1/worklog/surfaces');
    const body = await response.json();
    if (!response.ok) throw apiError(response, body, '紀錄空間載入失敗');
    const surfaces = normalizedSurfaces(body?.surfaces);
    renderSources(surfaces);
  } catch (error) {
    if (sessionExpired(error)) {
      await clearAuth();
      setStatus('AFTERTRACE 登入已過期，請重新連接。');
      return;
    }
    source.innerHTML = '<option value="">紀錄空間載入失敗</option>';
    setStatus(error instanceof Error ? error.message : '紀錄空間載入失敗');
  }
}

async function renderSources(surfaces) {
  source.innerHTML = '';
  const options = [];
  if (surfaces.personal) {
    options.push({ value: `PERSONAL:${surfaces.personal.sourceId}`, label: '我的紀錄' });
  }
  for (const group of surfaces.groups) {
    options.push({ value: `GROUP:${group.sourceId}`, label: group.name });
  }

  if (options.length === 0) {
    source.innerHTML = '<option value="">目前沒有可用的紀錄空間</option>';
    source.disabled = true;
    updateSaveState();
    return;
  }

  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    source.appendChild(element);
  }

  const stored = await chrome.storage.local.get(SELECTED_SOURCE_KEY);
  const remembered = typeof stored[SELECTED_SOURCE_KEY] === 'string' ? stored[SELECTED_SOURCE_KEY] : '';
  source.value = options.some((option) => option.value === remembered) ? remembered : options[0].value;
  source.disabled = false;
  updateSaveState();
}

function createRecognition() {
  const Constructor = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  if (!Constructor) return null;

  const instance = new Constructor();
  instance.lang = 'zh-TW';
  instance.interimResults = true;
  instance.continuous = false;

  let committedPrefix = '';
  instance.onstart = () => {
    recognizing = true;
    committedPrefix = content.value.trim();
    voiceButton.textContent = '⏹️ 停止';
    setStatus('正在聆聽…瀏覽器語音轉文字不會呼叫 AFTERTRACE AI。');
  };
  instance.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i]?.[0]?.transcript ?? '';
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    const parts = [committedPrefix, finalText || interimText].filter(Boolean);
    content.value = parts.join(committedPrefix ? ' ' : '');
    updateSaveState();
  };
  instance.onerror = (event) => {
    setStatus(`語音輸入失敗（${event.error ?? 'unknown'}），可直接改用文字。`);
  };
  instance.onend = () => {
    recognizing = false;
    voiceButton.textContent = '🎙️ 語音';
    if (!status.textContent.includes('失敗')) setStatus('語音輸入完成，可再編輯後記錄。');
    updateSaveState();
  };
  return instance;
}

connectButton.addEventListener('click', async () => {
  const nonce = randomNonce();
  await chrome.storage.session.set({ [PENDING_CONNECT_KEY]: nonce });
  const webAppUrl = await preferredWebAppUrl();
  const url = new URL('/extension/connect', webAppUrl);
  url.searchParams.set('extensionId', chrome.runtime.id);
  url.searchParams.set('nonce', nonce);
  await chrome.tabs.create({ url: url.toString() });
  setStatus('已開啟 AFTERTRACE Web，完成登入並按「連接這個擴充功能」後再回來。');
});

disconnectButton.addEventListener('click', async () => {
  await clearAuth();
  setStatus('已解除這個擴充功能的 AFTERTRACE session。');
});

source.addEventListener('change', async () => {
  if (source.value) await chrome.storage.local.set({ [SELECTED_SOURCE_KEY]: source.value });
  updateSaveState();
});

content.addEventListener('input', updateSaveState);

includePage.addEventListener('change', async () => {
  if (includePage.checked) {
    if (!draftPageContext) await loadActiveTab();
    if (!draftPageContext) {
      includePage.checked = false;
      pageContext.classList.add('hidden');
      setStatus('目前頁面沒有可安全附上的 title / http(s) URL。');
      return;
    }
    pageContext.classList.remove('hidden');
    setStatus('目前頁面的 title / URL 會以 bounded metadata 隨這筆 Record 儲存，不會擷取完整頁面內容。');
  } else {
    pageContext.classList.add('hidden');
  }
});

voiceButton.addEventListener('click', () => {
  if (!recognition) recognition = createRecognition();
  if (!recognition) {
    setStatus('此瀏覽器環境不支援語音輸入，可直接輸入文字。');
    return;
  }

  if (recognizing) recognition.stop();
  else recognition.start();
});

screenshotButton.addEventListener('click', async () => {
  try {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
    screenshotPreview.src = screenshotDataUrl;
    screenshotPreview.classList.remove('hidden');
    setStatus('已擷取目前可見畫面供預覽。截圖尚未送到 provider；圖片 AI 仍需 AI Pro 或可用試用額度。');
  } catch {
    screenshotDataUrl = null;
    screenshotPreview.classList.add('hidden');
    setStatus('無法擷取目前頁面，請確認此頁面允許擴充功能存取。');
  }
});

saveButton.addEventListener('click', async () => {
  if (!auth || saving) return;
  const target = selectedSource();
  const rawText = content.value.trim();
  if (!target || !rawText) return;

  saving = true;
  updateSaveState();
  setStatus('記錄中…');
  try {
    const path = target.type === 'PERSONAL'
      ? '/api/v1/worklog/records/personal'
      : `/api/v1/worklog/records/group/${target.sourceId}`;
    const requestBody = { rawText, occurredAt: null };
    if (includePage.checked && draftPageContext) {
      requestBody.captureContext = {
        page: {
          title: draftPageContext.title,
          url: draftPageContext.url,
        },
      };
    }
    const response = await authenticatedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const body = await response.json();
    if (!response.ok) throw apiError(response, body, '記錄失敗');

    const pageStored = Boolean(requestBody.captureContext);
    content.value = '';
    if (recognizing) recognition?.stop();
    setStatus(screenshotDataUrl
      ? `${pageStored ? '文字與頁面資訊' : '文字'}已儲存到 AFTERTRACE。截圖仍只在本機預覽，尚未送出。`
      : `${pageStored ? '文字與頁面資訊' : '紀錄'}已儲存到 AFTERTRACE。`);
  } catch (error) {
    if (sessionExpired(error)) {
      await clearAuth();
      setStatus('AFTERTRACE 登入已過期，請重新連接後再記錄。');
    } else {
      setStatus(error instanceof Error ? error.message : '記錄失敗');
    }
  } finally {
    saving = false;
    updateSaveState();
  }
});

async function authenticatedFetch(path, init = {}) {
  if (!auth) throw new Error('AFTERTRACE_NOT_CONNECTED');
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${auth.sessionToken}`);
  headers.set('Accept', 'application/json');
  return fetch(`${auth.apiBaseUrl}${path}`, { ...init, headers });
}

function selectedSource() {
  const [type, sourceIdText] = source.value.split(':');
  const sourceId = Number(sourceIdText);
  if (!['PERSONAL', 'GROUP'].includes(type) || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  return { type, sourceId };
}

function updateSaveState() {
  const connected = Boolean(auth);
  const target = selectedSource();
  saveButton.disabled = saving || !connected || !target || !content.value.trim();
  saveButton.textContent = saving
    ? '記錄中…'
    : !connected
      ? '請先連接 AFTERTRACE'
      : '儲存紀錄';
}

async function clearAuth() {
  const currentWeb = auth?.webAppUrl;
  await chrome.storage.local.remove([AUTH_KEY, SELECTED_SOURCE_KEY]);
  if (currentWeb) await chrome.storage.local.set({ [LAST_WEB_APP_KEY]: currentWeb });
  renderDisconnected();
}

async function preferredWebAppUrl() {
  const activeOrigin = safeHttpOrigin(activeTab?.url);
  if (activeOrigin && WEB_APP_ORIGINS.has(activeOrigin)) return activeOrigin;
  const stored = await chrome.storage.local.get(LAST_WEB_APP_KEY);
  const remembered = safeHttpOrigin(stored[LAST_WEB_APP_KEY]);
  return remembered && WEB_APP_ORIGINS.has(remembered) ? remembered : DEFAULT_WEB_APP_URL;
}

function normalizedSurfaces(value) {
  const result = { personal: null, groups: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (value.personal && typeof value.personal === 'object' && Number.isSafeInteger(value.personal.sourceId) && value.personal.sourceId > 0) {
    result.personal = { sourceId: value.personal.sourceId };
  }
  if (Array.isArray(value.groups)) {
    result.groups = value.groups.flatMap((group) => {
      if (!group || typeof group !== 'object') return [];
      if (!Number.isSafeInteger(group.sourceId) || group.sourceId <= 0) return [];
      const name = typeof group.name === 'string' ? group.name.trim().slice(0, 255) : '';
      return name ? [{ sourceId: group.sourceId, name }] : [];
    });
  }
  return result;
}

function normalizedPageContext(titleValue, urlValue) {
  const title = typeof titleValue === 'string'
    ? titleValue.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255) || null
    : null;
  let url = null;
  if (typeof urlValue === 'string' && urlValue.trim()) {
    try {
      const parsed = new URL(urlValue.trim());
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
        const candidate = parsed.toString();
        if (candidate.length <= 2048) url = candidate;
      }
    } catch {
      url = null;
    }
  }
  return title || url ? { title, url } : null;
}

function renderPageContext(context) {
  pageTitle.textContent = context?.title ?? '目前頁面';
  pageUrl.textContent = context?.url ?? '';
  pageUrl.href = context?.url ?? '#';
}

function validAuth(value) {
  if (!value || typeof value !== 'object') return false;
  const apiBaseUrl = safeHttpOrigin(value.apiBaseUrl);
  const webAppUrl = safeHttpOrigin(value.webAppUrl);
  return typeof value.sessionToken === 'string'
    && value.sessionToken.trim().length > 0
    && value.sessionToken.length <= 8192
    && Boolean(apiBaseUrl)
    && Boolean(webAppUrl)
    && WEB_APP_ORIGINS.has(webAppUrl);
}

function apiError(response, body, fallback) {
  const code = typeof body?.error === 'string' ? body.error : `${fallback} (${response.status})`;
  const error = new Error(code);
  error.status = response.status;
  return error;
}

function sessionExpired(error) {
  return error?.status === 401 || /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(error?.message ?? '');
}

function safeHttpOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

await loadActiveTab();
await loadPendingSelection();
await loadAuth();
updateSaveState();
