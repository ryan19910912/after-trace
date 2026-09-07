import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthenticatedAppChrome } from './AuthenticatedAppChrome';
import { CaptureRoot } from './CaptureRoot';
import { FeedbackRoot } from './FeedbackRoot';
import { HelpRoot } from './HelpRoot';
import { SubscriptionRoot } from './SubscriptionRoot';
import { installTaipeiDateDisplayPolicy } from './time-display';
import { WorklogRoot } from './WorklogRoot';
import './styles.css';

const RETURN_KEY = 'aftertrace.worklog.returnTo';

installTaipeiDateDisplayPolicy();

function Fatal({ message }: { message: string }) {
  return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>無法開啟 AFTERTRACE</h1><p>{message}</p></section></main>;
}

function bootstrap() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) throw new Error('系統設定不完整，請稍後再試。');

  // Migration-era login currently returns to WEB_APP_URL root. Preserve the requested
  // destination while provider-neutral Web authentication is introduced separately.
  if (window.location.pathname === '/' && window.location.hash.includes('session=')) {
    const returnTo = localStorage.getItem(RETURN_KEY);
    if (returnTo === '/subscription' || returnTo === '/feedback' || returnTo === '/capture') {
      localStorage.removeItem(RETURN_KEY);
      window.location.replace(`${returnTo}${window.location.hash}`);
      return;
    }
  }

  let content: React.ReactNode;
  if (window.location.pathname === '/capture') content = <CaptureRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/subscription') content = <SubscriptionRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/feedback') content = <FeedbackRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/help') content = <HelpRoot />;
  else content = <WorklogRoot apiBaseUrl={apiBaseUrl} />;
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AuthenticatedAppChrome apiBaseUrl={apiBaseUrl}>{content}</AuthenticatedAppChrome>
    </React.StrictMode>,
  );
}

function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

try {
  bootstrap();
  registerServiceWorker();
} catch (error) {
  const message = error instanceof Error ? error.message : '初始化失敗';
  ReactDOM.createRoot(document.getElementById('root')!).render(<Fatal message={message} />);
}
