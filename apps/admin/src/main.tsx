import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApi } from './api';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

if (!baseUrl) {
  root.render(
    <StrictMode>
      <main className="shell">
        <section className="panel">
          <h1>AFTERTRACE Admin</h1>
          <p>系統設定不完整：缺少 VITE_API_BASE_URL。</p>
        </section>
      </main>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App api={new AdminApi(baseUrl)} />
    </StrictMode>,
  );
}
