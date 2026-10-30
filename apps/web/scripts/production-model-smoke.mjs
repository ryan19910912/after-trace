import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const assets='apps/web/dist/assets';
const workerName=fs.readdirSync(assets).find(name=>/^local-ai\.worker-.*\.js$/.test(name));
const browser=await chromium.launchPersistentContext('.test-artifacts/production-browser-cache',{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage();
const remotePosts=[];
page.on('request',req=>{if(req.method()==='POST'&&!req.url().startsWith('http://localhost'))remotePosts.push(req.url());});
page.on('console',msg=>{if(msg.text().startsWith('PRODUCTION_TEST'))console.log(msg.text());});
await page.route('**/model-smoke.html',route=>route.fulfill({contentType:'text/html',body:'<html><body>Production worker test</body></html>'}));
await page.goto('http://localhost:4173/model-smoke.html');
try {
 const result=await page.evaluate(async workerName=>{
  const worker=new Worker('/assets/'+workerName,{type:'module'});
  try {
   return await new Promise((resolve,reject)=>{
    let previous='';
    worker.onmessage=({data})=>{if(data.type==='result')resolve(data.text);else if(data.type==='error')reject(new Error(data.text));else{const next=data.text.replace(/\d+%/g,'');if(next!==previous){console.log('PRODUCTION_TEST',data.text);previous=next;}}};
    worker.onerror=event=>reject(new Error(event.message));
    worker.postMessage({prompt:'將下列內容整理成繁體中文，只輸出 JSON {"title":"標題","rawText":"內容"}：今天完成登入功能，明天測試。'});
   });
  }finally{worker.terminate();}
 },workerName);
 console.log('PRODUCTION_WORKER_RESULT',result);
 if(remotePosts.length)throw new Error('Unexpected remote POST');
 console.log('PRODUCTION_REMOTE_POSTS',JSON.stringify(remotePosts));
 fs.writeFileSync('.test-artifacts/production-model-smoke.json',JSON.stringify({result,remotePosts},null,2));
}finally{await browser.close();}
