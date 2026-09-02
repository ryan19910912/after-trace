import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WorklogApi,
  type Customer,
  type GroupOwnerView,
  type Project,
  type RecordFilters,
  type RecordPage,
  type Transaction,
  type TransactionInput,
  type UserUsage,
  type WorklogCategory,
  type WorklogInputType,
  type WorklogRecord,
  type WorklogSurfaces,
} from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';
type Props = { apiBaseUrl: string };
type Scope = { type: 'PERSONAL'; sourceId: number } | { type: 'GROUP'; sourceId: number; lineGroupId: string };
type Page = 'RECORDS' | 'CUSTOMERS' | 'FINANCE' | 'FEEDBACK';
type FilterDraft = { query:string; inputType:''|WorklogInputType; category:''|WorklogCategory; customerId:string; projectId:string; from:string; to:string };
const EMPTY_FILTER:FilterDraft = { query:'', inputType:'', category:'', customerId:'', projectId:'', from:'', to:'' };

export function WorklogRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const started = useRef(false);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [records, setRecords] = useState<WorklogRecord[]>([]);
  const [recordPage, setRecordPage] = useState<RecordPage | null>(null);
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [ownerView, setOwnerView] = useState<GroupOwnerView | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [page, setPage] = useState<Page>('RECORDS');
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(EMPTY_FILTER);
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { if (!started.current) { started.current = true; void bootstrap(); } }, []);
  useEffect(() => {
    if (!session || !scope) return;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    void loadScope(session, scope, filters, false);
  }, [session, scope?.type, scope?.sourceId, filters]);
  useEffect(() => {
    if (!session || page === 'RECORDS' || page === 'FEEDBACK' || !surfaces?.personal) return;
    void loadWorkspaceData(session);
  }, [session, page, surfaces?.personal?.sourceId]);

  async function bootstrap() {
    setLoading(true); setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      const url = new URL(window.location.href);
      const entry = url.searchParams.get('t')?.trim();
      if (entry) {
        const exchanged = await api.exchangeEntry(entry);
        token = exchanged.sessionToken;
        persistSession(token); setSession(token);
        url.searchParams.delete('t'); url.searchParams.delete('openExternalBrowser');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        persistSession(callback); setSession(callback);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }
      if (!token) return;
      const [nextSurfaces, nextUsage] = await Promise.all([api.surfaces(token), api.myUsage(token)]);
      setSurfaces(nextSurfaces); setUsage(nextUsage);
      const remembered = storedScope();
      setScope(remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces));
      if (nextSurfaces.personal) void loadWorkspaceData(token, true);
    } catch (cause) {
      const text = message(cause, '載入失敗');
      if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text)) clearSession();
      setError(text);
    } finally { setLoading(false); }
  }

  async function loadScope(token:string, nextScope:Scope, nextFilters:FilterDraft, append:boolean) {
    setLoading(true); setError(null);
    try {
      const requestFilters = apiFilters(nextFilters, append ? recordPage?.nextOffset ?? 0 : 0);
      const result = nextScope.type === 'PERSONAL'
        ? await api.personalRecords(token, requestFilters)
        : await api.groupRecords(token, nextScope.sourceId, requestFilters);
      setRecords((current) => append ? dedupeRecords([...current, ...result.records]) : result.records);
      setRecordPage(result.page);
      setOwnerView(nextScope.type === 'GROUP' ? await api.ownerView(token, nextScope.sourceId) : null);
    } catch (cause) {
      setError(message(cause, '紀錄載入失敗'));
      if (!append) setRecords([]);
    } finally { setLoading(false); }
  }

  async function loadWorkspaceData(token:string, quiet=false) {
    if (!quiet) setLoading(true);
    try {
      const [nextCustomers,nextProjects,nextTransactions] = await Promise.all([api.customers(token), api.projects(token), api.transactions(token)]);
      setCustomers(nextCustomers); setProjects(nextProjects); setTransactions(nextTransactions);
    } catch (cause) { if (!quiet) setError(message(cause, '管理資料載入失敗')); }
    finally { if (!quiet) setLoading(false); }
  }

  async function refreshUsage() { if (session) setUsage(await api.myUsage(session)); }
  async function toggleMember(userId:number, enabled:boolean) {
    if (!session || scope?.type !== 'GROUP') return;
    try { await api.setRecordingEnabled(session, scope.sourceId, userId, enabled); setOwnerView(await api.ownerView(session, scope.sourceId)); setNotice('成員紀錄權限已更新。'); }
    catch (cause) { setError(message(cause, '權限更新失敗')); }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem(ACTIVE_SCOPE_KEY);
    setSession(null); setSurfaces(null); setScope(null); setRecords([]); setUsage(null); setOwnerView(null);
  }
  function applyFilters(){ setFilters({...filterDraft}); setRecordPage(null); }
  function clearFilters(){ setFilterDraft(EMPTY_FILTER); setFilters(EMPTY_FILTER); setRecordPage(null); }
  const canManageWorkspace = Boolean(surfaces?.personal);
  const canEditCurrentRecords = canManageWorkspace && (scope?.type === 'PERSONAL' || Boolean(ownerView));

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>工作紀錄中心</h1><p className="muted">使用 LINE 登入，查看與管理你的工作紀錄。</p>{error?<div className="error">{error}</div>:null}<button onClick={()=>{window.location.href=api.lineLoginUrl();}}>使用 LINE 登入</button></section></main>;

  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>工作紀錄</h1></div><button className="ghost" onClick={clearSession}>登出</button></div>
    {error?<div className="error">{error}</div>:null}{notice?<div className="worklog-notice">{notice}</div>:null}{usage?<UsageBar usage={usage}/>:null}
    <nav className="worklog-main-tabs">
      <button className={page==='RECORDS'?'active':''} onClick={()=>setPage('RECORDS')}>紀錄</button>
      {canManageWorkspace?<button className={page==='CUSTOMERS'?'active':''} onClick={()=>setPage('CUSTOMERS')}>客戶 / 專案</button>:null}
      {canManageWorkspace?<button className={page==='FINANCE'?'active':''} onClick={()=>setPage('FINANCE')}>收支</button>:null}
      <button className={page==='FEEDBACK'?'active':''} onClick={()=>setPage('FEEDBACK')}>意見回饋</button>
    </nav>

    {page==='RECORDS'?<>
      <ScopePicker surfaces={surfaces} scope={scope} onChange={setScope}/>
      {ownerView?<OwnerPanel view={ownerView} onToggle={toggleMember}/>:null}
      <RecordFiltersPanel draft={filterDraft} customers={customers} projects={projects} canUseWorkspaceFilters={canManageWorkspace} onChange={setFilterDraft} onApply={applyFilters} onClear={clearFilters}/>
      <section className="panel">
        {loading && records.length===0?<div className="empty">載入中…</div>:null}
        {!loading && scope && records.length===0?<div className="empty">目前沒有符合條件的紀錄。</div>:null}
        <div className="worklog-record-list">{records.map(record=><RecordCard key={record.id} record={record} editable={canEditCurrentRecords} customers={customers} projects={projects} onEdit={async input=>{if(!session||!scope)return;await api.updateRecord(session,record.id,input);await loadScope(session,scope,filters,false);setNotice('紀錄分類與關聯已更新；原始 LINE 內容沒有被修改。');}}/>)}</div>
        {recordPage?.hasMore?<button className="load-more" disabled={loading} onClick={()=>session&&scope&&void loadScope(session,scope,filters,true)}>{loading?'載入中…':'載入更多'}</button>:null}
      </section>
    </>:null}

    {page==='CUSTOMERS' && canManageWorkspace?<CustomerProjectPage customers={customers} projects={projects} loading={loading} onReload={()=>session?loadWorkspaceData(session):Promise.resolve()} api={{
      createCustomer:async input=>{if(!session)return;await api.createCustomer(session,input);await loadWorkspaceData(session,true);setNotice('客戶已新增。');},
      updateCustomer:async(id,input)=>{if(!session)return;await api.updateCustomer(session,id,input);await loadWorkspaceData(session,true);setNotice('客戶已更新。');},
      deleteCustomer:async id=>{if(!session||!window.confirm('刪除這個客戶？只有尚未被專案、紀錄或交易使用的客戶可以刪除。'))return;await api.deleteCustomer(session,id);await loadWorkspaceData(session,true);setNotice('客戶已刪除。');},
      createProject:async input=>{if(!session)return;await api.createProject(session,input);await loadWorkspaceData(session,true);setNotice('專案已新增。');},
      updateProject:async(id,input)=>{if(!session)return;await api.updateProject(session,id,input);await loadWorkspaceData(session,true);setNotice('專案已更新。');},
      deleteProject:async id=>{if(!session||!window.confirm('刪除這個專案？只有尚未被紀錄或交易使用的專案可以刪除。'))return;await api.deleteProject(session,id);await loadWorkspaceData(session,true);setNotice('專案已刪除。');},
    }}/>:null}

    {page==='FINANCE' && canManageWorkspace?<FinancePage transactions={transactions} customers={customers} projects={projects} loading={loading} onCreate={async input=>{if(!session)return;await api.createTransaction(session,input);await loadWorkspaceData(session,true);setNotice('收支已新增。');}} onUpdate={async(id,input)=>{if(!session)return;await api.updateTransaction(session,id,input);await loadWorkspaceData(session,true);setNotice('收支已更新。');}} onDelete={async id=>{if(!session||!window.confirm('刪除這筆收支？'))return;await api.deleteTransaction(session,id);await loadWorkspaceData(session,true);setNotice('收支已刪除。');}}/>:null}

    {page==='FEEDBACK'?<FeedbackPanel busy={loading} onSubmit={async text=>{if(!session)return;await api.submitFeedback(session,text,{page:window.location.pathname,viewport:`${window.innerWidth}x${window.innerHeight}`,userAgent:navigator.userAgent,appVersion:'worklog-mvp',scopeType:scope?.type??'NONE',sourceId:scope?.sourceId??0});setNotice('意見已送出，謝謝。');}}/>:null}
  </main>;
}

function ScopePicker({surfaces,scope,onChange}:{surfaces:WorklogSurfaces|null;scope:Scope|null;onChange:(scope:Scope)=>void}){return <section className="panel worklog-scope-panel"><div className="worklog-scope-row">{surfaces?.personal?<button className={scope?.type==='PERSONAL'?'worklog-scope active':'worklog-scope'} onClick={()=>onChange({type:'PERSONAL',sourceId:surfaces.personal!.sourceId})}>個人紀錄</button>:null}{surfaces?.groups.map((g,i)=><button key={g.sourceId} className={scope?.type==='GROUP'&&scope.sourceId===g.sourceId?'worklog-scope active':'worklog-scope'} onClick={()=>onChange({type:'GROUP',sourceId:g.sourceId,lineGroupId:g.lineGroupId})}>群組 {i+1}</button>)}</div></section>}
function UsageBar({usage}:{usage:UserUsage}){return <section className="panel worklog-usage"><strong>{usage.planCode}</strong><span>AI {usage.aiUsedUnits} / {usage.aiAllowanceUnits}</span><span>剩餘 {usage.aiRemainingUnits}</span><span>文字 {usage.records.TEXT} · 音檔 {usage.records.AUDIO} · 圖片 {usage.records.IMAGE} · 檔案 {usage.records.FILE}</span></section>}
function OwnerPanel({view,onToggle}:{view:GroupOwnerView;onToggle:(id:number,v:boolean)=>void}){return <section className="panel"><div className="worklog-owner-title"><div><p className="eyebrow">OWNER</p><h2>群組用量與成員</h2></div><span>群組 AI {view.groupAiUsedUnits}</span></div><div className="worklog-member-list">{view.members.map(m=><div className="worklog-member" key={m.userId}><div><strong>{m.displayName||`使用者 ${m.userId}`}</strong><small>AI {m.aiUsedUnits} · T {m.records.TEXT} / A {m.records.AUDIO} / I {m.records.IMAGE} / F {m.records.FILE}</small></div><label><input type="checkbox" checked={m.recordingEnabled} disabled={m.userId===view.ownerUserId} onChange={e=>onToggle(m.userId,e.target.checked)}/> 可紀錄</label></div>)}</div></section>}

function RecordFiltersPanel({draft,customers,projects,canUseWorkspaceFilters,onChange,onApply,onClear}:{draft:FilterDraft;customers:Customer[];projects:Project[];canUseWorkspaceFilters:boolean;onChange:(v:FilterDraft)=>void;onApply:()=>void;onClear:()=>void}){return <section className="panel record-filter-card"><div className="record-filter-grid"><label>搜尋<input value={draft.query} onChange={e=>onChange({...draft,query:e.target.value})} placeholder="內容 / 客戶 / 專案"/></label><label>類型<select value={draft.inputType} onChange={e=>onChange({...draft,inputType:e.target.value as FilterDraft['inputType']})}><option value="">全部</option>{['TEXT','AUDIO','IMAGE','FILE'].map(v=><option key={v}>{v}</option>)}</select></label><label>分類<select value={draft.category} onChange={e=>onChange({...draft,category:e.target.value as FilterDraft['category']})}><option value="">全部</option>{CATEGORIES.map(v=><option key={v}>{v}</option>)}</select></label>{canUseWorkspaceFilters?<label>客戶<select value={draft.customerId} onChange={e=>onChange({...draft,customerId:e.target.value})}><option value="">全部</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>:null}{canUseWorkspaceFilters?<label>專案<select value={draft.projectId} onChange={e=>onChange({...draft,projectId:e.target.value})}><option value="">全部</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:null}<label>從<input type="datetime-local" value={draft.from} onChange={e=>onChange({...draft,from:e.target.value})}/></label><label>到<input type="datetime-local" value={draft.to} onChange={e=>onChange({...draft,to:e.target.value})}/></label></div><div className="filter-actions"><button onClick={onApply}>套用篩選</button><button className="ghost" onClick={onClear}>清除</button></div></section>}

function RecordCard({record,editable,customers,projects,onEdit}:{record:WorklogRecord;editable:boolean;customers:Customer[];projects:Project[];onEdit:(input:{normalizedSummary:string|null;category:WorklogCategory;customerId:string|null;projectId:string|null})=>Promise<void>}){const [editing,setEditing]=useState(false);const [summary,setSummary]=useState(record.normalizedSummary??'');const [category,setCategory]=useState<WorklogCategory>(record.category);const [customerId,setCustomerId]=useState(record.customerId?String(record.customerId):'');const [projectId,setProjectId]=useState(record.projectId?String(record.projectId):'');const content=record.normalizedSummary||record.rawText||'尚無可顯示文字';const ts=record.sourceTimestamp||record.createdAt;return <article className="worklog-record-card"><div className="worklog-record-meta"><span>{inputLabel(record.inputType)}</span><span>{record.category}</span>{record.customerName?<span>客戶：{record.customerName}</span>:null}{record.projectName?<span>專案：{record.projectName}</span>:null}<time>{new Date(ts).toLocaleString('zh-TW')}</time>{editable?<button className="link-button" onClick={()=>setEditing(v=>!v)}>{editing?'取消':'整理'}</button>:null}</div><strong>{content}</strong>{record.rawText?<p className="muted worklog-raw">原始 LINE 內容：{record.rawText}</p>:null}{editing?<div className="record-editor"><label>摘要<textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={3}/></label><label>分類<select value={category} onChange={e=>setCategory(e.target.value as WorklogCategory)}>{CATEGORIES.map(v=><option key={v}>{v}</option>)}</select></label><label>客戶<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">未指定</option>{customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>專案<select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">未指定</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><p className="muted immutable-note">原始 LINE 內容是 source of truth，不允許在 PWA 覆寫。</p><button onClick={()=>void onEdit({normalizedSummary:summary.trim()||null,category,customerId:customerId||null,projectId:projectId||null}).then(()=>setEditing(false))}>儲存整理結果</button></div>:null}</article>}

function CustomerProjectPage({customers,projects,loading,api}:{customers:Customer[];projects:Project[];loading:boolean;onReload:()=>Promise<void>;api:{createCustomer:(input:CustomerForm)=>Promise<void>;updateCustomer:(id:string,input:CustomerForm)=>Promise<void>;deleteCustomer:(id:string)=>Promise<void>;createProject:(input:ProjectForm)=>Promise<void>;updateProject:(id:string,input:ProjectForm)=>Promise<void>;deleteProject:(id:string)=>Promise<void>}}){return <section className="management-grid"><article className="panel"><div className="section-title"><h2>客戶</h2><span>{customers.length}</span></div><CustomerEditor onSave={api.createCustomer}/>{loading?<p>載入中…</p>:customers.map(c=><CustomerRow key={c.id} value={c} onSave={input=>api.updateCustomer(c.id,input)} onDelete={()=>api.deleteCustomer(c.id)}/>)}</article><article className="panel"><div className="section-title"><h2>專案</h2><span>{projects.length}</span></div><ProjectEditor customers={customers} onSave={api.createProject}/>{projects.map(p=><ProjectRow key={p.id} value={p} customers={customers} onSave={input=>api.updateProject(p.id,input)} onDelete={()=>api.deleteProject(p.id)}/>)}</article></section>}
type CustomerForm={name:string;phone:string|null;address:string|null;note:string|null};
function CustomerEditor({onSave,initial}:{onSave:(v:CustomerForm)=>Promise<void>;initial?:Customer}){const [name,setName]=useState(initial?.name??''),[phone,setPhone]=useState(initial?.phone??''),[address,setAddress]=useState(initial?.address??''),[note,setNote]=useState(initial?.note??'');return <div className="entity-editor"><input value={name} onChange={e=>setName(e.target.value)} placeholder="客戶名稱 *"/><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="電話"/><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="地址"/><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="備註" rows={2}/><button disabled={!name.trim()} onClick={()=>void onSave({name:name.trim(),phone:phone.trim()||null,address:address.trim()||null,note:note.trim()||null}).then(()=>{if(!initial){setName('');setPhone('');setAddress('');setNote('');}})}>{initial?'儲存':'新增客戶'}</button></div>}
function CustomerRow({value,onSave,onDelete}:{value:Customer;onSave:(v:CustomerForm)=>Promise<void>;onDelete:()=>Promise<void>}){const [editing,setEditing]=useState(false);return <div className="entity-row"><div><strong>{value.name}</strong><small>{[value.phone,value.address,`專案 ${value.project_count??0}`,`紀錄 ${value.record_count??0}`].filter(Boolean).join(' · ')}</small></div><div className="row-buttons"><button className="ghost" onClick={()=>setEditing(v=>!v)}>編輯</button><button className="danger ghost" onClick={()=>void onDelete()}>刪除</button></div>{editing?<div className="entity-row-editor"><CustomerEditor initial={value} onSave={async input=>{await onSave(input);setEditing(false);}}/></div>:null}</div>}
type ProjectForm={name:string;customerId:string|null;address:string|null;status:Project['status'];note:string|null};
function ProjectEditor({customers,onSave,initial}:{customers:Customer[];onSave:(v:ProjectForm)=>Promise<void>;initial?:Project}){const [name,setName]=useState(initial?.name??''),[customerId,setCustomerId]=useState(initial?.customer_id??''),[address,setAddress]=useState(initial?.address??''),[status,setStatus]=useState<Project['status']>(initial?.status??'ACTIVE'),[note,setNote]=useState(initial?.note??'');return <div className="entity-editor"><input value={name} onChange={e=>setName(e.target.value)} placeholder="專案名稱 *"/><select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">未指定客戶</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select value={status} onChange={e=>setStatus(e.target.value as Project['status'])}><option value="ACTIVE">進行中</option><option value="COMPLETED">完成</option><option value="ARCHIVED">封存</option></select><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="地址"/><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="備註" rows={2}/><button disabled={!name.trim()} onClick={()=>void onSave({name:name.trim(),customerId:customerId||null,address:address.trim()||null,status,note:note.trim()||null}).then(()=>{if(!initial){setName('');setCustomerId('');setAddress('');setStatus('ACTIVE');setNote('');}})}>{initial?'儲存':'新增專案'}</button></div>}
function ProjectRow({value,customers,onSave,onDelete}:{value:Project;customers:Customer[];onSave:(v:ProjectForm)=>Promise<void>;onDelete:()=>Promise<void>}){const [editing,setEditing]=useState(false);return <div className="entity-row"><div><strong>{value.name}</strong><small>{[value.customer_name,value.status,`紀錄 ${value.record_count??0}`,`收款 ${moneyLabel(value.received_twd)}`,`支出 ${moneyLabel(value.expense_twd)}`,`應收 ${moneyLabel(value.receivable_twd)}`].filter(Boolean).join(' · ')}</small></div><div className="row-buttons"><button className="ghost" onClick={()=>setEditing(v=>!v)}>編輯</button><button className="danger ghost" onClick={()=>void onDelete()}>刪除</button></div>{editing?<div className="entity-row-editor"><ProjectEditor initial={value} customers={customers} onSave={async input=>{await onSave(input);setEditing(false);}}/></div>:null}</div>}

function FinancePage({transactions,customers,projects,loading,onCreate,onUpdate,onDelete}:{transactions:Transaction[];customers:Customer[];projects:Project[];loading:boolean;onCreate:(v:TransactionInput)=>Promise<void>;onUpdate:(id:string,v:TransactionInput)=>Promise<void>;onDelete:(id:string)=>Promise<void>}){return <section className="panel"><div className="section-title"><h2>收支 / 應收</h2><span>{transactions.length}</span></div><TransactionEditor customers={customers} projects={projects} onSave={onCreate}/>{loading?<p>載入中…</p>:<div className="transaction-list">{transactions.map(tx=><TransactionRow key={tx.id} value={tx} customers={customers} projects={projects} onSave={input=>onUpdate(tx.id,input)} onDelete={()=>onDelete(tx.id)}/>)}</div>}</section>}
function TransactionEditor({customers,projects,onSave,initial}:{customers:Customer[];projects:Project[];onSave:(v:TransactionInput)=>Promise<void>;initial?:Transaction}){const [type,setType]=useState<Transaction['type']>(initial?.type??'RECEIVED'),[amount,setAmount]=useState(initial?.amount_twd??''),[customerId,setCustomerId]=useState(initial?.customer_id??''),[projectId,setProjectId]=useState(initial?.project_id??''),[occurredAt,setOccurredAt]=useState(initial?toLocalInput(initial.occurred_at):toLocalInput(new Date().toISOString())),[note,setNote]=useState(initial?.note??'');return <div className="finance-form"><select value={type} onChange={e=>setType(e.target.value as Transaction['type'])}><option value="RECEIVED">已收款</option><option value="EXPENSE">支出</option><option value="RECEIVABLE">應收</option></select><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="金額 TWD *"/><select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">未指定客戶</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">未指定專案</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input type="datetime-local" value={occurredAt} onChange={e=>setOccurredAt(e.target.value)}/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="備註"/><button disabled={!amount||!occurredAt} onClick={()=>void onSave({type,amountTwd:amount.trim(),occurredAt:new Date(occurredAt).toISOString(),customerId:customerId||null,projectId:projectId||null,recordId:initial?.record_id?Number(initial.record_id):null,note:note.trim()||null}).then(()=>{if(!initial){setAmount('');setNote('');}})}>{initial?'儲存':'新增'}</button></div>}
function TransactionRow({value,customers,projects,onSave,onDelete}:{value:Transaction;customers:Customer[];projects:Project[];onSave:(v:TransactionInput)=>Promise<void>;onDelete:()=>Promise<void>}){const [editing,setEditing]=useState(false);return <div className="entity-row transaction-row"><div><strong>{transactionLabel(value.type)} · NT$ {Number(value.amount_twd).toLocaleString('zh-TW')}</strong><small>{[value.customer_name,value.project_name,new Date(value.occurred_at).toLocaleString('zh-TW'),value.note].filter(Boolean).join(' · ')}</small></div><div className="row-buttons"><button className="ghost" onClick={()=>setEditing(v=>!v)}>編輯</button><button className="danger ghost" onClick={()=>void onDelete()}>刪除</button></div>{editing?<div className="entity-row-editor"><TransactionEditor initial={value} customers={customers} projects={projects} onSave={async input=>{await onSave(input);setEditing(false);}}/></div>:null}</div>}

function FeedbackPanel({busy,onSubmit}:{busy:boolean;onSubmit:(text:string)=>Promise<void>}){const [text,setText]=useState('');return <section className="panel feedback-panel"><p className="eyebrow">FEEDBACK</p><h2>告訴我們哪裡不好用</h2><p className="muted">送出時會附上目前頁面、畫面尺寸、瀏覽器與目前紀錄範圍，方便排查；不會附上你的原始工作紀錄內容。</p><textarea rows={7} value={text} onChange={e=>setText(e.target.value)} placeholder="例如：群組紀錄篩選很難找、某個附件一直失敗…"/><button disabled={busy||!text.trim()} onClick={()=>void onSubmit(text.trim()).then(()=>setText(''))}>送出意見</button></section>}

function apiFilters(value:FilterDraft,offset:number):RecordFilters{return{query:value.query,inputType:value.inputType,category:value.category,customerId:value.customerId,projectId:value.projectId,from:value.from?new Date(value.from).toISOString():undefined,to:value.to?new Date(value.to).toISOString():undefined,limit:50,offset}}
function storedScope():Scope|null{const raw=localStorage.getItem(ACTIVE_SCOPE_KEY);if(!raw)return null;try{const value=JSON.parse(raw) as Record<string,unknown>;if(value.type==='PERSONAL'&&typeof value.sourceId==='number')return{type:'PERSONAL',sourceId:value.sourceId};if(value.type==='GROUP'&&typeof value.sourceId==='number'&&typeof value.lineGroupId==='string')return{type:'GROUP',sourceId:value.sourceId,lineGroupId:value.lineGroupId};}catch{}return null}
function defaultScope(surfaces:WorklogSurfaces):Scope|null{if(surfaces.personal)return{type:'PERSONAL',sourceId:surfaces.personal.sourceId};const group=surfaces.groups[0];return group?{type:'GROUP',sourceId:group.sourceId,lineGroupId:group.lineGroupId}:null}
function scopeExists(scope:Scope,surfaces:WorklogSurfaces){return scope.type==='PERSONAL'?surfaces.personal?.sourceId===scope.sourceId:surfaces.groups.some(g=>g.sourceId===scope.sourceId&&g.lineGroupId===scope.lineGroupId)}
function persistSession(token:string){localStorage.setItem(SESSION_KEY,token)}
function dedupeRecords(records:WorklogRecord[]){const seen=new Set<number>();return records.filter(r=>seen.has(r.id)?false:(seen.add(r.id),true))}
function message(cause:unknown,fallback:string){return cause instanceof Error?cause.message:fallback}
function inputLabel(type:WorklogInputType){return({TEXT:'文字',AUDIO:'音檔',IMAGE:'圖片',FILE:'檔案'} as const)[type]}
function transactionLabel(type:Transaction['type']){return({RECEIVED:'已收款',EXPENSE:'支出',RECEIVABLE:'應收'} as const)[type]}
function moneyLabel(value:string|undefined){return `NT$ ${Number(value??0).toLocaleString('zh-TW')}`}
function toLocalInput(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return'';const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}
const CATEGORIES:WorklogCategory[]=['NOTE','WORK','ISSUE','PAYMENT','EXPENSE','MATERIAL','PHOTO','AUDIO','OTHER'];
