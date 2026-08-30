import liff from '@line/liff';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ManagementApi } from './api';
import './styles.css';

function Fatal({ message }: { message: string }) {
  return (
    <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>無法開啟管理中心</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

async function bootstrap() {
  const liffId = import.meta.env.VITE_LIFF_ID?.trim();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!liffId || !apiBaseUrl) {
    throw new Error('VITE_LIFF_ID / VITE_API_BASE_URL 尚未設定');
  }

  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  const context = liff.getContext();
  if (context?.type !== 'group') {
    throw new Error('請從 AFTERTRACE 所在的 LINE 群組開啟此 LIFF。');
  }

  // LINE discontinued exposing stable groupId values to LIFF. The bot therefore
  // issues a signed group-context token in the LIFF URL when it replies in a group.
  const groupContextToken = new URL(window.location.href).searchParams.get('gc')?.trim();
  if (!groupContextToken) {
    throw new Error('這個連結沒有群組識別資訊，請回到 LINE 群組重新使用 @AFTERTRACE 額度 或 @AFTERTRACE 方案 開啟。');
  }

  const accessToken = liff.getAccessToken();
  if (!accessToken) {
    throw new Error('無法取得 LINE access token，請重新開啟 LIFF。');
  }

  const api = new ManagementApi(apiBaseUrl, accessToken, groupContextToken);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App api={api} />
    </React.StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '初始化失敗';
  ReactDOM.createRoot(document.getElementById('root')!).render(<Fatal message={message} />);
});
