import './worklog.css';

export function HelpRoot() {
  const supportUrl = lineSupportChatUrl(import.meta.env.VITE_LINE_OA_ADD_URL?.trim());
  return <main className="shell worklog-shell help-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>快速上手</h1>
        <p className="muted">不用先學系統。打開就記，需要時再找。</p>
      </div>
    </div>

    <section className="help-stack">
      <article><p className="help-step">01</p><h2>直接輸入文字或語音</h2><p>「紀錄」頁最上方就是快速紀錄區。可以直接打字，也可以按「語音輸入」。開始語音時會先清空原本的文字，辨識結果會即時回到文字框，確認後按「儲存紀錄」。</p></article>
      <article><p className="help-step">02</p><h2>需要時再搜尋</h2><p>紀錄列表可以直接使用關鍵字與日期範圍篩選。一般搜尋免費，不會消耗 AI 額度。</p></article>
      <article><p className="help-step">03</p><h2>把事情變成待辦</h2><p>建立待辦與提醒時間，到時間後會出現在通知中心；開啟推播後也能收到額外提醒。</p></article>
      <article><p className="help-step">04</p><h2>和同事用群組一起記</h2><p>在「群組」建立工作群組，再把邀請連結傳給同事。加入後即可共同查看與新增該群組的工作紀錄。</p></article>
      <article><p className="help-step">05</p><h2>需要整理時再用 AI</h2><p>AI 可協助自然語言搜尋、圖片與語音整理、摘要、改寫與待辦建議。沒有 AI 額度時，手動紀錄、搜尋、群組與待辦仍可正常使用。</p></article>
      <article><p className="help-step">手機使用</p><h2>加到手機主畫面，打開就能記</h2><p>把 AFTERTRACE 加到手機主畫面後，點桌面圖示會直接開啟紀錄列表。上方立即提供文字與語音輸入，適合現場快速留下工作內容。</p></article>
      <article><p className="help-step">瀏覽器</p><h2>用 Chrome 擴充元件更快記</h2><p>在瀏覽網頁時可以直接開啟 AFTERTRACE 擴充元件，輸入文字、使用語音、帶入選取內容，或在你明確選擇時附上頁面標題與網址。</p></article>
      <article className="help-support"><p className="help-step">客服</p><h2>需要協助？</h2><p>可以透過「幫助 → 意見回饋」直接送出建議，也可以透過 AFTERTRACE LINE 官方帳號聯絡客服；客服不會讀取或修改你的工作紀錄。</p>{supportUrl ? <a className="line-support-link" href={supportUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">LINE</span><strong>LINE 聯絡客服</strong></a> : <p className="muted">LINE 客服連結尚未設定。</p>}</article>
    </section>
  </main>;
}

function lineSupportChatUrl(configuredUrl: string | undefined): string | null {
  if (!configuredUrl) return null;
  const match = configuredUrl.match(/(?:%40|@)([A-Za-z0-9._-]+)/i);
  if (!match?.[1]) return configuredUrl;
  return `https://line.me/R/oaMessage/%40${encodeURIComponent(match[1])}`;
}
