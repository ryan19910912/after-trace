import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ensureServiceWorker, prepareWebPush } from './pwa';
import './styles.css';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:8787';

void ensureServiceWorker();
void prepareWebPush(apiBaseUrl).catch(() => undefined);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App apiBaseUrl={apiBaseUrl} />
  </React.StrictMode>,
);
