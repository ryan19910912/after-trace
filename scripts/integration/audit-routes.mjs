import {readAdminCredentials} from './admin-auth.mjs';
import {createRequire} from 'node:module';import {resolve} from 'node:path';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=createRequire(resolve('apps/web/package.json'))('@playwright/test');const state=JSON.parse(readFileSync('.test-artifacts/integration-session.json','utf8'));mkdirSync('.test-artifacts/audit',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const user=await browser.newContext();await user.addInitScript(token=>localStorage.setItem('aftertrace.worklog.session',token),state.owner.token);
// Geometry audit uses the supported manual fallback; real GPU preload/inference is verified separately.
await user.addInitScript(() => Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined,configurable:true}));
const login=await fetch('http://localhost:18787/api/v1/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:15174'},body:JSON.stringify(readAdminCredentials())}).then(r=>r.json());
const admin=await browser.newContext();await admin.addInitScript(token=>sessionStorage.setItem('aftertrace.admin.session',token),login.sessionToken);
const phase=process.argv[2]??'before';const results=[];
for(const [context,base,paths] of [[user,'http://localhost:15173',['/','/capture','/tasks','/ai-search','/ai-tools','/ai-task','/worklog','/subscription','/feedback','/help','/about','/mobile-shortcut']],[admin,'http://localhost:15174',['/users','/ai?tab=prompts','/ai?tab=models','/announcements','/feedback-management','/roles','/permissions','/admin-accounts']]]){
 for(const width of [1440,768,390,320])for(const path of paths){
  const page=await context.newPage();await page.setViewportSize({width,height:900});const failed=[],errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes(':18787/')&&r.status()>=400)failed.push({url:r.url(),status:r.status()});});page.on('request',r=>{if(r.url().includes(':18787/'))requests.push(new URL(r.url()).pathname);});
  const start=performance.now();await page.goto(base+path);await page.waitForLoadState('networkidle',{timeout:6000}).catch(()=>errors.push('Network did not settle within 6 seconds'));
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),errorText:[...document.querySelectorAll('.error,.banner.error')].map(e=>e.textContent),unlabelled:[...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>({tag:e.tagName,placeholder:e.getAttribute('placeholder')})),buttons:[...document.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')).length}));
  const name=(base.includes('15174')?'admin':'web')+'-'+(path==='/'?'home':path.slice(1).replace(/[^a-z0-9-]/gi,'-'))+'-'+width;
  await page.screenshot({path:'.test-artifacts/audit/'+phase+'-'+name+'.png',fullPage:true});
  results.push({name,elapsedMs:Math.round(performance.now()-start),failed,errors,requests,...metrics});console.log(name,JSON.stringify({overflow:metrics.overflow,failed:failed.length,errors:errors.length,unlabelled:metrics.unlabelled.length,requests:requests.length,errorText:metrics.errorText}));await page.close();
 }
}
writeFileSync('.test-artifacts/audit/routes-'+phase+'.json',JSON.stringify(results,null,2));await browser.close();
