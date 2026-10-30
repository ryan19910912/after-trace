import {readAdminCredentials} from './admin-auth.mjs';
import assert from 'node:assert/strict';
import { createHmac, randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const config=JSON.parse(readFileSync('.test-artifacts/wrangler.integration.json','utf8'));
assert.equal(new URL(config.vars.DATABASE_URL).hostname,'127.0.0.1','Refuse non-local database');
const base='http://127.0.0.1:18787', origin='http://localhost:15173';
const runId=randomUUID().slice(0,8), checks=[];
export function sql(text) {
 const result=spawnSync('docker',['compose','-f','compose.integration.yaml','exec','-T','postgres','psql','-U','aftertrace','-d','aftertrace','-At','-v','ON_ERROR_STOP=1','-c',text],{encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr||result.error?.message);
 return result.stdout.trim();
}
function seed(label) {
 const alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ'; const publicAccountId='AT-'+[...randomBytes(12)].map(byte=>alphabet[byte%alphabet.length]).join('');
 const record=JSON.parse(sql(`WITH u AS (INSERT INTO worklog_users(display_name) VALUES ('Local ${label} ${runId}') RETURNING id),
 p AS (INSERT INTO worklog_user_public_accounts(user_id,public_account_id) SELECT id,'${publicAccountId}' FROM u RETURNING user_id),
 w AS (INSERT INTO worklog_workspaces(owner_user_id,name) SELECT user_id,'Local integration' FROM p RETURNING id,owner_user_id),
 s AS (INSERT INTO worklog_sources(workspace_id,type,private_user_id,created_by_user_id) SELECT id,'PRIVATE',owner_user_id,owner_user_id FROM w RETURNING id,private_user_id)
 SELECT json_build_object('userId',private_user_id,'sourceId',id) FROM s`));
 const payload=Buffer.from(JSON.stringify({type:'WEB_SESSION',userId:record.userId,expiresAt:Math.floor(Date.now()/1000)+86400})).toString('base64url');
 return {...record,publicAccountId,token:payload+'.'+createHmac('sha256',config.vars.WEB_AUTH_SECRET).update(Buffer.from(payload,'base64url')).digest('base64url')};
}
const owner=seed('owner'),member=seed('member'),outsider=seed('outsider');
async function request(path,{user=owner,method='GET',body,status=200,requestOrigin=origin}={}) {
 const headers={'Content-Type':'application/json',Origin:requestOrigin}; if(user)headers.Authorization='Bearer '+user.token;
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return value;
}
async function check(name,run){await run();checks.push(name);console.log('PASS',name);}
let record, group;
await check('database schema and Worker readiness',async()=>{assert.equal((await request('/health/ready')).status,'ready');assert.equal(Number(sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")),40);});
await check('authentication and origin checks',async()=>{await request('/api/v1/worklog/surfaces',{user:null,status:401});await request('/api/v1/worklog/surfaces',{user:{token:'invalid'},status:401});await request('/api/v1/worklog/surfaces',{requestOrigin:'https://untrusted.example',status:403});});
await check('real account profile and personal scope',async()=>{assert.equal((await request('/api/v1/account/profile')).profile.publicAccountId,owner.publicAccountId);assert.equal((await request('/api/v1/worklog/surfaces')).surfaces.personal.sourceId,owner.sourceId);});
await check('create record persisted in PostgreSQL',async()=>{record=(await request('/api/v1/worklog/records/personal',{method:'POST',body:{title:'整合測試',rawText:`Docker 測試 ${runId}`,occurredAt:null},status:201})).record;assert.equal(record.version,1);assert.equal(sql(`SELECT raw_text FROM worklog_records WHERE id=${record.id}`),`Docker 測試 ${runId}`);});
await check('keyword search and private-data isolation',async()=>{const rows=(await request(`/api/v1/worklog/records/personal?query=${encodeURIComponent(runId)}`)).records;assert.equal(rows.length,1);assert.equal(rows[0].id,record.id);assert.equal((await request('/api/v1/worklog/records/personal',{user:outsider})).records.length,0);await request(`/api/v1/worklog/records/${record.id}/revisions`,{user:outsider,status:403});});
await check('edit, optimistic locking and revision history',async()=>{record=(await request(`/api/v1/worklog/records/${record.id}`,{method:'PATCH',body:{expectedVersion:1,rawText:'使用者修改確認後的內容'}})).record;assert.equal(record.version,2);await request(`/api/v1/worklog/records/${record.id}`,{method:'PATCH',body:{expectedVersion:1,rawText:'不能覆蓋'},status:409});const revisions=(await request(`/api/v1/worklog/records/${record.id}/revisions`)).revisions;assert.equal(revisions.length,1);assert.equal(revisions[0].newRawText,'使用者修改確認後的內容');});
await check('recycle bin and restore',async()=>{record=(await request(`/api/v1/worklog/records/${record.id}`,{method:'DELETE',body:{expectedVersion:record.version}})).record;assert.equal(record.status,'DELETED');assert.equal((await request('/api/v1/worklog/records/personal/deleted')).records.length,1);record=(await request(`/api/v1/worklog/records/${record.id}/restore`,{method:'POST',body:{expectedVersion:record.version}})).record;assert.equal(record.status,'ACTIVE');assert.equal(record.version,4);});
await check('native group access and one-use invitation',async()=>{group=(await request('/api/v1/groups',{method:'POST',body:{name:`整合測試群組 ${runId}`},status:201})).group;await request(`/api/v1/worklog/records/group/${group.sourceId}`,{user:member,status:403});const invite=await request(`/api/v1/groups/${group.sourceId}/invites`,{method:'POST',body:{maxUses:1},status:201});assert.equal((await request('/api/v1/groups/join',{user:member,method:'POST',body:{token:invite.inviteToken}})).status,'JOINED');await request('/api/v1/groups/join',{user:outsider,method:'POST',body:{token:invite.inviteToken},status:404});const shared=(await request(`/api/v1/worklog/records/group/${group.sourceId}`,{user:member,method:'POST',body:{rawText:'群組共享內容'},status:201})).record;assert.equal((await request(`/api/v1/worklog/records/group/${group.sourceId}`)).records[0].id,shared.id);await request(`/api/v1/worklog/records/group/${group.sourceId}`,{user:outsider,status:403});});
await check('task creation, completion and access isolation',async()=>{let task=(await request('/api/v1/tasks',{method:'POST',body:{title:'完成本地整合測試',sourceId:owner.sourceId,recordId:record.id},status:201})).task;assert.equal(task.status,'OPEN');await request(`/api/v1/tasks/${task.id}/complete`,{user:outsider,method:'POST',status:404});task=(await request(`/api/v1/tasks/${task.id}/complete`,{method:'POST'})).task;assert.equal(task.status,'COMPLETED');});
await check('cloud AI and file endpoints cannot write records',async()=>{const before=sql('SELECT count(*) FROM worklog_records');for(const path of ['text','image','audio','file','summary','rewrite','search'])await request('/api/v1/ai/capture/'+path,{method:'POST',body:{text:'不得保存'},status:410});assert.equal(sql('SELECT count(*) FROM worklog_records'),before);await request('/api/v1/payments/newebpay/checkout',{method:'POST',body:{},status:410});});
await check('notification center without billing dependencies',async()=>{assert.ok(Array.isArray((await request('/api/v1/notifications')).items));const retired=await fetch(base+'/api/v1/subscription/plans');assert.equal(retired.status,410);});
await check('Admin real credential verification',async()=>{await request('/api/v1/admin/login',{user:null,requestOrigin:'http://localhost:15174',method:'POST',body:{username:'local-admin',password:'wrong'},status:401});assert.ok((await request('/api/v1/admin/login',{user:null,requestOrigin:'http://localhost:15174',method:'POST',body:readAdminCredentials()})).sessionToken);});
writeFileSync('.test-artifacts/integration-session.json',JSON.stringify({owner,member,outsider,record,group,runId},null,2));
writeFileSync('.test-artifacts/integration-api-results.json',JSON.stringify({checks,runId,passed:checks.length},null,2));
console.log(`ALL ${checks.length} DATABASE/API INTEGRATION CHECKS PASSED`);
