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
        <p className="eyebrow">群組記憶助手</p>
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
    throw new Error('系統設定不完整，請稍後再試。');
  }

  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  const context = liff.getContext();
  if (context?.type !== 'group') {
    throw new Error('請從群組內開啟這個管理頁面。');
  }

  // Stable LINE group identifiers are not exposed to LIFF. The bot supplies a
  // signed group-context token in the URL, which the API verifies server-side.
  const groupContextToken = new URL(window.location.href).searchParams.get('gc')?.trim();
  if (!groupContextToken) {
    throw new Error('這個連結缺少群組識別資訊，請回到群組重新開啟新的管理連結。');
  }

  const accessToken = liff.getAccessToken();
  if (!accessToken) {
    throw new Error('無法取得登入憑證，請重新開啟管理頁面。');
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
