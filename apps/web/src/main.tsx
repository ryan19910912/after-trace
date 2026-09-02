import React from 'react';
import ReactDOM from 'react-dom/client';
import { SubscriptionRoot } from './SubscriptionRoot';
import { WorklogRoot } from './WorklogRoot';
import './styles.css';

function Fatal({ message }: { message: string }) {
  return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>無法開啟 AFTERTRACE</h1><p>{message}</p></section></main>;
}

function bootstrap() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) throw new Error('系統設定不完整，請稍後再試。');
  const content = window.location.pathname === '/subscription'
    ? <SubscriptionRoot apiBaseUrl={apiBaseUrl} />
    : <WorklogRoot apiBaseUrl={apiBaseUrl} />;
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{content}</React.StrictMode>);
}

try { bootstrap(); }
catch (error) { const message = error instanceof Error ? error.message : '初始化失敗'; ReactDOM.createRoot(document.getElementById('root')!).render(<Fatal message={message} />); }
