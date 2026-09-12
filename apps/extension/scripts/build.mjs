import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'prod') {
  throw new Error('Usage: node scripts/build.mjs <dev|prod>');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const outDir = path.join(root, `dist-${mode}`);
const manifestPath = path.join(root, `manifest.${mode}.json`);
const webAppUrl = mode === 'dev'
  ? 'https://after-trace-web-dev.a0955625660.workers.dev'
  : 'https://after-trace-web-prod.a0955625660.workers.dev';
const apiBaseUrl = mode === 'dev'
  ? 'https://after-trace-api-dev.a0955625660.workers.dev'
  : 'https://after-trace-api-prod.a0955625660.workers.dev';

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of ['background.js', 'popup.html', 'popup.js', 'screenshot-ai.js']) {
  await cp(path.join(root, file), path.join(outDir, file));
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(path.join(outDir, 'config.js'), `globalThis.AFTERTRACE_EXTENSION_CONFIG = ${JSON.stringify({ mode, webAppUrl, apiBaseUrl })};\n`, 'utf8');

console.log(`Built AFTERTRACE extension (${mode}) -> ${outDir}`);
