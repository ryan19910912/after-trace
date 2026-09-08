import './worklog.css';

export function HelpRoot() {
  const supportUrl = import.meta.env.VITE_LINE_OA_ADD_URL?.trim();
  return <main className="shell worklog-shell">
    <div className="topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>使用教學</h1><p className="muted">Web / PWA 是主要產品介面：快速留下紀錄、搜尋、整理與群組協作。</p></div>
      <button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button>
    </div>
    <section className="panel help-stack">
      <article><h2>PWA 快速紀錄</h2><p>安裝 AFTERTRACE 後，PWA 會直接開啟「快速紀錄」。麥克風是主要入口，但不會自動開始錄音；必須由你按下按鈕才會啟動。</p><p>支援的瀏覽器可直接使用瀏覽器提供的語音轉文字。這條免費路徑只把辨識後的文字送進一般手動紀錄 API，不會呼叫 AFTERTRACE AI，也不會消耗 AI 額度。若瀏覽器不支援、權限被拒絕或辨識失敗，仍可直接打字。</p></article>
      <article><h2>快速新增紀錄</h2><p>在完整「紀錄」頁按「＋新增紀錄」，或從 PWA 快速紀錄頁輸入內容；只要有內容就能儲存。發生時間是選填；沒有填時，時間軸會使用系統的記錄時間顯示，不會替你捏造一個事件時間。</p></article>
      <article><h2>免費手動功能</h2><p>手動新增、編輯、搜尋、日期篩選、刪除、還原與查看修改歷史都不需要 provider AI。免費紀錄不要求 AI 標題、關鍵字或其他 AI 擷取中繼資料。</p></article>
      <article><h2>搜尋與時間篩選</h2><p>搜尋會先直接查已保存的紀錄內容，也可以搭配「從／到」時間篩選。沒有發生時間的紀錄會使用建立時間參與時間軸與篩選。</p></article>
      <article><h2>AFTERTRACE 群組</h2><p>到「群組」頁可直接在 AFTERTRACE 建立群組。OWNER 可以建立邀請連結，受邀者必須先登入並明確加入，後端才會建立 membership。</p><p>群組資料權限由 AFTERTRACE membership 控制，不依賴 LINE 群組或 Bot 狀態。</p></article>
      <article><h2>群組邀請</h2><p>目前 Web 先提供單次邀請。原始邀請 token 只會在建立後顯示一次，資料庫只保存雜湊；OWNER 可在仍持有這次邀請資訊時撤銷它。</p></article>
      <article><h2>AI 功能</h2><p>AI 是每位使用者自己的能力，與群組資料權限分開。可用功能包含自然語言／AI 語音／圖片與檔案輸入、AI 標題與關鍵字、自然語言搜尋、相關紀錄、摘要、重寫與任務建議。</p><p>AI Pro 受公平使用與每月資源／Provider Cost 硬上限保護；免費手動功能不會因 AI 額度用完而失效。</p></article>
      <article><h2>聯絡客服</h2><p>LINE 官方帳號只作為 AFTERTRACE 的客服聯絡管道，不會在聊天中建立、搜尋或修改紀錄，也不會管理群組或 AI 方案。</p>{supportUrl ? <a href={supportUrl} target="_blank" rel="noreferrer">聯絡客服</a> : <p className="muted">客服連結尚未設定；你仍可先使用產品內的「意見回饋」。</p>}</article>
    </section>
  </main>;
}
