import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:5173');
console.log(JSON.stringify(await page.evaluate(async () => {
 const gpu = navigator.gpu;
 const adapter = gpu ? await gpu.requestAdapter() : null;
 return { webgpu: !!gpu, adapter: !!adapter, info: adapter?.info };
})));
await browser.close();
