import './worklog.css';

export function HelpRoot(){
  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>使用教學</h1><p className="muted">LINE 負責快速記錄，網頁負責搜尋、整理與管理。</p></div><button className="ghost" onClick={()=>{location.href='/';}}>回紀錄</button></div>
    <section className="panel help-stack">
      <article><h2>直接記錄文字</h2><p>在 LINE 官方帳號私聊，或已加入 AFTERTRACE Bot 的群組輸入：</p><code>@AFTERTRACE 王先生二樓漏水已修復</code><p>AI 會協助判斷一個「紀錄標題」與發生時間；原始紀錄內容仍會保留。</p></article>
      <article><h2>群組補記之前的文字</h2><p>只有 LINE 群組的一般文字會暫存最多 5 天。回覆仍在暫存內的原文字訊息，再輸入 <code>@AFTERTRACE</code>，系統才會把原文建立成正式紀錄。</p><p>LINE 官方帳號私聊的一般文字不會暫存；若之後才想補記，請重新輸入 <code>@AFTERTRACE 原文</code>。</p></article>
      <article><h2>圖片、音檔、檔案</h2><p>Reply 那則圖片、音檔或支援的檔案，再輸入 <code>@AFTERTRACE</code>。附件本身不會被 AFTERTRACE 永久保存；系統會當下向 LINE 取內容，轉成可搜尋的文字紀錄後丟棄原始二進位檔。若 LINE 內容已失效，會請你重新傳送。</p></article>
      <article><h2>查看與整理</h2><p>在 LINE 輸入 <code>@AFTERTRACE 查詢</code> 或自然語句，例如「王大明這週做了什麼」，AFTERTRACE 會帶你到已套好條件的紀錄頁。</p><p>網頁可以切換個人／群組 Source，依紀錄標題、模糊關鍵字與日期範圍搜尋；也可以免費手動新增、編輯、移動紀錄標題、批次移動、刪除、還原及查看編輯紀錄。</p></article>
      <article><h2>群組 AI 額度負責人</h2><p>群組資料與 AI 費用是兩件事。所有目前仍在群組內的成員都可以使用免費的手動紀錄功能，不需要 Owner、付費方案或 AI 點數。</p><p>需要使用群組 AI 時，群組內可用 <code>@AFTERTRACE 啟用</code> 設定目前的「AI 額度負責人」。AI 只會使用該負責人明確允許這個群組使用的個人 Grant 點數；負責人離開群組時 AI 會暫停，但群組紀錄與手動功能不會消失。</p></article>
      <article><h2>AI 點數用完怎麼辦？</h2><p>AI CREATE／EDIT／附件理解在開始前需要有可用 AI 點數。點數為 0 時不會呼叫 AI，但網頁上的手動新增、編輯、搜尋、刪除、還原與移動紀錄仍可免費使用。</p></article>
    </section>
  </main>;
}
