import './worklog.css';

export function HelpRoot() {
  const supportUrl = import.meta.env.VITE_LINE_OA_ADD_URL?.trim();
  return <main className="shell worklog-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>快速上手</h1>
        <p className="muted">不用先學系統。先完成下面幾件事，就可以開始工作。</p>
      </div>
      <button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button>
    </div>

    <section className="help-stack">
      <article>
        <p className="eyebrow">01</p>
        <h2>先記下發生的事</h2>
        <p>到「紀錄」按「＋新增紀錄」，直接輸入內容就能保存。發生時間可以不填，系統會保留建立時間。</p>
      </article>
      <article>
        <p className="eyebrow">02</p>
        <h2>需要時再搜尋</h2>
        <p>可直接搜尋紀錄內容，也能搭配日期範圍。一般搜尋免費，不會消耗 AI 額度。</p>
      </article>
      <article>
        <p className="eyebrow">03</p>
        <h2>把事情變成待辦</h2>
        <p>建立待辦與提醒時間，到時間後會出現在通知中心；開啟推播後也能收到額外提醒。</p>
      </article>
      <article>
        <p className="eyebrow">04</p>
        <h2>和同事用群組一起記</h2>
        <p>在「群組」建立工作群組，再把邀請連結傳給同事。加入後即可共同查看該群組的工作紀錄。</p>
      </article>
      <article>
        <p className="eyebrow">05</p>
        <h2>需要整理時再用 AI</h2>
        <p>AI 可協助自然語言搜尋、圖片與語音整理、摘要、改寫與待辦建議。沒有 AI 額度時，手動紀錄、搜尋、群組與待辦仍可正常使用。</p>
      </article>
      <article>
        <p className="eyebrow">PWA</p>
        <h2>手機現場快速記錄</h2>
        <p>安裝 PWA 後可快速輸入或使用瀏覽器語音轉文字。語音轉文字的免費路徑只保存辨識後文字，不會自動呼叫 AI。</p>
      </article>
      <article>
        <p className="eyebrow">SUPPORT</p>
        <h2>需要協助？</h2>
        <p>產品內可直接送出「意見回饋」。LINE 官方帳號只作為客服聯絡管道，不會讀取或修改你的工作紀錄。</p>
        {supportUrl ? <a href={supportUrl} target="_blank" rel="noreferrer">聯絡客服</a> : <p className="muted">客服連結尚未設定。</p>}
      </article>
    </section>
  </main>;
}
