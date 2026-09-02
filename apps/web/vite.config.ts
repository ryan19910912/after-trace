import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: resolve(__dirname, '../..'),
  plugins: [react()],
});
