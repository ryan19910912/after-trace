import fs from 'node:fs';
import { chromium } from '@playwright/test';
const browser = await chromium.launchPersistentContext('.test-artifacts/browser-cache', { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const remotePosts = [];
page.on('request', req => { if (req.method() === 'POST' && !req.url().startsWith('http://localhost')) remotePosts.push(req.url()); });
page.on('console', msg => { if (msg.text().startsWith('LOCAL_TEST')) console.log(msg.text()); });
await page.route('**/model-smoke.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Local AI model verification</body></html>' }));
await page.goto('http://localhost:5173/model-smoke.html');
await page.waitForLoadState('networkidle');
try {
 const result = process.argv.includes('--audio-only') ? {} : await page.evaluate(async () => {
  const { organizeLocal } = await import('/src/local-ai.ts');
  let previous = '';
  const progress = text => { const next = text.replace(/\d+%/g, ''); if (next !== previous) { console.log('LOCAL_TEST', text); previous = next; } };
  const text = await organizeLocal('今天完成網站登入功能，明天要測試。', undefined, progress);
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 240;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,640,240); ctx.fillStyle = 'black'; ctx.font = '32px sans-serif';
  ctx.fillText('工作紀錄', 30, 60); ctx.fillText('今天完成登入功能', 30, 120); ctx.fillText('明天進行測試', 30, 180);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const image = await organizeLocal('請辨識圖片中的工作紀錄文字。', blob, progress);
  return { text, image };
 });
 console.log('TEXT_IMAGE_RESULTS', JSON.stringify(result));
 const wav = [...fs.readFileSync('.test-artifacts/speech.wav')];
 const transcript = await page.evaluate(async (bytes) => {
  const { runLocalAi } = await import('/src/local-ai.ts');
  const context = new AudioContext({ sampleRate: 16000 });
  const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
  try { return await runLocalAi({ prompt: '', audio: audio.getChannelData(0) }, text => { if (!text.includes('%')) console.log('LOCAL_TEST',text); }); }
  finally { await context.close(); }
 }, wav);
 console.log('AUDIO_RESULT', transcript);
 console.log('REMOTE_INFERENCE_POSTS', JSON.stringify(remotePosts));
 if (!transcript.trim() || remotePosts.length) throw new Error('Audio empty or remote inference detected');
 fs.writeFileSync('.test-artifacts/model-smoke.json', JSON.stringify({ ...(fs.existsSync('.test-artifacts/model-smoke.json') ? JSON.parse(fs.readFileSync('.test-artifacts/model-smoke.json','utf8')) : {}), ...result, transcript, remotePosts }, null, 2));
} catch (error) { console.log('MODEL_SMOKE_FAILED', error.message); process.exitCode = 1; }
await browser.close();
