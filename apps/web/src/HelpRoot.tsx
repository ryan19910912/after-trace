import './worklog.css';

export function HelpRoot() {
  const supportUrl = lineSupportChatUrl(import.meta.env.VITE_LINE_OA_ADD_URL?.trim());
  return <main className="shell worklog-shell help-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>快速上手</h1>
        <p className="muted">不用先學系統。先完成下面幾件事，就可以開始工作。</p>
      </div>
    </div>

    <section className="help-stack">
      <article><p className="help-step">01</p><h2>先記下發生的事</h2><p>到「紀錄」按「＋新增紀錄」，直接輸入內容就能保存。發生時間可以不填，系統會保留建立時間。</p></article>
      <article><p className="help-step">02</p><h2>需要時再搜尋</h2><p>可直接搜尋紀錄內容，也能搭配日期範圍。一般搜尋免費，不會消耗 AI 額度。</p></article>
      <article><p className="help-step">03</p><h2>把事情變成待辦</h2><p>建立待辦與提醒時間，到時間後會出現在通知中心；開啟推播後也能收到額外提醒。</p></article>
      <article><p className="help-step">04</p><h2>和同事用群組一起記</h2><p>在「群組」建立工作群組，再把邀請連結傳給同事。加入後即可共同查看該群組的工作紀錄。</p></article>
      <article><p className="help-step">05</p><h2>需要整理時再用 AI</h2><p>AI 可協助自然語言搜尋、圖片與語音整理、摘要、改寫與待辦建議。沒有 AI 額度時，手動紀錄、搜尋、群組與待辦仍可正常使用。</p></article>
      <article><p className="help-step">手機使用</p><h2>加到手機主畫面，現場更快記</h2><p>你可以把 AFTERTRACE 加到手機主畫面，之後像一般 App 一樣直接開啟。也能使用手機瀏覽器的語音轉文字快速輸入；只會保存辨識後的文字，不會因此自動使用 AI 額度。</p></article>
      <article className="help-support"><p className="help-step">客服</p><h2>需要協助？</h2><p>產品內可直接送出「意見回饋」。也可以透過 AFTERTRACE LINE 官方帳號聯絡客服；客服不會讀取或修改你的工作紀錄。</p>{supportUrl ? <a className="line-support-link" href={supportUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">LINE</span><strong>LINE 聯絡客服</strong></a> : <p className="muted">LINE 客服連結尚未設定。</p>}</article>
    </section>
  </main>;
}

function lineSupportChatUrl(configuredUrl: string | undefined): string | null {
  if (!configuredUrl) return null;
  const match = configuredUrl.match(/(?:%40|@)([A-Za-z0-9._-]+)/i);
  if (!match?.[1]) return configuredUrl;
  return `https://line.me/R/oaMessage/%40${encodeURIComponent(match[1])}`;
}
