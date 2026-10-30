import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: resolve(appDir, '../..'),
  plugins: [react()],
  worker: {
    format: 'es',
    // ORT downloads the matching static WASM runtime from its versioned CDN.
    // Prevent Vite from emitting an unused >25 MiB fallback asset to Workers.
    plugins: () => [{
      name: 'local-ai-runtime-assets',
      generateBundle(_options, bundle) {
        for (const [name, output] of Object.entries(bundle)) {
          if (output.type === 'asset' && /ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
        }
      },
    }],
  },
});
