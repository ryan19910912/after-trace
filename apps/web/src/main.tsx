import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>讓重要的生活片段，不只留在聊天紀錄裡。</h1>
        <p className="description">
          LINE 是日常對話入口；這裡會成為記憶、搜尋、提醒與 AI Energy 的管理中心。
        </p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
