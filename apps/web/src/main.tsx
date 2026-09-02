import React from 'react';
import ReactDOM from 'react-dom/client';
import { FeedbackRoot } from './FeedbackRoot';
import { HelpRoot } from './HelpRoot';
import { SubscriptionRoot } from './SubscriptionRoot';
import { WorklogRoot } from './WorklogRoot';
import './styles.css';

const RETURN_KEY='aftertrace.worklog.returnTo';

function Fatal({ message }: { message: string }) {
  return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>無法開啟 AFTERTRACE</h1><p>{message}</p></section></main>;
}

function bootstrap() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) throw new Error('系統設定不完整，請稍後再試。');

  // LINE Login callback currently returns to WEB_APP_URL root. Preserve the requested
  // Rich Menu destination without LIFF by moving the session hash to that local path.
  if (window.location.pathname === '/' && window.location.hash.includes('session=')) {
    const returnTo = localStorage.getItem(RETURN_KEY);
    if (returnTo === '/subscription' || returnTo === '/feedback') {
      localStorage.removeItem(RETURN_KEY);
      window.location.replace(`${returnTo}${window.location.hash}`);
      return;
    }
  }

  let content: React.ReactNode;
  if (window.location.pathname === '/subscription') content = <SubscriptionRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/feedback') content = <FeedbackRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/help') content = <HelpRoot />;
  else content = <WorklogRoot apiBaseUrl={apiBaseUrl} />;
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{content}</React.StrictMode>);
}

try { bootstrap(); }
catch (error) { const message = error instanceof Error ? error.message : '初始化失敗'; ReactDOM.createRoot(document.getElementById('root')!).render(<Fatal message={message} />); }
