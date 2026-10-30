import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
fs.mkdirSync('.test-artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => localStorage.setItem('aftertrace.worklog.session','smoke-session'));
page.on('pageerror', error => console.log('PAGE_ERROR', error.message));
const saved = [];
const cloudCalls = [];
page.on('request', request => { if (/generativelanguage|inference\.huggingface|api-inference/.test(request.url())) cloudCalls.push(request.url()); });
await page.route('http://localhost:8787/**', async route => {
 const request = route.request();
 const path = new URL(request.url()).pathname;
 const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
 if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
 if(path.endsWith('/surfaces')) return route.fulfill({json:{surfaces:{personal:{sourceId:1},groups:[]}},headers});
 if(request.method()==='POST') { saved.push(JSON.parse(request.postData())); return route.fulfill({json:{record:{id:1,sourceId:1,version:1,rawText:'已確認'}},headers}); }
 return route.fulfill({json:{records:[],page:{hasMore:false},notifications:[]},headers});
});
try {
 await page.goto('http://localhost:5173/capture');
 await page.getByRole('option',{name:'我的紀錄'}).waitFor({state:'attached'});
 await page.getByLabel('輸入內容或貼上圖片').fill('原始文字');
 assert.equal(saved.length,0);
 await page.getByRole('button',{name:'自行編輯草稿'}).click();

 await page.getByLabel('內容',{exact:true}).fill('使用者確認後的內容');
 assert.equal(saved.length,0);
 await page.screenshot({path:'.test-artifacts/review-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'.test-artifacts/review-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile horizontal overflow');
 await page.getByRole('button',{name:'確認保存'}).click();
 await page.getByRole('status').filter({hasText:'紀錄已保存'}).waitFor();
 assert.equal(saved.length,1);
 assert.equal(saved[0].rawText,'使用者確認後的內容');
 assert.equal(cloudCalls.length,0);
 console.log('BROWSER_SMOKE_PASS: review before save, edited text saved once, mobile layout, zero cloud inference');
} finally { await browser.close(); }
