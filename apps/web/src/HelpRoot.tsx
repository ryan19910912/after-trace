import './worklog.css';

export function HelpRoot(){
  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>使用教學</h1><p className="muted">LINE 負責快速記錄，網頁負責整理與管理。</p></div><button className="ghost" onClick={()=>{location.href='/';}}>回紀錄</button></div>
    <section className="panel help-stack">
      <article><h2>直接記錄文字</h2><p>在 LINE OA 私聊或已啟用的群組輸入：</p><code>@AFTERTRACE 王先生二樓漏水已修復</code></article>
      <article><h2>補記之前的文字</h2><p>回覆五天內的原文字訊息，只輸入 <code>@AFTERTRACE</code>。AFTERTRACE 會從暫存找回原文後建立正式紀錄。</p></article>
      <article><h2>圖片、音檔、檔案</h2><p>直接 Reply 那則圖片、音檔或檔案，再輸入 <code>@AFTERTRACE</code>。附件不會被 AFTERTRACE 暫存；系統會當下向 LINE 取內容，失效時會請你重新傳送。</p></article>
      <article><h2>查看與整理</h2><p>在 LINE 輸入 <code>@AFTERTRACE 查詢</code>，或從官方帳號選單開啟紀錄中心。可切換個人/群組、搜尋、分類、關聯客戶與專案、管理收支。</p></article>
      <article><h2>群組 Owner</h2><p>尚未綁定 Owner 的群組，由要負責訂閱的人輸入 <code>@AFTERTRACE 啟用</code>。群組 AI 額度由 Owner 方案負擔，Owner 可關閉特定成員新增紀錄的權限。</p></article>
    </section>
  </main>;
}
