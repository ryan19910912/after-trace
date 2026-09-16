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
  ? 'https://after-trace-web-dev.after-lab.workers.dev'
  : 'https://after-trace-web-prod.after-lab.workers.dev';
const apiBaseUrl = mode === 'dev'
  ? 'https://after-trace-api-dev.after-lab.workers.dev'
  : 'https://after-trace-api-prod.after-lab.workers.dev';

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of ['background.js', 'popup.html', 'popup.js', 'screenshot-ai.js']) {
  await cp(path.join(root, file), path.join(outDir, file));
}
await cp(path.join(root, 'icons'), path.join(outDir, 'icons'), { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const popupPath = path.join(outDir, 'popup.js');
let popup = await readFile(popupPath, 'utf8');
popup = popup.replace(
  /const DEFAULT_WEB_APP_URL = '[^']+';\s*const WEB_APP_ORIGINS = new Set\(\[[\s\S]*?\]\);/,
  `const DEFAULT_WEB_APP_URL = '${webAppUrl}';\nconst WEB_APP_ORIGINS = new Set(['${webAppUrl}']);`,
);
await writeFile(popupPath, popup, 'utf8');

const backgroundPath = path.join(outDir, 'background.js');
let background = await readFile(backgroundPath, 'utf8');
background = background.replace(
  /const WEB_TO_API = new Map\(\[[\s\S]*?\]\);/,
  `const WEB_TO_API = new Map([\n  ['${webAppUrl}', '${apiBaseUrl}'],\n]);`,
);
await writeFile(backgroundPath, background, 'utf8');

const popupHtmlPath = path.join(outDir, 'popup.html');
let popupHtml = await readFile(popupHtmlPath, 'utf8');
popupHtml = popupHtml.replace(
  /href="https:\/\/after-trace-web-(?:dev|prod)\.(?:a0955625660|after-lab)\.workers\.dev\/"/,
  `href="${webAppUrl}/"`,
);
await writeFile(popupHtmlPath, popupHtml, 'utf8');

console.log(`Built AFTERTRACE extension (${mode}) -> ${outDir}`);
console.log(`Web: ${webAppUrl}`);
console.log(`API: ${apiBaseUrl}`);
