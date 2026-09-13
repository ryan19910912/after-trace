import { useEffect, useMemo, useState } from 'react';
import { TaskApi, taskStatusLabel, type TaskItem } from './task-api';
import './task.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const RETURN_KEY = 'aftertrace.worklog.returnTo';

type Props = { apiBaseUrl: string };
type TaskDraft = { title: string; body: string; dueAt: string; remindAt: string };
type TaskView = 'OPEN' | 'CLOSED';

const EMPTY_DRAFT: TaskDraft = { title: '', body: '', dueAt: '', remindAt: '' };

export function TaskRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new TaskApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => currentSessionToken());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [view, setView] = useState<TaskView>('OPEN');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<TaskDraft>({ ...EMPTY_DRAFT });
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [editDraft, setEditDraft] = useState<TaskDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const focusedTaskId = useMemo(() => taskIdFromPath(window.location.pathname), []);
  const openTasks = tasks.filter((task) => task.status === 'OPEN');
  const closedTasks = tasks.filter((task) => task.status !== 'OPEN');
  const visibleTasks = view === 'OPEN' ? openTasks : closedTasks;

  useEffect(() => {
    const callback = callbackSessionToken();
    if (!callback) return;
    localStorage.setItem(SESSION_KEY, callback);
    setSession(callback);
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadTasks(session);
  }, [session, api]);

  async function loadTasks(token = session) {
    if (!token) return;
    setLoading(true);
    setError(null);
    try { setTasks(await api.list(token)); }
    catch (cause) {
      if (clearSessionIfExpired(cause)) {
        setSession(null);
        setTasks([]);
        setError('登入狀態已失效，請重新登入。');
        return;
      }
      setError(message(cause, '待辦載入失敗'));
    } finally { setLoading(false); }
  }

  async function createTask() {
    if (!session || !createDraft.title.trim()) return;
    setLoading(true); setError(null);
    try {
      await api.create(session, draftRequest(createDraft));
      setCreateDraft({ ...EMPTY_DRAFT }); setCreateOpen(false); setView('OPEN'); setNotice('待辦已建立。'); await loadTasks(session);
    } catch (cause) { if (clearSessionIfExpired(cause)) setSession(null); setError(message(cause, '待辦建立失敗')); }
    finally { setLoading(false); }
  }

  function startEdit(task: TaskItem) {
    setEditing(task);
    setEditDraft({ title: task.title, body: task.body ?? '', dueAt: datetimeLocalValue(task.dueAt), remindAt: datetimeLocalValue(task.remindAt) });
  }

  async function saveEdit() {
    if (!session || !editing || !editDraft?.title.trim()) return;
    setLoading(true); setError(null);
    try { await api.update(session, editing.id, draftRequest(editDraft)); setEditing(null); setEditDraft(null); setNotice('待辦已更新。'); await loadTasks(session); }
    catch (cause) { if (clearSessionIfExpired(cause)) setSession(null); setError(message(cause, '待辦更新失敗')); }
    finally { setLoading(false); }
  }

  async function mutateTask(task: TaskItem, action: 'COMPLETE' | 'CANCEL') {
    if (!session || task.status !== 'OPEN') return;
    setLoading(true); setError(null);
    try {
      if (action === 'COMPLETE') await api.complete(session, task.id); else await api.cancel(session, task.id);
      setNotice(action === 'COMPLETE' ? '待辦已完成。' : '待辦已取消。');
      if (editing?.id === task.id) { setEditing(null); setEditDraft(null); }
      await loadTasks(session);
    } catch (cause) { if (clearSessionIfExpired(cause)) setSession(null); setError(message(cause, action === 'COMPLETE' ? '完成待辦失敗' : '取消待辦失敗')); }
    finally { setLoading(false); }
  }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card">
    <p className="eyebrow">AFTERTRACE</p><h1>待辦與提醒</h1><p className="muted">登入後可以建立待辦、設定提醒，並從通知中心查看提醒。</p>
    {error ? <div className="error">{error}</div> : null}
    <button onClick={() => { localStorage.setItem(RETURN_KEY, focusedTaskId ? `/tasks/${focusedTaskId}` : '/tasks'); window.location.href = '/login'; }}>登入 AFTERTRACE</button>
  </section></main>;

  return <main className="shell task-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>待辦</h1><p className="muted">把接下來要做的事放在這裡，需要時設定提醒。</p></div></div>
    {error ? <div className="error">{error}</div> : null}{notice ? <div className="worklog-notice">{notice}</div> : null}
    <div className="task-toolbar"><div className="task-view-switch" role="tablist" aria-label="待辦狀態"><button role="tab" aria-selected={view === 'OPEN'} className={view === 'OPEN' ? 'active' : ''} onClick={() => setView('OPEN')}>進行中 <span>{openTasks.length}</span></button><button role="tab" aria-selected={view === 'CLOSED'} className={view === 'CLOSED' ? 'active' : ''} onClick={() => setView('CLOSED')}>已結束 <span>{closedTasks.length}</span></button></div><button className="task-create-button" onClick={() => setCreateOpen((value) => !value)}>{createOpen ? '收起' : '＋新增待辦'}</button></div>
    {createOpen ? <section className="panel task-create-panel"><TaskEditor heading="新增待辦" draft={createDraft} busy={loading} onChange={setCreateDraft} onSave={() => void createTask()} onCancel={() => { setCreateOpen(false); setCreateDraft({ ...EMPTY_DRAFT }); }} /></section> : null}
    <section className="task-section">
      {loading && tasks.length === 0 ? <div className="empty">載入中…</div> : null}
      {!loading && visibleTasks.length === 0 ? <div className="empty task-empty"><strong>{view === 'OPEN' ? '目前沒有待辦' : '目前沒有已結束的待辦'}</strong><span>{view === 'OPEN' ? '有事情要記得處理時，建立一筆待辦就好。' : '完成或取消的待辦會出現在這裡。'}</span>{view === 'OPEN' ? <button onClick={() => setCreateOpen(true)}>＋ 建立待辦</button> : null}</div> : null}
      <div className="task-list">{visibleTasks.map((task) => <TaskCard key={task.id} task={task} focused={task.id === focusedTaskId} busy={loading} onEdit={() => startEdit(task)} onComplete={() => void mutateTask(task, 'COMPLETE')} onCancel={() => void mutateTask(task, 'CANCEL')} />)}</div>
    </section>
    {editing && editDraft ? <section className="panel task-edit-panel"><TaskEditor heading={`編輯待辦 #${editing.id}`} draft={editDraft} busy={loading} onChange={setEditDraft} onSave={() => void saveEdit()} onCancel={() => { setEditing(null); setEditDraft(null); }} /></section> : null}
  </main>;
}

function TaskEditor({ heading, draft, busy, onChange, onSave, onCancel }: { heading:string; draft:TaskDraft; busy:boolean; onChange:(draft:TaskDraft)=>void; onSave:()=>void; onCancel:()=>void }) {
  return <div className="stack task-editor"><h3>{heading}</h3><label>待辦名稱<input value={draft.title} maxLength={255} onChange={(event) => onChange({ ...draft, title:event.target.value })} placeholder="例如：回覆客戶報價" /></label><label>補充內容（選填）<textarea rows={4} value={draft.body} onChange={(event) => onChange({ ...draft, body:event.target.value })} placeholder="補充需要記住的細節" /></label><div className="task-time-grid"><label>到期時間（選填）<input type="datetime-local" value={draft.dueAt} onChange={(event) => onChange({ ...draft, dueAt:event.target.value })} /></label><label>提醒時間（選填）<input type="datetime-local" value={draft.remindAt} onChange={(event) => onChange({ ...draft, remindAt:event.target.value })} /></label></div><p className="muted">設定提醒後，到時間會出現在通知中心；已開啟推播時也會嘗試推播。</p><div className="filter-actions"><button disabled={busy || !draft.title.trim()} onClick={onSave}>儲存</button><button className="ghost" disabled={busy} onClick={onCancel}>取消</button></div></div>;
}
function TaskCard({ task, focused, busy, onEdit, onComplete, onCancel }: { task:TaskItem; focused:boolean; busy:boolean; onEdit:()=>void; onComplete:()=>void; onCancel:()=>void }) {
  return <article id={`task-${task.id}`} className={`task-card${focused?' focused':''}${task.status!=='OPEN'?' closed':''}`}><div className="task-card-head"><div><span className={`task-status ${task.status.toLowerCase()}`}>{taskStatusLabel(task.status)}</span><strong>{task.title}</strong></div><span className="muted">#{task.id}</span></div>{task.body?<p>{task.body}</p>:null}<dl className="task-times"><div><dt>到期</dt><dd>{formatOptionalTime(task.dueAt)}</dd></div><div><dt>提醒</dt><dd>{formatOptionalTime(task.remindAt)}</dd></div></dl>{task.reminderNotifiedAt?<p className="muted">已提醒：{formatTime(task.reminderNotifiedAt)}</p>:null}{task.status==='OPEN'?<div className="filter-actions task-card-actions"><button onClick={onComplete} disabled={busy}>✓ 完成</button><button className="ghost" onClick={onEdit} disabled={busy}>編輯</button><button className="ghost" onClick={onCancel} disabled={busy}>取消</button></div>:null}</article>;
}
function draftRequest(draft:TaskDraft){return{title:draft.title.trim(),body:draft.body.trim()||null,dueAt:localDateOrNull(draft.dueAt),remindAt:localDateOrNull(draft.remindAt)}}
function currentSessionToken(){return callbackSessionToken()||localStorage.getItem(SESSION_KEY)?.trim()||null}
function callbackSessionToken(){const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));return hash.get('session')?.trim()||null}
function clearSessionIfExpired(cause:unknown){const text=cause instanceof Error?cause.message:String(cause??'');if(text!=='INVALID_WEB_SESSION'&&text!=='WEB_SESSION_REQUIRED'&&text!=='WORKLOG_USER_NOT_FOUND')return false;localStorage.removeItem(SESSION_KEY);localStorage.removeItem('aftertrace.worklog.scope');return true}
function taskIdFromPath(pathname:string){const match=/^\/tasks\/(\d+)\/?$/.exec(pathname);if(!match)return null;const id=Number(match[1]);return Number.isSafeInteger(id)&&id>0?id:null}
function datetimeLocalValue(value:string|null){if(!value)return'';const date=new Date(value);if(Number.isNaN(date.getTime()))return'';const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}
function localDateOrNull(value:string){if(!value.trim())return null;const date=new Date(value);if(Number.isNaN(date.getTime()))throw new Error('INVALID_TASK_DATE');return date.toISOString()}
function formatOptionalTime(value:string|null){return value?formatTime(value):'未設定'}
function formatTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}
function message(cause:unknown,fallback:string){if(!(cause instanceof Error))return fallback;const labels:Record<string,string>={INVALID_TASK_TITLE:'請輸入待辦名稱。',INVALID_TASK_DUE_AT:'到期時間格式不正確。',INVALID_TASK_REMIND_AT:'提醒時間格式不正確。',TASK_NOT_FOUND_OR_NOT_OPEN:'這筆待辦已不存在或已結束。',TASK_SOURCE_NOT_AUTHORIZED:'你沒有這個紀錄空間的權限。',WORKLOG_USER_NOT_FOUND:'登入狀態已失效，請重新登入。'};return labels[cause.message]??cause.message??fallback}
