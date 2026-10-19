import './worklog.css';

export function AboutRoot() {
  return <main className="shell worklog-shell help-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>關於我們</h1><p className="muted">Work happens. Keep the trace.</p></div></div>
    <section className="help-stack">
      <article><h2>AFTERTRACE 是什麼？</h2><p>AFTERTRACE 是一個讓工作中發生過的事情留下可搜尋紀錄的工具。重點不是增加管理流程，而是讓你在事情發生時快速記下來，之後需要時找得到。</p></article>
      <article><h2>我們想解決的問題</h2><p>很多工作資訊散落在聊天、腦中、記事本與各種系統裡。AFTERTRACE 希望把「留下紀錄」這件事變得夠快，讓文字、語音、待辦、群組與搜尋集中在同一個地方。</p></article>
      <article><h2>AI 是輔助，不是前提</h2><p>基本紀錄、搜尋、群組與待辦不需要依賴 AI。需要整理、自然語言搜尋或改寫時，再使用 AI 功能，讓 AI 幫忙處理重複整理工作，而不是取代原始紀錄。</p></article>
      <article><h2>產品原則</h2><p>快速記錄、清楚可找、權限明確、能不用 AI 就不用 AI。功能設計會優先考慮是否真的能減少使用者記錄與查找工作資訊的步驟。</p></article>
    </section>
  </main>;
}
