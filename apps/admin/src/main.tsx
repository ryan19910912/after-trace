import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApi } from './api';
import { App } from './App';
import './styles.css';

const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
if (!baseUrl) throw new Error('VITE_API_BASE_URL is required');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={new AdminApi(baseUrl)} />
  </StrictMode>,
);
