import { useEffect, useMemo, useState } from 'react';
import './worklog.css';

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome?: 'accepted' | 'dismissed' }>;
};

export function MobileShortcutRoot() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEventLike | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEventLike);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice?.catch(() => undefined);
    setInstallEvent(null);
  }

  return <main className="shell worklog-shell help-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>手機桌面捷徑</h1><p className="muted">把 AFTERTRACE 加到手機主畫面，之後可以像一般 App 一樣一鍵開啟紀錄列表。</p></div></div>

    {installed ? <div className="worklog-notice">AFTERTRACE 目前已經以主畫面 App 模式開啟。</div> : null}
    {installEvent ? <section className="panel stack"><h2>直接安裝 AFTERTRACE</h2><p>這個瀏覽器支援直接安裝。完成後，桌面會出現 AFTERTRACE 圖示。</p><div className="filter-actions"><button onClick={() => void install()}>加入手機主畫面</button></div></section> : null}

    <section className="help-stack">
      <article><p className="help-step">iPhone / iPad</p><h2>Safari 加到主畫面</h2><p>1. 使用 Safari 開啟 AFTERTRACE。<br/>2. 點底部或上方的「分享」按鈕。<br/>3. 往下找到「加入主畫面」。<br/>4. 確認名稱為 AFTERTRACE，按「新增」。</p></article>
      <article><p className="help-step">Android / Chrome</p><h2>安裝到主畫面</h2><p>1. 使用 Chrome 開啟 AFTERTRACE。<br/>2. 點右上角選單。<br/>3. 選擇「安裝應用程式」或「加到主畫面」。<br/>4. 確認安裝後，桌面就會出現 AFTERTRACE。</p></article>
      <article><p className="help-step">使用方式</p><h2>打開就直接記錄</h2><p>桌面圖示會直接開啟 AFTERTRACE。紀錄頁會以文字輸入與語音輸入作為主要入口，語音辨識結果會回到文字框，確認後再儲存。</p></article>
    </section>

    {platform === 'IOS' ? <p className="muted">目前偵測到 iPhone / iPad。iOS 不提供網站直接跳出安裝視窗，請依照上面的 Safari 步驟操作。</p> : null}
  </main>;
}

function detectPlatform(): 'IOS' | 'ANDROID' | 'OTHER' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'IOS';
  if (/Android/i.test(ua)) return 'ANDROID';
  return 'OTHER';
}
