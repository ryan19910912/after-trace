import { useEffect, useMemo, useRef, useState } from 'react';
import { aiTaskDeepLinkUrl } from './ai-task-deep-link';
import { aiToolsDeepLinkUrl } from './ai-tools-deep-link';
import { LoginProviderButtons } from './LoginProviderButtons';
import {
  WorklogApi,
  type CreatedNativeGroupInvite,
  type NativeGroupRole,
  type NativeGroupSummary,
  type RecordFilters,
  type RecordPage,
  type RecordScope,
  type WebEntryContext,
  type WorklogInputType,
  type WorklogRecord,
  type WorklogRecordRevision,
  type WorklogSurfaces,
} from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';
const PENDING_INVITE_KEY = 'aftertrace.worklog.pendingInvite';

type Props = { apiBaseUrl: string };
type Scope =
  | { type: 'PERSONAL'; sourceId: number }
  | { type: 'GROUP'; sourceId: number };
type Page = 'RECORDS' | 'GROUPS' | 'FEEDBACK';
type FilterDraft = { query: string; from: string; to: string };
type RecordDraft = { rawText: string; occurredAt: string };
type SharedInvite = CreatedNativeGroupInvite & { groupName: string; revoked: boolean };

const EMPTY_FILTER: FilterDraft = { query: '', from: '', to: '' };
const EMPTY_RECORD: RecordDraft = { rawText: '', occurredAt: '' };

export function WorklogRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const started = useRef(false);
  const loadGeneration = useRef(0);
  const initialFilters = useMemo(() => filtersFromUrl(), []);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [records, setRecords] = useState<WorklogRecord[]>([]);
  const [recordPage, setRecordPage] = useState<RecordPage | null>(null);
  const [page, setPage] = useState<Page>('RECORDS');
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(initialFilters);
  const [filters, setFilters] = useState<FilterDraft>(initialFilters);
  const [showDeleted, setShowDeleted] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<RecordDraft>({ ...EMPTY_RECORD });
  const [editing, setEditing] = useState<WorklogRecord | null>(null);
  const [editDraft, setEditDraft] = useState<RecordDraft | null>(null);
  const [historyRecord, setHistoryRecord] = useState<WorklogRecord | null>(null);
  const [revisions, setRevisions] = useState<WorklogRecordRevision[]>([]);
  const [groupName, setGroupName] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [sharedInvite, setSharedInvite] = useState<SharedInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void bootstrap();
    }
  }, []);

  useEffect(() => {
    if (!session || !scope) return;
    loadGeneration.current += 1;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    setCreateOpen(false);
    setCreateDraft({ ...EMPTY_RECORD });
    setEditing(null);
    setEditDraft(null);
    setHistoryRecord(null);
    setRevisions([]);
    void loadScope(session, scope, filters, false, showDeleted);
  }, [session, scope?.type, scope?.sourceId, filters, showDeleted]);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      let entryContext: WebEntryContext | null = null;
      const url = new URL(window.location.href);
      const inviteFromUrl = url.searchParams.get('invite')?.trim();
      if (inviteFromUrl) {
        const normalized = normalizeInviteToken(inviteFromUrl);
        if (normalized) localStorage.setItem(PENDING_INVITE_KEY, normalized);
        url.searchParams.delete('invite');
      }
      const entry = url.searchParams.get('t')?.trim();
      if (entry) {
        const exchanged = await api.exchangeEntry(entry);
        token = exchanged.sessionToken;
        entryContext = exchanged.entryContext;
        persistSession(token);
        setSession(token);
        url.searchParams.delete('t');
        url.searchParams.delete('openExternalBrowser');
      } else if (callback) {
        persistSession(callback);
        setSession(callback);
      }
      if (callback || entry || inviteFromUrl) {
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      }
      if (!token) return;

      let joinedGroup: NativeGroupSummary | null = null;
      const pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
      if (pendingInvite) {
        try {
          const joined = await api.joinGroup(token, pendingInvite);
          joinedGroup = joined.group;
          setNotice(joined.status === 'ALREADY_MEMBER' ? `你已經在「${joined.group.name}」群組中。` : `已加入「${joined.group.name}」。`);
        } catch (cause) {
          setError(message(cause, '邀請連結無法使用'));
        } finally {
          localStorage.removeItem(PENDING_INVITE_KEY);
        }
      }

      const nextSurfaces = await api.surfaces(token);
      setSurfaces(nextSurfaces);
      const linked = joinedGroup
        ? { type: 'GROUP', sourceId: joinedGroup.sourceId } as Scope
        : scopeFromEntry(entryContext, nextSurfaces);
      const remembered = storedScope();
      setScope(linked ?? (remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces)));
    } catch (cause) {
      const text = message(cause, '載入失敗');
      if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text)) clearSession();
      setError(text);
    } finally {
      setLoading(false);
    }
  }

  async function reloadSurfaces(token = session): Promise<WorklogSurfaces | null> {
    if (!token) return null;
    const next = await api.surfaces(token);
    setSurfaces(next);
    if (scope && !scopeExists(scope, next)) setScope(defaultScope(next));
    return next;
  }

  async function loadScope(token: string, nextScope: Scope, nextFilters: FilterDraft, append: boolean, deleted = showDeleted) {
    const generation = loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const requestFilters = apiFilters(nextFilters, append ? recordPage?.nextOffset ?? 0 : 0);
      const apiScope = recordScope(nextScope);
      const result = deleted
        ? await api.deletedRecords(token, apiScope, requestFilters)
        : nextScope.type === 'PERSONAL'
          ? await api.personalRecords(token, requestFilters)
          : await api.groupRecords(token, nextScope.sourceId, requestFilters);
      if (generation !== loadGeneration.current) return;
      setRecords((current) => append ? dedupeRecords([...current, ...result.records]) : result.records);
      setRecordPage(result.page);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setError(message(cause, '紀錄載入失敗'));
      if (!append) setRecords([]);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }

  async function refreshAfterMutation(text: string) {
    if (!session || !scope) return;
    setNotice(text);
    setError(null);
    await loadScope(session, scope, filters, false, showDeleted);
  }

  function clearSession() {
    loadGeneration.current += 1;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVE_SCOPE_KEY);
    setSession(null);
    setSurfaces(null);
    setScope(null);
    setRecords([]);
    setRecordPage(null);
    setCreateOpen(false);
    setEditing(null);
    setEditDraft(null);
    setHistoryRecord(null);
    setRevisions([]);
    setSharedInvite(null);
  }

  function applyFilters() {
    setFilters({ ...filterDraft });
    setRecordPage(null);
  }

  function clearFilters() {
    setFilterDraft(EMPTY_FILTER);
    setFilters(EMPTY_FILTER);
    setRecordPage(null);
  }

  function switchRecordView(deleted: boolean) {
    if (deleted) setCreateOpen(false);
    setShowDeleted(deleted);
  }

  async function createRecord() {
    if (!session || !scope || !createDraft.rawText.trim() || !optionalLocalDateValid(createDraft.occurredAt)) return;
    setLoading(true);
    setError(null);
    try {
      await api.createRecord(session, recordScope(scope), {
        rawText: createDraft.rawText.trim(),
        occurredAt: localDateOrNull(createDraft.occurredAt),
      });
      setCreateDraft({ ...EMPTY_RECORD });
      setCreateOpen(false);
      await refreshAfterMutation('紀錄已新增。');
    } catch (cause) {
      setError(message(cause, '新增紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit(record: WorklogRecord, draft: RecordDraft) {
    if (!session || !draft.rawText.trim() || !optionalLocalDateValid(draft.occurredAt)) return;
    setLoading(true);
    setError(null);
    try {
      await api.updateRecord(session, record.id, {
        expectedVersion: record.version,
        rawText: draft.rawText.trim(),
        occurredAt: localDateOrNull(draft.occurredAt),
      });
      setEditing(null);
      setEditDraft(null);
      await refreshAfterMutation('紀錄已更新。');
    } catch (cause) {
      setError(message(cause, '更新紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function deleteRecord(record: WorklogRecord) {
    if (!session || !window.confirm('將這筆紀錄移到回收桶？之後仍可還原。')) return;
    setLoading(true);
    setError(null);
    try {
      await api.deleteRecord(session, record.id, record.version);
      await refreshAfterMutation('紀錄已移到回收桶。');
    } catch (cause) {
      setError(message(cause, '刪除紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function restoreRecord(record: WorklogRecord) {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      await api.restoreRecord(session, record.id, record.version);
      await refreshAfterMutation('紀錄已還原。');
    } catch (cause) {
      setError(message(cause, '還原紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function openHistory(record: WorklogRecord) {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      setRevisions(await api.recordRevisions(session, record.id));
      setHistoryRecord(record);
    } catch (cause) {
      setError(message(cause, '編輯紀錄載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  function startEdit(record: WorklogRecord) {
    setEditing(record);
    setEditDraft({ rawText: record.rawText, occurredAt: datetimeLocalValue(record.occurredAt) });
  }

  async function createGroup() {
    if (!session || !groupName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const group = await api.createGroup(session, groupName.trim());
      await reloadSurfaces(session);
      setGroupName('');
      setScope({ type: 'GROUP', sourceId: group.sourceId });
      setPage('RECORDS');
      setNotice(`已建立「${group.name}」。`);
    } catch (cause) {
      setError(message(cause, '建立群組失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function createInvite(group: { sourceId: number; name: string; role: NativeGroupRole }) {
    if (!session || group.role !== 'OWNER') return;
    setLoading(true);
    setError(null);
    try {
      const created = await api.createGroupInvite(session, group.sourceId, { maxUses: 1 });
      setSharedInvite({ ...created, groupName: group.name, revoked: false });
      setNotice('單次邀請已建立。原始邀請碼只會在這次建立後顯示。');
    } catch (cause) {
      setError(message(cause, '建立邀請失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function revokeInvite() {
    if (!session || !sharedInvite || sharedInvite.revoked) return;
    setLoading(true);
    setError(null);
    try {
      await api.revokeGroupInvite(session, sharedInvite.invite.sourceId, sharedInvite.invite.id);
      setSharedInvite({ ...sharedInvite, revoked: true });
      setNotice('邀請已撤銷。');
    } catch (cause) {
      setError(message(cause, '撤銷邀請失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function joinGroup() {
    if (!session) return;
    const token = normalizeInviteToken(joinToken);
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const joined = await api.joinGroup(session, token);
      await reloadSurfaces(session);
      setJoinToken('');
      setScope({ type: 'GROUP', sourceId: joined.group.sourceId });
      setPage('RECORDS');
      setNotice(joined.status === 'ALREADY_MEMBER' ? `你已經在「${joined.group.name}」群組中。` : `已加入「${joined.group.name}」。`);
    } catch (cause) {
      setError(message(cause, '加入群組失敗'));
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    const pendingInvite = Boolean(localStorage.getItem(PENDING_INVITE_KEY));
    return <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>{pendingInvite ? '登入後加入群組' : '工作紀錄中心'}</h1>
        <p className="muted">快速留下工作發生過的事，需要時找得到。</p>
        {pendingInvite ? <p className="muted">邀請已暫存。完成登入後會自動嘗試加入群組。</p> : null}
        {error ? <div className="error">{error}</div> : null}
        <LoginProviderButtons apiBaseUrl={apiBaseUrl} />
      </section>
    </main>;
  }

  const hasFilters = Boolean(filters.query || filters.from || filters.to);

  return <main className="shell worklog-shell">
    <div className="topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>工作紀錄</h1></div>
      <div className="filter-actions">
        <button className="ghost" onClick={() => { window.location.href = '/subscription'; }}>方案</button>
        <button className="ghost" onClick={() => { window.location.href = '/help'; }}>使用說明</button>
        <button className="ghost" onClick={clearSession}>登出</button>
      </div>
    </div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <nav className="worklog-main-tabs">
      <button className={page === 'RECORDS' ? 'active' : ''} onClick={() => setPage('RECORDS')}>紀錄</button>
      <button className={page === 'GROUPS' ? 'active' : ''} onClick={() => setPage('GROUPS')}>群組</button>
      <button className={page === 'FEEDBACK' ? 'active feedback-tab' : 'feedback-tab'} onClick={() => setPage('FEEDBACK')}>回饋</button>
    </nav>

    {page === 'RECORDS' ? <>
      <ScopePicker surfaces={surfaces} scope={scope} onChange={setScope} />
      <section className="record-toolbar">
        <div className="record-view-switch" role="tablist" aria-label="紀錄檢視">
          <button role="tab" aria-selected={!showDeleted} className={!showDeleted ? 'active' : ''} onClick={() => switchRecordView(false)}>目前紀錄</button>
          <button role="tab" aria-selected={showDeleted} className={showDeleted ? 'active' : ''} onClick={() => switchRecordView(true)}>回收桶</button>
        </div>
        {!showDeleted ? <button className="record-create-button" onClick={() => setCreateOpen((value) => !value)}>{createOpen ? '收起' : '＋新增紀錄'}</button> : null}
      </section>
      {createOpen && !showDeleted ? <section className="panel record-create-panel"><RecordEditor heading="新增紀錄" draft={createDraft} onChange={setCreateDraft} onCancel={() => setCreateOpen(false)} onSave={() => void createRecord()} busy={loading} /></section> : null}
      <RecordFiltersPanel draft={filterDraft} onChange={setFilterDraft} onApply={applyFilters} onClear={clearFilters} />
      <section className="panel">
        {loading && records.length === 0 ? <div className="empty">載入中…</div> : null}
        {!loading && scope && records.length === 0 ? <div className="empty record-empty">
          <strong>{showDeleted ? '回收桶是空的' : hasFilters ? '找不到符合條件的紀錄' : '還沒有任何紀錄'}</strong>
          <span>{showDeleted ? '刪除的紀錄會出現在這裡。' : hasFilters ? '試著清除篩選，或換一個關鍵字。' : '把今天做過的事記下來，之後需要時就找得到。'}</span>
          {!showDeleted ? <button onClick={hasFilters ? clearFilters : () => setCreateOpen(true)}>{hasFilters ? '清除篩選' : '＋ 建立第一筆紀錄'}</button> : null}
        </div> : null}
        {!scope ? <div className="empty">目前沒有可使用的紀錄空間。</div> : null}
        <div className="worklog-record-list">
          {records.map((record) => <RecordCard key={record.id} record={record} deleted={showDeleted} onEdit={() => startEdit(record)} onHistory={() => void openHistory(record)} onDelete={() => void deleteRecord(record)} onRestore={() => void restoreRecord(record)} />)}
        </div>
        {recordPage?.hasMore ? <button className="load-more" disabled={loading} onClick={() => session && scope && void loadScope(session, scope, filters, true, showDeleted)}>{loading ? '載入中…' : '載入更多'}</button> : null}
      </section>
      {editing && editDraft ? <section className="panel"><RecordEditor heading="編輯紀錄" draft={editDraft} onChange={setEditDraft} onCancel={() => { setEditing(null); setEditDraft(null); }} onSave={() => void saveEdit(editing, editDraft)} busy={loading} /></section> : null}
      {historyRecord ? <HistoryPanel record={historyRecord} revisions={revisions} onClose={() => { setHistoryRecord(null); setRevisions([]); }} /> : null}
    </> : null}

    {page === 'GROUPS' ? <GroupsPanel
      surfaces={surfaces}
      groupName={groupName}
      joinToken={joinToken}
      sharedInvite={sharedInvite}
      busy={loading}
      onGroupNameChange={setGroupName}
      onJoinTokenChange={setJoinToken}
      onCreateGroup={() => void createGroup()}
      onJoinGroup={() => void joinGroup()}
      onOpenGroup={(group) => { setScope({ type: 'GROUP', sourceId: group.sourceId }); setPage('RECORDS'); }}
      onCreateInvite={(group) => void createInvite(group)}
      onRevokeInvite={() => void revokeInvite()}
    /> : null}

    {page === 'FEEDBACK' ? <FeedbackPanel busy={loading} onSubmit={async (text) => {
      if (!session) return;
      try {
        await api.submitFeedback(session, text, {
          page: window.location.pathname,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userAgent: navigator.userAgent,
          appVersion: 'worklog-web-pwa',
          scopeType: scope?.type ?? 'NONE',
          sourceId: scope?.sourceId ?? 0,
        });
        setNotice('意見已送出，謝謝。');
      } catch (cause) {
        setError(message(cause, '意見送出失敗'));
        throw cause;
      }
    }} /> : null}
  </main>;
}

function ScopePicker({ surfaces, scope, onChange }: { surfaces: WorklogSurfaces | null; scope: Scope | null; onChange: (scope: Scope) => void }) {
  return <section className="panel worklog-scope-panel">
    <div className="worklog-scope-row">
      {surfaces?.personal ? <button className={scope?.type === 'PERSONAL' ? 'worklog-scope active' : 'worklog-scope'} onClick={() => onChange({ type: 'PERSONAL', sourceId: surfaces.personal!.sourceId })}>我的紀錄</button> : null}
      {surfaces?.groups.map((group) => <button key={group.sourceId} className={scope?.type === 'GROUP' && scope.sourceId === group.sourceId ? 'worklog-scope active' : 'worklog-scope'} onClick={() => onChange({ type: 'GROUP', sourceId: group.sourceId })}>{group.name}</button>)}
    </div>
  </section>;
}

function RecordFiltersPanel({ draft, onChange, onApply, onClear }: { draft: FilterDraft; onChange: (value: FilterDraft) => void; onApply: () => void; onClear: () => void }) {
  return <section className="panel record-filter-card">
    <div className="record-filter-grid">
      <label>搜尋<input value={draft.query} onChange={(event) => onChange({ ...draft, query: event.target.value })} placeholder="搜尋紀錄內容" /></label>
      <label>從<input type="date" value={draft.from} onChange={(event) => onChange({ ...draft, from: event.target.value })} /></label>
      <label>到<input type="date" value={draft.to} onChange={(event) => onChange({ ...draft, to: event.target.value })} /></label>
    </div>
    <div className="filter-actions record-filter-actions"><button onClick={onApply}>套用篩選</button><button className="ghost" onClick={onClear}>清除</button></div>
  </section>;
}

function RecordEditor({ heading, draft, onChange, onCancel, onSave, busy }: { heading: string; draft: RecordDraft; onChange: (value: RecordDraft) => void; onCancel: () => void; onSave: () => void; busy: boolean }) {
  const occurredAtValid = optionalLocalDateValid(draft.occurredAt);
  return <div className="stack">
    <h2>{heading}</h2>
    <label>紀錄內容<textarea rows={6} value={draft.rawText} onChange={(event) => onChange({ ...draft, rawText: event.target.value })} placeholder="今天發生了什麼？" /></label>
    <label>發生時間（選填）<input type="datetime-local" value={draft.occurredAt} onChange={(event) => onChange({ ...draft, occurredAt: event.target.value })} /></label>
    <p className="muted">不填發生時間也可以儲存；時間軸會改用這筆紀錄的建立時間顯示。</p>
    <div className="filter-actions"><button disabled={busy || !draft.rawText.trim() || !occurredAtValid} onClick={onSave}>儲存</button><button className="ghost" onClick={onCancel}>取消</button></div>
  </div>;
}

function RecordCard({ record, deleted, onEdit, onHistory, onDelete, onRestore }: { record: WorklogRecord; deleted: boolean; onEdit: () => void; onHistory: () => void; onDelete: () => void; onRestore: () => void }) {
  const time = recordDisplayTime(record);
  return <article className="worklog-record-card">
    <div className="worklog-record-meta">
      <span>{inputLabel(record.inputType)}</span>
      {record.title ? <span>{record.title}</span> : null}
      {record.version > 1 ? <span>已編輯</span> : null}
      <time>{time.label}：{time.value}</time>
    </div>
    <strong>{record.rawText}</strong>
    <div className="filter-actions">
      {!deleted ? <>
        <button className="ghost" onClick={onEdit}>編輯</button>
        <button className="ghost" onClick={() => { window.location.href = aiToolsDeepLinkUrl({ sourceId: record.sourceId, recordId: record.id, tool: 'related' }); }}>找相關</button>
        <button className="ghost" onClick={() => { window.location.href = aiToolsDeepLinkUrl({ sourceId: record.sourceId, recordId: record.id, tool: 'rewrite' }); }}>AI 改寫</button>
        <button className="ghost" onClick={() => { window.location.href = aiTaskDeepLinkUrl({ sourceId: record.sourceId, recordId: record.id }); }}>AI 待辦</button>
        <button className="ghost" onClick={onDelete}>刪除</button>
      </> : <button onClick={onRestore}>還原</button>}
      <button className="ghost" onClick={onHistory}>編輯紀錄</button>
    </div>
  </article>;
}

function HistoryPanel({ record, revisions, onClose }: { record: WorklogRecord; revisions: WorklogRecordRevision[]; onClose: () => void }) {
  return <section className="panel stack">
    <div className="topbar"><div><p className="eyebrow">HISTORY</p><h2>編輯紀錄</h2></div><button className="ghost" onClick={onClose}>關閉</button></div>
    <p className="muted">目前版本 {record.version}。每次修改、刪除與還原都保留歷史。</p>
    {revisions.length === 0 ? <p className="muted">這筆紀錄尚無修改歷史。</p> : revisions.map((revision) => <article className="worklog-record-card" key={revision.id}>
      <div className="worklog-record-meta"><span>版本 {revision.version}</span><span>{revision.editorDisplayName ?? `使用者 ${revision.editorUserId ?? '-'}`}</span><time>{formatDateTime(revision.createdAt)}</time></div>
      <p>{revision.previousRawText}</p><p>→</p><strong>{revision.newRawText}</strong>
      {revision.previousOccurredAt !== revision.newOccurredAt ? <p className="muted">發生時間：{formatOptionalDate(revision.previousOccurredAt)} → {formatOptionalDate(revision.newOccurredAt)}</p> : null}
      {revision.previousStatus !== revision.newStatus ? <p className="muted">狀態：{revision.previousStatus} → {revision.newStatus}</p> : null}
    </article>)}
  </section>;
}

function GroupsPanel({ surfaces, groupName, joinToken, sharedInvite, busy, onGroupNameChange, onJoinTokenChange, onCreateGroup, onJoinGroup, onOpenGroup, onCreateInvite, onRevokeInvite }: {
  surfaces: WorklogSurfaces | null;
  groupName: string;
  joinToken: string;
  sharedInvite: SharedInvite | null;
  busy: boolean;
  onGroupNameChange: (value: string) => void;
  onJoinTokenChange: (value: string) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onOpenGroup: (group: WorklogSurfaces['groups'][number]) => void;
  onCreateInvite: (group: WorklogSurfaces['groups'][number]) => void;
  onRevokeInvite: () => void;
}) {
  return <div className="stack">
    <section className="panel stack">
      <div><p className="eyebrow">建立</p><h2>建立群組</h2></div>
      <p className="muted">建立工作群組後，就能和同事一起查看與新增這個群組的紀錄。</p>
      <div className="filter-actions"><input value={groupName} onChange={(event) => onGroupNameChange(event.target.value)} maxLength={255} placeholder="例如：晴空案團隊" /><button disabled={busy || !groupName.trim()} onClick={onCreateGroup}>建立群組</button></div>
    </section>

    <section className="panel stack">
      <div><p className="eyebrow">加入</p><h2>加入群組</h2></div>
      <p className="muted">有同事傳邀請連結或邀請碼給你時，貼在這裡即可加入。</p>
      <div className="filter-actions"><input value={joinToken} onChange={(event) => onJoinTokenChange(event.target.value)} placeholder="邀請連結或邀請碼" /><button disabled={busy || !normalizeInviteToken(joinToken)} onClick={onJoinGroup}>加入</button></div>
    </section>

    {sharedInvite ? <section className="panel stack">
      <div><p className="eyebrow">邀請同事</p><h2>{sharedInvite.groupName} 邀請</h2></div>
      <p className="muted">這是一次性邀請連結。離開這個畫面後，不會再次顯示同一組邀請碼。</p>
      <input readOnly value={inviteShareUrl(sharedInvite.inviteToken)} />
      <div className="filter-actions">
        <button className="ghost" disabled={sharedInvite.revoked} onClick={() => void copyText(inviteShareUrl(sharedInvite.inviteToken))}>複製邀請連結</button>
        <button className="ghost" disabled={busy || sharedInvite.revoked} onClick={onRevokeInvite}>{sharedInvite.revoked ? '已撤銷' : '撤銷邀請'}</button>
      </div>
    </section> : null}

    <section className="panel stack">
      <div><p className="eyebrow">我的群組</p><h2>工作群組</h2></div>
      {surfaces?.groups.length ? surfaces.groups.map((group) => <article className="worklog-record-card" key={group.sourceId}>
        <div className="worklog-record-meta"><strong>{group.name}</strong><span>{group.role === 'OWNER' ? '擁有者' : '成員'}</span></div>
        <div className="filter-actions"><button onClick={() => onOpenGroup(group)}>查看紀錄</button>{group.role === 'OWNER' ? <button className="ghost" disabled={busy} onClick={() => onCreateInvite(group)}>邀請同事</button> : null}</div>
      </article>) : <div className="empty group-empty"><strong>還沒有工作群組</strong><span>有需要一起記錄的同事時，再建立群組即可。</span></div>}
    </section>
  </div>;
}

function FeedbackPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  return <section className="panel feedback-panel">
    <p className="eyebrow">意見回饋</p><h2>有什麼想讓 AFTERTRACE 更順手？</h2>
    <p className="muted">不論是操作不好找、搜尋結果不符合預期，或希望增加新功能，都可以直接告訴我們。送出時只會附上基本頁面與瀏覽器資訊，不會附上你的工作紀錄內容。</p>
    <textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：希望某個操作更快、某個功能更容易找到…" />
    <button disabled={busy || !text.trim()} onClick={() => void onSubmit(text.trim()).then(() => setText('')).catch(() => undefined)}>送出意見</button>
  </section>;
}

function recordScope(value: Scope): RecordScope {
  return value.type === 'PERSONAL' ? { type: 'PERSONAL', sourceId: value.sourceId } : { type: 'GROUP', sourceId: value.sourceId };
}

function apiFilters(value: FilterDraft, offset: number): RecordFilters {
  return {
    query: value.query,
    from: value.from && optionalLocalDateValid(value.from) ? localDayBoundaryIso(value.from, 'start') : undefined,
    to: value.to && optionalLocalDateValid(value.to) ? localDayBoundaryIso(value.to, 'end') : undefined,
    limit: 50,
    offset,
  };
}

function filtersFromUrl(): FilterDraft {
  const params = new URL(window.location.href).searchParams;
  return {
    query: params.get('q')?.trim() ?? '',
    from: urlDateToDay(params.get('from')),
    to: urlDateToDay(params.get('to')),
  };
}

function urlDateToDay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function localDayBoundaryIso(value: string, boundary: 'start' | 'end'): string {
  const date = new Date(`${value}T00:00:00`);
  if (boundary === 'end') date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function scopeFromEntry(entry: WebEntryContext | null, surfaces: WorklogSurfaces): Scope | null {
  if (!entry) return null;
  if (entry.type === 'PRIVATE') return surfaces.personal?.sourceId === entry.sourceId ? { type: 'PERSONAL', sourceId: entry.sourceId } : null;
  const group = surfaces.groups.find((value) => value.legacyLineGroupId === entry.lineGroupId);
  return group ? { type: 'GROUP', sourceId: group.sourceId } : null;
}

function storedScope(): Scope | null {
  const raw = localStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') return { type: 'PERSONAL', sourceId: value.sourceId };
    if (value.type === 'GROUP' && typeof value.sourceId === 'number') return { type: 'GROUP', sourceId: value.sourceId };
  } catch {
    // Ignore invalid local preference and fall back to an authorized Source.
  }
  return null;
}

function defaultScope(surfaces: WorklogSurfaces): Scope | null {
  if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId };
  const group = surfaces.groups[0];
  return group ? { type: 'GROUP', sourceId: group.sourceId } : null;
}

function scopeExists(scope: Scope, surfaces: WorklogSurfaces) {
  return scope.type === 'PERSONAL'
    ? surfaces.personal?.sourceId === scope.sourceId
    : surfaces.groups.some((group) => group.sourceId === scope.sourceId);
}

function persistSession(token: string) {
  localStorage.setItem(SESSION_KEY, token);
}

function dedupeRecords(records: WorklogRecord[]) {
  const seen = new Set<number>();
  return records.filter((record) => seen.has(record.id) ? false : (seen.add(record.id), true));
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function inputLabel(type: WorklogInputType) {
  return ({ TEXT: '文字', AUDIO: '語音', IMAGE: '圖片', FILE: '檔案' } as const)[type];
}

function datetimeLocalValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function optionalLocalDateValid(value: string) {
  return !value.trim() || !Number.isNaN(new Date(value).getTime());
}

function localDateOrNull(value: string): string | null {
  return value.trim() ? new Date(value).toISOString() : null;
}

function recordDisplayTime(record: WorklogRecord): { label: string; value: string } {
  if (record.occurredAt) return { label: '發生時間', value: formatDateTime(record.occurredAt) };
  return { label: '記錄時間', value: formatDateTime(record.createdAt) };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW');
}

function formatOptionalDate(value: string | null): string {
  return value ? formatDateTime(value) : '未設定';
}

function normalizeInviteToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.searchParams.get('invite')?.trim() ?? '';
  } catch {
    return trimmed.length <= 256 ? trimmed : '';
  }
}

function inviteShareUrl(token: string): string {
  const url = new URL(window.location.origin);
  url.searchParams.set('invite', token);
  return url.toString();
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  window.prompt('複製邀請連結', value);
}
