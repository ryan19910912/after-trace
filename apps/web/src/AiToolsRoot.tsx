import { useEffect, useMemo, useState } from 'react';
import { aiToolsDeepLinkFromSearch, aiToolsDeepLinkUrl } from './ai-tools-deep-link';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type WorklogInputType, type WorklogSurfaces } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';

type RelatedRecord = { id:number; inputType:WorklogInputType; title:string|null; rawText:string; occurredAt:string|null; createdAt:string; relevanceScore:number };
type RewriteProposal = { recordId:number; expectedVersion:number; originalText:string; proposedText:string };

export function AiToolsRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const worklogApi = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const deepLink = useMemo(() => aiToolsDeepLinkFromSearch(window.location.search), []);
  const loginReturn = useMemo(() => deepLink ? aiToolsDeepLinkUrl(deepLink) : '/ai-tools', [deepLink]);
  const [session,setSession]=useState<string|null>(()=>localStorage.getItem(SESSION_KEY));
  const [surfaces,setSurfaces]=useState<WorklogSurfaces|null>(null);
  const [sourceId,setSourceId]=useState<number|null>(null);
  const [relatedRecordId,setRelatedRecordId]=useState(()=>deepLink?.tool==='related'?String(deepLink.recordId):'');
  const [related,setRelated]=useState<RelatedRecord[]>([]);
  const [summaryFrom,setSummaryFrom]=useState(''); const [summaryTo,setSummaryTo]=useState(''); const [summary,setSummary]=useState<string|null>(null); const [summaryMeta,setSummaryMeta]=useState<string|null>(null);
  const [rewriteRecordId,setRewriteRecordId]=useState(()=>deepLink?.tool==='rewrite'?String(deepLink.recordId):'');
  const [rewriteInstruction,setRewriteInstruction]=useState('改得更清楚、精簡，但保留原本事實。');
  const [proposal,setProposal]=useState<RewriteProposal|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null); const [notice,setNotice]=useState<string|null>(null);

  useEffect(()=>{void bootstrap()},[]);
  async function bootstrap(){setBusy(true);setError(null);try{const hash=new URLSearchParams(location.hash.replace(/^#/,''));const callback=hash.get('session')?.trim();const token=callback||localStorage.getItem(SESSION_KEY);if(callback){localStorage.setItem(SESSION_KEY,callback);setSession(callback);history.replaceState({},document.title,`${location.pathname}${location.search}`)}if(!token)return;const next=await worklogApi.surfaces(token);setSurfaces(next);const fallback=next.personal?.sourceId??next.groups[0]?.sourceId??null;const linked=deepLink&&sourceExists(next,deepLink.sourceId)?deepLink.sourceId:null;setSourceId(linked??fallback);if(deepLink&&!linked)setNotice('原本指定的紀錄範圍目前無法使用，已改用你可存取的預設範圍。');if(deepLink&&linked)window.setTimeout(()=>document.getElementById(deepLink.tool)?.scrollIntoView({block:'start'}),0)}catch(cause){handleError(cause,'AI 工具載入失敗')}finally{setBusy(false)}}

  async function loadRelated(){const recordId=positiveId(relatedRecordId);if(!session||!sourceId||!recordId||busy)return;setBusy(true);setError(null);setNotice(null);setRelated([]);try{const body=await postAi('/related',{sourceId,recordId,limit:8});const rows=Array.isArray(body.records)?body.records:[];setRelated(rows.map(relatedRecord).filter((row):row is RelatedRecord=>row!==null));setNotice(rows.length?null:'目前沒有找到明顯相關的紀錄。')}catch(cause){handleError(cause,'相關紀錄載入失敗')}finally{setBusy(false)}}

  async function createSummary(){if(!session||!sourceId||!summaryFrom||!summaryTo||busy)return;const from=localIso(summaryFrom),to=localIso(summaryTo);if(!from||!to||new Date(from).getTime()>=new Date(to).getTime()){setError('請輸入有效的開始與結束時間。');return}setBusy(true);setError(null);setNotice(null);setSummary(null);setSummaryMeta(null);try{const body=await postAi('/summary',{sourceId,from,to,timeZone:browserTimeZone()});if(body.status==='NO_RECORDS'){setNotice('這個時間區間沒有可摘要的紀錄。');return}const text=typeof body.summary==='string'?body.summary.trim():'';if(!text)throw new Error('AI_SUMMARY_INVALID_RESPONSE');setSummary(text);const count=Number(body.recordCount??0);setSummaryMeta(`${Number.isSafeInteger(count)?count:0} 筆紀錄${body.truncated===true?'（內容較多，已依單次處理上限擷取重點）':''} · AI Pro`)}catch(cause){handleError(cause,'區間摘要失敗')}finally{setBusy(false)}}

  async function proposeRewrite(){const recordId=positiveId(rewriteRecordId);if(!session||!sourceId||!recordId||!rewriteInstruction.trim()||busy)return;setBusy(true);setError(null);setNotice(null);setProposal(null);try{const body=await postAi('/rewrite',{sourceId,recordId,instruction:rewriteInstruction.trim()});const proposedText=typeof body.proposedText==='string'?body.proposedText.trim():'';const originalText=typeof body.originalText==='string'?body.originalText:'';const expectedVersion=Number(body.expectedVersion);if(!proposedText||!Number.isSafeInteger(expectedVersion)||expectedVersion<=0)throw new Error('AI_REWRITE_INVALID_RESPONSE');setProposal({recordId,expectedVersion,originalText,proposedText})}catch(cause){handleError(cause,'AI 改寫失敗')}finally{setBusy(false)}}

  async function acceptRewrite(){if(!session||!proposal||busy)return;if(!window.confirm('確定用 AI 建議內容更新這筆紀錄？如果這筆紀錄剛好已被更新，系統會避免覆蓋較新的內容。'))return;setBusy(true);setError(null);try{await worklogApi.updateRecord(session,proposal.recordId,{expectedVersion:proposal.expectedVersion,rawText:proposal.proposedText});setProposal(null);setNotice('AI 建議內容已套用，原本的修改紀錄也會保留。')}catch(cause){handleError(cause,'套用 AI 改寫失敗')}finally{setBusy(false)}}

  async function postAi(path:string,body:Record<string,unknown>){if(!session)throw new Error('WEB_SESSION_REQUIRED');const response=await fetch(`${apiBaseUrl.replace(/\/$/,'')}/api/v1/ai/capture${path}`,{method:'POST',headers:{Authorization:`Bearer ${session}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await responseBody(response);if(!response.ok)throw new Error(typeof value.error==='string'?value.error:`AI_TOOLS_FAILED_${response.status}`);return value}
  function handleError(cause:unknown,fallback:string){if(sessionError(cause)){localStorage.removeItem(SESSION_KEY);setSession(null);setSurfaces(null);setSourceId(null);setError('登入已過期，請重新登入。');return}setError(aiErrorMessage(cause,fallback))}

  if(!session)return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE AI</p><h1>AI 工具</h1><p className="muted">登入後可使用 AI Pro 找相關紀錄、整理一段時間的內容，或取得改寫建議。</p>{error?<div className="error">{error}</div>:null}<LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo={loginReturn}/></section></main>;

  return <main className="shell worklog-shell"><div className="topbar"><div><p className="eyebrow">AFTERTRACE AI</p><h1>AI 工具</h1><p className="muted">這些功能需要 AI Pro，而且只會使用你有權限查看的紀錄。</p></div></div>{error?<div className="error">{error}</div>:null}{notice?<div className="worklog-notice">{notice}</div>:null}
    <section className="panel stack"><label>紀錄範圍<select value={sourceId??''} disabled={busy||!surfaces} onChange={(event)=>{setSourceId(Number(event.target.value)||null);setRelated([]);setSummary(null);setProposal(null)}}>{surfaces?.personal?<option value={surfaces.personal.sourceId}>我的紀錄</option>:null}{surfaces?.groups.map(group=><option key={group.sourceId} value={group.sourceId}>{group.name}</option>)}</select></label></section>

    <section id="related" className="panel stack"><div><p className="eyebrow">相關紀錄</p><h2>找相似或相關的紀錄</h2></div><p className="muted">如果從某筆紀錄進來，系統會自動帶入紀錄編號；你也可以手動輸入。只會在目前選擇的紀錄範圍內比對。</p><label>紀錄編號<input inputMode="numeric" value={relatedRecordId} onChange={(event)=>setRelatedRecordId(event.target.value)}/></label><button disabled={busy||!sourceId||!positiveId(relatedRecordId)} onClick={()=>void loadRelated()}>{busy?'處理中…':'找相關紀錄'}</button>{related.length?<div className="worklog-record-list">{related.map(record=><article key={record.id} className="worklog-record-card"><div className="worklog-record-meta"><span>紀錄 #{record.id}</span>{record.title?<span>{record.title}</span>:null}</div><strong>{record.rawText}</strong></article>)}</div>:null}</section>

    <section className="panel stack"><div><p className="eyebrow">時間摘要</p><h2>整理一段時間的工作內容</h2></div><p className="muted">選擇開始與結束時間後，AI Pro 會整理這段期間內你有權限查看的紀錄。</p><div className="record-filter-grid"><label>從<input type="datetime-local" value={summaryFrom} onChange={(event)=>setSummaryFrom(event.target.value)}/></label><label>到<input type="datetime-local" value={summaryTo} onChange={(event)=>setSummaryTo(event.target.value)}/></label></div><button disabled={busy||!sourceId||!summaryFrom||!summaryTo} onClick={()=>void createSummary()}>{busy?'摘要中…':'產生 AI 摘要'}</button>{summary?<article className="worklog-record-card"><div className="worklog-record-meta"><span>{summaryMeta}</span></div><strong>{summary}</strong></article>:null}</section>

    <section id="rewrite" className="panel stack"><div><p className="eyebrow">改寫建議</p><h2>讓紀錄更清楚</h2></div><p className="muted">AI Pro 只會先提出建議，不會直接改掉你的紀錄。你確認後才會套用，原本內容也會保留在修改紀錄中。</p><label>紀錄編號<input inputMode="numeric" value={rewriteRecordId} onChange={(event)=>setRewriteRecordId(event.target.value)}/></label><label>希望怎麼調整<textarea rows={3} maxLength={1000} value={rewriteInstruction} onChange={(event)=>setRewriteInstruction(event.target.value)}/></label><button disabled={busy||!sourceId||!positiveId(rewriteRecordId)||!rewriteInstruction.trim()} onClick={()=>void proposeRewrite()}>{busy?'產生中…':'產生改寫建議'}</button>{proposal?<div className="stack"><article className="worklog-record-card"><div className="worklog-record-meta"><span>目前內容</span></div><strong>{proposal.originalText}</strong></article><article className="worklog-record-card"><div className="worklog-record-meta"><span>AI Pro 建議</span></div><strong>{proposal.proposedText}</strong></article><div className="filter-actions"><button disabled={busy} onClick={()=>void acceptRewrite()}>確認套用</button><button className="ghost" disabled={busy} onClick={()=>setProposal(null)}>取消</button></div></div>:null}</section>
  </main>;
}

function relatedRecord(value:unknown):RelatedRecord|null{const raw=plainObject(value);const id=Number(raw.id),score=Number(raw.relevanceScore??raw.relevance_score);const rawText=typeof raw.rawText==='string'?raw.rawText:typeof raw.raw_text==='string'?raw.raw_text:'';if(!Number.isSafeInteger(id)||id<=0||!rawText.trim()||!Number.isFinite(score))return null;return{id,inputType:inputType(raw.inputType??raw.input_type),title:nullableString(raw.title),rawText:rawText.trim(),occurredAt:nullableString(raw.occurredAt??raw.occurred_at),createdAt:String(raw.createdAt??raw.created_at??''),relevanceScore:score}}
function sourceExists(surfaces:WorklogSurfaces,sourceId:number){return surfaces.personal?.sourceId===sourceId||surfaces.groups.some(group=>group.sourceId===sourceId)}
function inputType(value:unknown):WorklogInputType{return value==='AUDIO'||value==='IMAGE'||value==='FILE'?value:'TEXT'}
function positiveId(value:string){const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:null}
function localIso(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString()}
function browserTimeZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Taipei'}catch{return'Asia/Taipei'}}
function plainObject(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{} }
function nullableString(value:unknown){return value===null||value===undefined||value===''?null:String(value)}
async function responseBody(response:Response):Promise<Record<string,unknown>>{const text=await response.text();if(!text)return{};try{return JSON.parse(text)as Record<string,unknown>}catch{throw new Error(`AI_TOOLS_INVALID_RESPONSE_${response.status}`)}}
function sessionError(cause:unknown){const code=cause instanceof Error?cause.message:String(cause??'');return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED|WORKLOG_USER_NOT_FOUND/.test(code)}
function aiErrorMessage(cause:unknown,fallback:string){const code=cause instanceof Error?cause.message:String(cause??'');if(/TRIAL_EXHAUSTED|AI_NOT_ENTITLED|AI_PRO_REQUIRED/.test(code))return'這項功能需要 AI Pro；免費方案仍可使用一般紀錄、一般搜尋與尚未用完的 AI 搜尋體驗。';if(/MONTHLY_POINT_CAP|MONTHLY_PROVIDER_COST_CAP/.test(code))return'本期 AI 使用量已達方案上限，下一個週期會恢復；一般功能不受影響。';if(code==='SOURCE_NOT_AUTHORIZED')return'你目前沒有這個紀錄範圍的權限。';if(code.endsWith('_DISABLED'))return'這項 AI 功能目前暫停使用；一般功能不受影響。';if(code==='RECORD_NOT_FOUND')return'找不到這筆紀錄，或它已不在目前的紀錄範圍中。';return cause instanceof Error&&cause.message&&!/^[A-Z0-9_]+$/.test(cause.message)?cause.message:fallback}
