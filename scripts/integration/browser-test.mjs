import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const require=createRequire(resolve('apps/web/package.json'));
const {chromium}=require('@playwright/test');
const state=JSON.parse(readFileSync('.test-artifacts/integration-session.json','utf8'));
const root='http://localhost:15173';
function sql(text){const result=spawnSync('docker',['compose','-f','compose.integration.yaml','exec','-T','postgres','psql','-U','aftertrace','-d','aftertrace','-At','-v','ON_ERROR_STOP=1','-c',text],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);return result.stdout.trim();}
const browser=await chromium.launchPersistentContext('.test-artifacts/integration-browser-cache',{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:1000}});
await browser.addInitScript(token=>localStorage.setItem('aftertrace.worklog.session',token),state.owner.token);
const page=await browser.newPage();
const cloudRequests=[],writes=[],errors=[];
page.on('request',request=>{if(/generativelanguage|api-inference\.huggingface|router\.huggingface/.test(request.url()))cloudRequests.push(request.url());if(request.method()==='POST'&&request.url().includes('/api/v1/worklog/records/'))writes.push(request.postDataJSON());});
page.on('pageerror',error=>errors.push(error.message));
const count=()=>Number(sql(`SELECT count(*) FROM worklog_records WHERE author_user_id=${state.owner.userId}`));
const checks=[];
async function waitForDraft(){
 const timer=setInterval(async()=>{try{console.log('BROWSER_STATUS',await page.getByRole('status').first().innerText());}catch{}},20000);
 try{
  await page.waitForFunction(()=>document.querySelector('[aria-label="保存前確認"]')||document.querySelector('[role="alert"]'),undefined,{timeout:600000});
  if(await page.getByRole('alert').count())throw new Error(await page.getByRole('alert').innerText());
 }finally{clearInterval(timer);}
}
try {
 await page.goto(root+'/capture');
 await page.getByRole('option',{name:'我的紀錄'}).waitFor({state:'attached'});
 const before=count();
 await page.getByLabel('輸入內容或貼上圖片').fill('今天完成網站登入功能，明天要測試。');
 await page.getByRole('button',{name:'AI 解析',exact:true}).click();
 console.log('LOCAL_AI_TEXT_PARSING_STARTED');
 await waitForDraft();
 assert.equal(count(),before,'AI draft must not create a DB record');
 console.log('PASS real local model produces draft without database write');checks.push('local AI parsing does not save');
 const confirmed=`使用者確認後保存 ${state.runId}-${Date.now()}`;
 await page.getByLabel('內容',{exact:true}).fill(confirmed);
 await page.screenshot({path:'.test-artifacts/integration-review-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'確認保存',exact:true}).click();
 await page.getByRole('status').filter({hasText:'紀錄已保存'}).waitFor();
 assert.equal(count(),before+1);assert.equal(writes.length,1);assert.equal(writes[0].rawText,confirmed);
 assert.equal(sql(`SELECT raw_text FROM worklog_records WHERE author_user_id=${state.owner.userId} ORDER BY id DESC LIMIT 1`),confirmed);
 checks.push('edited confirmed text persisted through real API');console.log('PASS edited confirmed text persisted through real API into Docker PostgreSQL');
 // Paste an actual generated image; no file/media upload endpoint is used.
 await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=220;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,220);ctx.fillStyle='black';ctx.font='32px sans-serif';ctx.fillText('工作紀錄',30,60);ctx.fillText('今天完成登入功能',30,120);ctx.fillText('明天進行測試',30,180);
  return new Promise(resolve=>canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'capture.png',{type:'image/png'}));document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));resolve();},'image/png'));
 });
 await page.getByAltText('待解析圖片').waitFor();
 await page.getByRole('button',{name:'AI 解析',exact:true}).click();
 await waitForDraft();
 assert.equal(count(),before+1);assert.equal(writes.length,1);
 assert.ok((await page.getByLabel('內容',{exact:true}).inputValue()).length>0);
 checks.push('pasted image parsed locally without upload or save');console.log('PASS pasted image parsed locally without upload or save');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'.test-artifacts/integration-review-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByLabel('內容',{exact:true}).fill('圖片解析後由使用者確認 '+state.runId);
 await page.getByRole('button',{name:'確認保存',exact:true}).click();
 await page.getByRole('status').filter({hasText:'紀錄已保存'}).waitFor();
 assert.equal(count(),before+2);assert.equal(writes.length,2);assert.ok(!JSON.stringify(writes).includes('dataBase64'));
 checks.push('mobile image confirmation saves text only');
 await page.goto(root+'/');await page.getByText(confirmed,{exact:true}).first().waitFor();checks.push('saved record survives reload and appears on home');
 assert.equal(cloudRequests.length,0);assert.equal(errors.length,0,JSON.stringify(errors));
 writeFileSync('.test-artifacts/integration-browser-results.json',JSON.stringify({checks,passed:checks.length,cloudRequests,errors,runId:state.runId},null,2));
 console.log(`ALL ${checks.length} REAL BROWSER/DATABASE INTEGRATION CHECKS PASSED; ZERO CLOUD AI REQUESTS`);
}catch(error){await page.screenshot({path:'.test-artifacts/integration-browser-failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw error;}
finally{await browser.close();}
