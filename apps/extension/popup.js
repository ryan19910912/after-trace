const content = document.querySelector('#content');
const includePage = document.querySelector('#includePage');
const pageContext = document.querySelector('#pageContext');
const pageTitle = document.querySelector('#pageTitle');
const pageUrl = document.querySelector('#pageUrl');
const voiceButton = document.querySelector('#voice');
const screenshotButton = document.querySelector('#screenshot');
const screenshotPreview = document.querySelector('#screenshotPreview');
const status = document.querySelector('#status');

let activeTab = null;
let screenshotDataUrl = null;
let recognition = null;
let recognizing = false;

function setStatus(message) {
  status.textContent = message ?? '';
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;
  pageTitle.textContent = activeTab?.title ?? '目前頁面';
  pageUrl.textContent = activeTab?.url ?? '';
  pageUrl.href = activeTab?.url ?? '#';
}

async function loadPendingSelection() {
  const { aftertracePendingCapture } = await chrome.storage.local.get('aftertracePendingCapture');
  if (!aftertracePendingCapture) return;

  if (aftertracePendingCapture.kind === 'SELECTION' && aftertracePendingCapture.text) {
    content.value = aftertracePendingCapture.text;
    if (aftertracePendingCapture.pageTitle || aftertracePendingCapture.pageUrl) {
      includePage.checked = true;
      pageTitle.textContent = aftertracePendingCapture.pageTitle ?? '來源頁面';
      pageUrl.textContent = aftertracePendingCapture.pageUrl ?? '';
      pageUrl.href = aftertracePendingCapture.pageUrl ?? '#';
      pageContext.classList.remove('hidden');
    }
    setStatus('已帶入你剛剛選取的文字，可編輯後再記錄。');
  }

  await chrome.storage.local.remove('aftertracePendingCapture');
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
    setStatus('正在聆聽…');
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
  };
  instance.onerror = (event) => {
    setStatus(`語音輸入失敗（${event.error ?? 'unknown'}），可直接改用文字。`);
  };
  instance.onend = () => {
    recognizing = false;
    voiceButton.textContent = '🎙️ 語音';
    if (!status.textContent.includes('失敗')) setStatus('語音輸入完成，可再編輯。');
  };
  return instance;
}

includePage.addEventListener('change', async () => {
  if (includePage.checked) {
    if (!activeTab) await loadActiveTab();
    pageContext.classList.remove('hidden');
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
    setStatus('已擷取目前可見畫面。AI Pro 圖片處理會沿用 AFTERTRACE 的 AI 額度。');
  } catch {
    screenshotDataUrl = null;
    screenshotPreview.classList.add('hidden');
    setStatus('無法擷取目前頁面，請確認此頁面允許擴充元件存取。');
  }
});

await loadActiveTab();
await loadPendingSelection();

// Persistence/auth handoff is intentionally wired in a later batch so the extension reuses
// the same AFTERTRACE account/session and Record APIs rather than inventing an extension-only login.
void screenshotDataUrl;
