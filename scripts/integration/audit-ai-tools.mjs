import {createRequire} from 'node:module';import {resolve} from 'node:path';import {readFileSync,writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve('apps/web/package.json'))('@playwright/test');const state=JSON.parse(readFileSync('.test-artifacts/integration-session.json','utf8'));
function count(){return spawnSync('docker',['compose','-f','compose.integration.yaml','exec','-T','postgres','psql','-U','aftertrace','-d','aftertrace','-Atc','SELECT count(*) FROM worklog_records'],{encoding:'utf8'}).stdout.trim();}
const before=count(),browser=await chromium.launchPersistentContext('.test-artifacts/integration-browser-cache',{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});await browser.addInitScript(token=>localStorage.setItem('aftertrace.worklog.session',token),state.owner.token);const page=await browser.newPage();page.on('console',msg=>{if(msg.text().startsWith('AUDIT_TOOL_DONE'))console.log(msg.text());});page.on('requestfailed',r=>console.log('REQUEST_FAILED',r.url(),r.failure()?.errorText));let requests=[];const cloud=[];
page.on('request',r=>{if(r.url().includes(':18787/'))requests.push(new URL(r.url()).pathname);if(/generativelanguage|api-inference\.huggingface|router\.huggingface/.test(r.url()))cloud.push(r.url());});
await page.goto('http://localhost:15173/help');await page.waitForLoadState('networkidle');
try{
 const results=await page.evaluate(async state=>{
  const {organizeLocal}=await import('/src/local-ai.ts');const {localAiTool}=await import('/src/local-ai-tools.ts');const {WorklogApi}=await import('/src/worklog-api.ts');const api=new WorklogApi('http://localhost:18787');const timings=[];
  async function timed(name,run){const start=performance.now();const value=await run();timings.push({name,ms:Math.round(performance.now()-start),value});console.log('AUDIT_TOOL_DONE',name);return value;}
  await timed('first model initialization with cached weights',()=>organizeLocal('今天完成登入功能，明天測試。'));
  await timed('warm model text inference',()=>organizeLocal('今天完成登入功能，明天測試。'));
  const input={sourceId:state.owner.sourceId};
  await timed('natural search',()=>localAiTool(api,state.owner.token,'/search',{...input,query:'找出登入功能的紀錄',timeZone:'Asia/Taipei'}));
  await timed('rewrite proposal',()=>localAiTool(api,state.owner.token,'/rewrite',{...input,recordId:state.record.id,instruction:'保留事實，改得精簡清楚。'}));
  await timed('related records',()=>localAiTool(api,state.owner.token,'/related',{...input,recordId:state.record.id}));
  await timed('time range summary',()=>localAiTool(api,state.owner.token,'/summary',{...input,from:'2020-01-01T00:00:00Z',to:'2030-01-01T00:00:00Z'}));
  await timed('task proposal without record download',()=>localAiTool(api,state.owner.token,'/task-proposal',{...input,text:'回覆客戶網站登入功能的測試結果'}));
  return timings;
 },state);
 assert.equal(count(),before,'AI tools must not create records');assert.equal(cloud.length,0);
 for(const row of results){if(row.name==='rewrite proposal')assert.ok(row.value.proposedText?.trim());if(row.name==='time range summary')assert.ok(row.value.summary?.trim());if(row.name==='task proposal without record download')assert.ok(row.value.title?.trim());console.log(row.name,row.ms+'ms');}
 writeFileSync('.test-artifacts/audit/ai-tools.json',JSON.stringify({results,requests,cloud,recordsUnchanged:true},null,2));console.log('ALL LOCAL AI TOOLS INTEGRATION PASSED');
}finally{await browser.close();}
