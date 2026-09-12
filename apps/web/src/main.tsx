import React from 'react';
import ReactDOM from 'react-dom/client';
import { AboutRoot } from './AboutRoot';
import { AiSearchRoot } from './AiSearchRoot';
import { AiTaskRoot } from './AiTaskRoot';
import { AiToolsRoot } from './AiToolsRoot';
import { AuthenticatedAppChrome } from './AuthenticatedAppChrome';
import { CaptureRoot } from './CaptureRoot';
import { ExtensionConnectRoot } from './ExtensionConnectRoot';
import { FeedbackRoot } from './FeedbackRoot';
import { HelpRoot } from './HelpRoot';
import { LoginRoot } from './LoginRoot';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileShortcutRoot } from './MobileShortcutRoot';
import { RecordHomeRoot } from './RecordHomeRoot';
import { safeLoginReturn } from './login-return';
import { SubscriptionRoot } from './SubscriptionRoot';
import { TaskRoot } from './TaskRoot';
import { installTaipeiDateDisplayPolicy } from './time-display';
import { WorklogGroupsRoot } from './WorklogGroupsRoot';
import './styles.css';
import './reference-shell.css';

const RETURN_KEY = 'aftertrace.worklog.returnTo';

installTaipeiDateDisplayPolicy();

function Fatal({ message }: { message: string }) {
  return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>無法開啟 AFTERTRACE</h1><p>{message}</p></section></main>;
}

function pageTitle(pathname: string): string {
  if (pathname === '/login') return '登入｜AFTERTRACE';
  if (pathname === '/extension/connect') return 'Chrome 擴充元件｜AFTERTRACE';
  if (pathname === '/mobile-shortcut') return '手機桌面捷徑｜AFTERTRACE';
  if (pathname === '/about') return '關於我們｜AFTERTRACE';
  if (pathname === '/capture') return '快速紀錄｜AFTERTRACE';
  if (pathname === '/ai-search') return 'AI 搜尋｜AFTERTRACE';
  if (pathname === '/ai-tools') return 'AI 整理｜AFTERTRACE';
  if (pathname === '/ai-task') return 'AI 待辦｜AFTERTRACE';
  if (pathname === '/subscription') return '方案｜AFTERTRACE';
  if (pathname === '/feedback') return '意見回饋｜AFTERTRACE';
  if (pathname === '/help') return '使用說明｜AFTERTRACE';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return '待辦｜AFTERTRACE';
  if (pathname === '/worklog') return '群組｜AFTERTRACE';
  return '紀錄列表｜AFTERTRACE';
}

function bootstrap() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) throw new Error('系統設定不完整，請稍後再試。');

  document.title = pageTitle(window.location.pathname);

  if (window.location.pathname === '/' && window.location.hash.includes('session=')) {
    const returnTo = safeLoginReturn(localStorage.getItem(RETURN_KEY));
    if (returnTo) {
      localStorage.removeItem(RETURN_KEY);
      window.location.replace(`${returnTo}${window.location.hash}`);
      return;
    }
  }

  let content: React.ReactNode;
  if (window.location.pathname === '/login') content = <LoginRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/extension/connect') content = <ExtensionConnectRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/mobile-shortcut') content = <MobileShortcutRoot />;
  else if (window.location.pathname === '/about') content = <AboutRoot />;
  else if (window.location.pathname === '/capture') content = <CaptureRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/ai-search') content = <AiSearchRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/ai-tools') content = <AiToolsRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/ai-task') content = <AiTaskRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/subscription') content = <SubscriptionRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/feedback') content = <FeedbackRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/help') content = <HelpRoot />;
  else if (window.location.pathname === '/tasks' || window.location.pathname.startsWith('/tasks/')) content = <TaskRoot apiBaseUrl={apiBaseUrl} />;
  else if (window.location.pathname === '/worklog') content = <WorklogGroupsRoot apiBaseUrl={apiBaseUrl} />;
  else content = <RecordHomeRoot apiBaseUrl={apiBaseUrl} />;

  const authenticatedSurface = !['/login', '/extension/connect'].includes(window.location.pathname);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <AuthenticatedAppChrome apiBaseUrl={apiBaseUrl}>
      {content}
      {authenticatedSurface ? <MobileBottomNav /> : null}
    </AuthenticatedAppChrome>,
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
