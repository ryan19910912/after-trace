import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WorklogApi,
  type GroupFunding,
  type PersonalFunding,
  type RecordFilters,
  type RecordPage,
  type RecordScope,
  type WebEntryContext,
  type WorklogConfirmation,
  type WorklogConfirmationDecision,
  type WorklogEntity,
  type WorklogInputType,
  type WorklogRecord,
  type WorklogRecordRevision,
  type WorklogSurfaces,
} from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';

type Props = { apiBaseUrl: string };
type Scope =
  | { type: 'PERSONAL'; sourceId: number }
  | { type: 'GROUP'; sourceId: number; lineGroupId: string };
type Page = 'RECORDS' | 'FEEDBACK';
type FilterDraft = { entityId: string; query: string; from: string; to: string };
type RecordDraft = { title: string; rawText: string; occurredAt: string };

const EMPTY_FILTER: FilterDraft = { entityId: '', query: '', from: '', to: '' };
const EMPTY_RECORD: RecordDraft = { title: '', rawText: '', occurredAt: '' };

export function WorklogRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const started = useRef(false);
  const initialFilters = useMemo(() => filtersFromUrl(), []);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [records, setRecords] = useState<WorklogRecord[]>([]);
  const [entities, setEntities] = useState<WorklogEntity[]>([]);
  const [recordPage, setRecordPage] = useState<RecordPage | null>(null);
  const [personalFunding, setPersonalFunding] = useState<PersonalFunding | null>(null);
  const [groupFunding, setGroupFunding] = useState<GroupFunding | null>(null);
  const [confirmations, setConfirmations] = useState<WorklogConfirmation[]>([]);
  const [page, setPage] = useState<Page>('RECORDS');
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(initialFilters);
  const [filters, setFilters] = useState<FilterDraft>(initialFilters);
  const [showDeleted, setShowDeleted] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<RecordDraft>(() => ({
    ...EMPTY_RECORD,
    occurredAt: nowLocalValue(),
  }));
  const [editing, setEditing] = useState<WorklogRecord | null>(null);
  const [editDraft, setEditDraft] = useState<RecordDraft | null>(null);
  const [moving, setMoving] = useState<WorklogRecord | null>(null);
  const [moveTitle, setMoveTitle] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchTitle, setBatchTitle] = useState('');
  const [historyRecord, setHistoryRecord] = useState<WorklogRecord | null>(null);
  const [revisions, setRevisions] = useState<WorklogRecordRevision[]>([]);
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
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    // Every editor/history state below is bound to one Source. Closing all of it on a
    // Source switch prevents a user who belongs to multiple groups from accidentally
    // editing a Record from the previous group while looking at the newly selected one.
    setSelected(new Set());
    setBatchTitle('');
    setCreateOpen(false);
    setCreateDraft({ ...EMPTY_RECORD, occurredAt: nowLocalValue() });
    setEditing(null);
    setEditDraft(null);
    setMoving(null);
    setMoveTitle('');
    setHistoryRecord(null);
    setRevisions([]);
    setPersonalFunding(null);
    setGroupFunding(null);
    setConfirmations([]);
    void Promise.all([
      loadScope(session, scope, filters, false, showDeleted),
      loadEntities(session, scope),
      loadConfirmations(session, scope),
      loadPersonalFunding(session, scope),
      loadGroupFunding(session, scope),
    ]);
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
      const entry = url.searchParams.get('t')?.trim();

      if (entry) {
        const exchanged = await api.exchangeEntry(entry);
        token = exchanged.sessionToken;
        entryContext = exchanged.entryContext;
        persistSession(token);
        setSession(token);
        url.searchParams.delete('t');
        url.searchParams.delete('openExternalBrowser');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        persistSession(callback);
        setSession(callback);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }

      if (!token) return;
      const nextSurfaces = await api.surfaces(token);
      setSurfaces(nextSurfaces);
      const linked = scopeFromEntry(entryContext, nextSurfaces);
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

  async function loadScope(
    token: string,
    nextScope: Scope,
    nextFilters: FilterDraft,
    append: boolean,
    deleted = showDeleted,
  ) {
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
      setRecords((current) => append ? dedupeRecords([...current, ...result.records]) : result.records);
      setRecordPage(result.page);
    } catch (cause) {
      setError(message(cause, '紀錄載入失敗'));
      if (!append) setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadEntities(token: string, nextScope: Scope) {
    try {
      setEntities(await api.entities(token, recordScope(nextScope)));
    } catch (cause) {
      setError(message(cause, '紀錄標題載入失敗'));
    }
  }

  async function loadConfirmations(token: string, nextScope: Scope) {
    try {
      setConfirmations(await api.pendingConfirmations(token, recordScope(nextScope)));
    } catch (cause) {
      setError(message(cause, '待確認紀錄載入失敗'));
    }
  }

  async function loadPersonalFunding(token: string, nextScope: Scope) {
    if (nextScope.type !== 'PERSONAL') {
      setPersonalFunding(null);
      return;
    }
    try {
      setPersonalFunding(await api.personalFunding(token));
    } catch (cause) {
      setError(message(cause, '個人 AI 點數載入失敗'));
    }
  }

  async function loadGroupFunding(token: string, nextScope: Scope) {
    if (nextScope.type !== 'GROUP') {
      setGroupFunding(null);
      return;
    }
    try {
      setGroupFunding(await api.groupFunding(token, nextScope.sourceId));
    } catch (cause) {
      setError(message(cause, '群組 AI 點數載入失敗'));
    }
  }

  async function refreshAfterMutation(text: string, reloadEntities = false) {
    if (!session || !scope) return;
    setNotice(text);
    setError(null);
    await loadScope(session, scope, filters, false, showDeleted);
    if (reloadEntities) await loadEntities(session, scope);
    await loadConfirmations(session, scope);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVE_SCOPE_KEY);
    setSession(null);
    setSurfaces(null);
    setScope(null);
    setRecords([]);
    setEntities([]);
    setRecordPage(null);
    setPersonalFunding(null);
    setGroupFunding(null);
    setConfirmations([]);
    setSelected(new Set());
    setBatchTitle('');
    setCreateOpen(false);
    setEditing(null);
    setEditDraft(null);
    setMoving(null);
    setMoveTitle('');
    setHistoryRecord(null);
    setRevisions([]);
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

  async function createRecord() {
    if (!session || !scope || !validLocalDate(createDraft.occurredAt)) return;
    setLoading(true);
    setError(null);
    try {
      await api.createRecord(session, recordScope(scope), {
        title: createDraft.title.trim(),
        rawText: createDraft.rawText.trim(),
        occurredAt: new Date(createDraft.occurredAt).toISOString(),
      });
      setCreateDraft({ ...EMPTY_RECORD, occurredAt: nowLocalValue() });
      setCreateOpen(false);
      await refreshAfterMutation('紀錄已新增。', true);
    } catch (cause) {
      setError(message(cause, '新增紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit(record: WorklogRecord, draft: RecordDraft) {
    if (!session || !validLocalDate(draft.occurredAt)) return;
    setLoading(true);
    setError(null);
    try {
      await api.updateRecord(session, record.id, {
        expectedVersion: record.version,
        rawText: draft.rawText.trim(),
        occurredAt: new Date(draft.occurredAt).toISOString(),
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

  async function moveRecord(record: WorklogRecord) {
    if (!session || !moveTitle.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.moveRecord(session, record.id, {
        expectedVersion: record.version,
        title: moveTitle.trim(),
      });
      setMoving(null);
      setMoveTitle('');
      await refreshAfterMutation('紀錄標題已變更。', true);
    } catch (cause) {
      setError(message(cause, '移動紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function batchMove() {
    if (!session || !batchTitle.trim() || selected.size === 0) return;
    const targets = records
      .filter((record) => selected.has(record.id))
      .map((record) => ({ id: record.id, expectedVersion: record.version }));
    setLoading(true);
    setError(null);
    try {
      await api.batchMoveRecords(session, targets, { title: batchTitle.trim() });
      setSelected(new Set());
      setBatchTitle('');
      await refreshAfterMutation(`已移動 ${targets.length} 筆紀錄。`, true);
    } catch (cause) {
      setError(message(cause, '批次移動失敗'));
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

  async function resolveConfirmation(confirmationId: number, decision: WorklogConfirmationDecision) {
    if (!session || !scope) return;
    const confirmation = confirmations.find((value) => value.id === confirmationId) ?? null;
    setLoading(true);
    setError(null);
    try {
      await api.resolveConfirmation(session, recordScope(scope), confirmationId, decision);
      await Promise.all([
        loadScope(session, scope, filters, false, showDeleted),
        loadEntities(session, scope),
        loadConfirmations(session, scope),
      ]);
      if (confirmation?.operation === 'LINE_AI_EDIT') {
        setNotice(decision.action === 'REJECT'
          ? '已拒絕這次 AI 修改，原紀錄維持不變。'
          : 'AI 修改已套用，並保留完整編輯紀錄。');
      } else {
        setNotice(decision.action === 'REJECT' ? '已略過這次 AI 標題建議。' : '紀錄標題已確認。');
      }
    } catch (cause) {
      setError(message(cause, '待確認紀錄處理失敗'));
      await loadConfirmations(session, scope);
    } finally {
      setLoading(false);
    }
  }

  async function configureGroupGrant(grantId: number, enabled: boolean, capPoints: number | null) {
    if (!session || scope?.type !== 'GROUP') return;
    setLoading(true);
    setError(null);
    try {
      const nextFunding = await api.configureGroupGrant(session, scope.sourceId, grantId, { enabled, capPoints });
      setGroupFunding(nextFunding);
      setNotice('群組 AI 點數分配已更新。');
    } catch (cause) {
      setError(message(cause, '群組 AI 點數設定失敗'));
      await loadGroupFunding(session, scope);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(record: WorklogRecord) {
    setEditing(record);
    setEditDraft({
      title: record.title ?? '',
      rawText: record.rawText,
      occurredAt: datetimeLocalValue(record.occurredAt),
    });
  }

  function cancelEdit() {
    setEditing(null);
    setEditDraft(null);
  }

  if (!session) {
    return <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>工作紀錄中心</h1>
        <p className="muted">使用 LINE 登入，查看與管理你的工作紀錄。</p>
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => { window.location.href = api.lineLoginUrl(); }}>使用 LINE 登入</button>
      </section>
    </main>;
  }

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
    {scope?.type === 'GROUP'
      ? groupFunding ? <GroupFundingPanel funding={groupFunding} busy={loading} onSave={configureGroupGrant} /> : null
      : personalFunding ? <PersonalFundingPanel funding={personalFunding} /> : null}

    <nav className="worklog-main-tabs">
      <button className={page === 'RECORDS' ? 'active' : ''} onClick={() => setPage('RECORDS')}>紀錄</button>
      <button className={page === 'FEEDBACK' ? 'active' : ''} onClick={() => setPage('FEEDBACK')}>意見回饋</button>
    </nav>

    {page === 'RECORDS' ? <>
      <ScopePicker surfaces={surfaces} scope={scope} onChange={setScope} />

      {confirmations.length > 0 ? <PendingConfirmationsPanel
        confirmations={confirmations}
        busy={loading}
        onResolve={resolveConfirmation}
      /> : null}

      <section className="panel">
        <div className="filter-actions">
          <button onClick={() => setCreateOpen((value) => !value)}>＋新增紀錄</button>
          <button className={showDeleted ? 'active' : 'ghost'} onClick={() => setShowDeleted((value) => !value)}>
            {showDeleted ? '返回目前紀錄' : '回收桶'}
          </button>
        </div>
        {createOpen && !showDeleted ? <RecordEditor
          heading="新增紀錄"
          draft={createDraft}
          entities={entities}
          onChange={setCreateDraft}
          onCancel={() => setCreateOpen(false)}
          onSave={() => void createRecord()}
          busy={loading}
        /> : null}
      </section>

      <RecordFiltersPanel
        draft={filterDraft}
        entities={entities}
        onChange={setFilterDraft}
        onApply={applyFilters}
        onClear={clearFilters}
      />

      {!showDeleted && selected.size > 0 ? <section className="panel">
        <strong>已選 {selected.size} 筆</strong>
        <div className="filter-actions">
          <input
            list="aftertrace-title-options"
            value={batchTitle}
            onChange={(event) => setBatchTitle(event.target.value)}
            placeholder="移動到紀錄標題"
          />
          <button disabled={loading || !batchTitle.trim()} onClick={() => void batchMove()}>批次移動</button>
          <button className="ghost" onClick={() => setSelected(new Set())}>取消選取</button>
        </div>
      </section> : null}

      <TitleDatalist entities={entities} />

      <section className="panel">
        {loading && records.length === 0 ? <div className="empty">載入中…</div> : null}
        {!loading && scope && records.length === 0 ? <div className="empty">目前沒有符合條件的紀錄。</div> : null}
        <div className="worklog-record-list">
          {records.map((record) => <RecordCard
            key={record.id}
            record={record}
            deleted={showDeleted}
            selected={selected.has(record.id)}
            onSelect={(checked) => setSelected((current) => {
              const next = new Set(current);
              checked ? next.add(record.id) : next.delete(record.id);
              return next;
            })}
            onEdit={() => startEdit(record)}
            onMove={() => { setMoving(record); setMoveTitle(record.title ?? ''); }}
            onHistory={() => void openHistory(record)}
            onDelete={() => void deleteRecord(record)}
            onRestore={() => void restoreRecord(record)}
          />)}
        </div>
        {recordPage?.hasMore ? <button
          className="load-more"
          disabled={loading}
          onClick={() => session && scope && void loadScope(session, scope, filters, true, showDeleted)}
        >{loading ? '載入中…' : '載入更多'}</button> : null}
      </section>

      {editing && editDraft ? <section className="panel">
        <RecordEditor
          heading={`編輯：${editing.title ?? '待確認'}`}
          draft={editDraft}
          entities={entities}
          hideTitle
          onChange={setEditDraft}
          onCancel={cancelEdit}
          onSave={() => void saveEdit(editing, editDraft)}
          busy={loading}
        />
      </section> : null}

      {moving ? <section className="panel">
        <h2>移動紀錄標題</h2>
        <p className="muted">只改變這筆紀錄的歸類，不會改寫紀錄內容或發生時間。</p>
        <input list="aftertrace-title-options" value={moveTitle} onChange={(event) => setMoveTitle(event.target.value)} />
        <div className="filter-actions">
          <button disabled={loading || !moveTitle.trim()} onClick={() => void moveRecord(moving)}>儲存</button>
          <button className="ghost" onClick={() => setMoving(null)}>取消</button>
        </div>
      </section> : null}

      {historyRecord ? <HistoryPanel
        record={historyRecord}
        revisions={revisions}
        onClose={() => { setHistoryRecord(null); setRevisions([]); }}
      /> : null}
    </> : null}

    {page === 'FEEDBACK' ? <FeedbackPanel
      busy={loading}
      onSubmit={async (text) => {
        if (!session) return;
        try {
          await api.submitFeedback(session, text, {
            page: window.location.pathname,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            userAgent: navigator.userAgent,
            appVersion: 'worklog-mvp',
            scopeType: scope?.type ?? 'NONE',
            sourceId: scope?.sourceId ?? 0,
          });
          setNotice('意見已送出，謝謝。');
        } catch (cause) {
          setError(message(cause, '意見送出失敗'));
          throw cause;
        }
      }}
    /> : null}
  </main>;
}

function ScopePicker({ surfaces, scope, onChange }: {
  surfaces: WorklogSurfaces | null;
  scope: Scope | null;
  onChange: (scope: Scope) => void;
}) {
  return <section className="panel worklog-scope-panel"><div className="worklog-scope-row">
    {surfaces?.personal ? <button
      className={scope?.type === 'PERSONAL' ? 'worklog-scope active' : 'worklog-scope'}
      onClick={() => onChange({ type: 'PERSONAL', sourceId: surfaces.personal!.sourceId })}
    >個人紀錄</button> : null}
    {surfaces?.groups.map((group, index) => <button
      key={group.sourceId}
      className={scope?.type === 'GROUP' && scope.sourceId === group.sourceId ? 'worklog-scope active' : 'worklog-scope'}
      onClick={() => onChange({ type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId })}
    >群組 {index + 1}</button>)}
  </div></section>;
}

function PersonalFundingPanel({ funding }: { funding: PersonalFunding }) {
  return <section className="panel stack">
    <div><p className="eyebrow">PRIVATE AI</p><h2>個人 AI 點數</h2></div>
    <div className="worklog-usage">
      <span>可用 {funding.availablePoints.toLocaleString('zh-TW')}</span>
      <span>處理中 {funding.reservedPoints.toLocaleString('zh-TW')}</span>
      <span>歷史已用 {funding.usedPoints.toLocaleString('zh-TW')}</span>
      <span>平台補貼 {funding.platformSubsidizedPoints.toLocaleString('zh-TW')}</span>
    </div>
    <p className="muted">AI 點數直接來自你擁有且允許此個人 Source 使用的 Grant；手動新增、編輯與搜尋不消耗 AI 點數。</p>
    {funding.grants.length > 0 ? <div className="stack">
      <h3>我的 AI Grant</h3>
      {funding.grants.map((grant) => <article className="worklog-record-card" key={grant.id}>
        <div className="worklog-record-meta">
          <strong>{grant.type}</strong>
          <span>{grant.status}</span>
          <span>剩餘 {grant.remainingPoints.toLocaleString('zh-TW')}</span>
          <span>個人可用 {grant.sourceAvailablePoints.toLocaleString('zh-TW')}</span>
          {grant.expiresAt ? <span>到期 {new Date(grant.expiresAt).toLocaleDateString('zh-TW')}</span> : <span>無固定到期日</span>}
        </div>
        <p className="muted">此 Source 已用 {grant.usedPoints.toLocaleString('zh-TW')} · 處理中 {grant.reservedPoints.toLocaleString('zh-TW')}</p>
      </article>)}
    </div> : null}
  </section>;
}

function GroupFundingPanel({ funding, busy, onSave }: {
  funding: GroupFunding;
  busy: boolean;
  onSave: (grantId: number, enabled: boolean, capPoints: number | null) => Promise<void>;
}) {
  return <section className="panel stack">
    <div className="topbar">
      <div>
        <p className="eyebrow">GROUP AI</p>
        <h2>群組 AI 點數</h2>
      </div>
      <div className="muted">
        {funding.responsibleUser
          ? `AI 額度負責人：${funding.responsibleUser.displayName ?? `使用者 ${funding.responsibleUser.id}`}${funding.responsibleUserActive ? '' : '（目前不在群組）'}`
          : '尚未設定 AI 額度負責人'}
      </div>
    </div>
    <div className="worklog-usage">
      <span>可用 {funding.availablePoints.toLocaleString('zh-TW')}</span>
      <span>處理中 {funding.reservedPoints.toLocaleString('zh-TW')}</span>
      <span>歷史已用 {funding.usedPoints.toLocaleString('zh-TW')}</span>
      <span>平台補貼 {funding.platformSubsidizedPoints.toLocaleString('zh-TW')}</span>
    </div>
    {!funding.responsibleUser ? <p className="muted">手動查看、新增、編輯與搜尋仍可免費使用；只有需要 AI 時才需要設定 AI 額度負責人。</p> : null}
    {funding.responsibleUser && !funding.responsibleUserActive ? <p className="muted">AI 額度負責人目前不在群組，因此群組 AI 暫停；手動 PWA 功能不受影響。</p> : null}
    {funding.canManage ? <div className="stack">
      <h3>我的 AI 點數分配</h3>
      <p className="muted">只會列出你自己的 Grant。啟用後這個群組才能使用該筆點數；上限留空代表不另外限制這個群組。</p>
      {funding.grants.length === 0 ? <p className="muted">目前沒有可設定的 AI Grant。</p> : funding.grants.map((grant) => <GrantFundingRow
        key={`${grant.id}:${grant.enabled}:${grant.capPoints ?? 'none'}:${grant.usedPoints}:${grant.reservedPoints}`}
        grant={grant}
        busy={busy}
        onSave={onSave}
      />)}
    </div> : null}
  </section>;
}

function GrantFundingRow({ grant, busy, onSave }: {
  grant: GroupFunding['grants'][number];
  busy: boolean;
  onSave: (grantId: number, enabled: boolean, capPoints: number | null) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(grant.enabled);
  const [cap, setCap] = useState(grant.capPoints === null ? '' : String(grant.capPoints));
  const normalizedCap = cap.trim();
  const capNumber = normalizedCap === '' ? null : Number(normalizedCap);
  const capValid = normalizedCap === '' || (/^\d+$/.test(normalizedCap) && Number.isSafeInteger(capNumber) && (capNumber ?? 0) >= 0);
  return <article className="worklog-record-card">
    <div className="worklog-record-meta">
      <strong>{grant.type}</strong>
      <span>{grant.status}</span>
      <span>剩餘 {grant.remainingPoints.toLocaleString('zh-TW')}</span>
      <span>此群組可用 {grant.sourceAvailablePoints.toLocaleString('zh-TW')}</span>
      {grant.expiresAt ? <span>到期 {new Date(grant.expiresAt).toLocaleDateString('zh-TW')}</span> : <span>無固定到期日</span>}
    </div>
    <div className="filter-actions">
      <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 啟用於此群組</label>
      <label>群組上限
        <input type="number" min="0" step="1" value={cap} onChange={(event) => setCap(event.target.value)} placeholder="不限制" />
      </label>
      <button disabled={busy || !capValid} onClick={() => void onSave(grant.id, enabled, capNumber)}>儲存分配</button>
    </div>
    <p className="muted">此群組已用 {grant.usedPoints.toLocaleString('zh-TW')} · 處理中 {grant.reservedPoints.toLocaleString('zh-TW')}</p>
  </article>;
}

function PendingConfirmationsPanel({ confirmations, busy, onResolve }: {
  confirmations: WorklogConfirmation[];
  busy: boolean;
  onResolve: (confirmationId: number, decision: WorklogConfirmationDecision) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const hasLineEdit = confirmations.some((confirmation) => confirmation.operation === 'LINE_AI_EDIT');
  return <section className="panel stack">
    <div><p className="eyebrow">待確認</p><h2>{hasLineEdit ? 'AI 有修改需要你確認' : 'AI 需要你確認紀錄標題'}</h2></div>
    <p className="muted">這些 AI 結果已經保存並完成原本的點數結算；以下確認或拒絕不會再呼叫 AI，也不會再扣 AI 點數。</p>
    {confirmations.map((confirmation) => {
      const isLineEdit = confirmation.operation === 'LINE_AI_EDIT';
      const customTitle = drafts[confirmation.id] ?? confirmation.proposedName ?? confirmation.candidateTitle ?? '';
      const extraCandidate = confirmation.candidateEntityId
        && !confirmation.candidates.some((candidate) => candidate.entityId === confirmation.candidateEntityId)
        ? { entityId: confirmation.candidateEntityId, name: confirmation.candidateTitle ?? `標題 ${confirmation.candidateEntityId}` }
        : null;
      return <article className="worklog-record-card" key={confirmation.id}>
        <div className="worklog-record-meta">
          <span>{isLineEdit ? 'LINE AI 修改' : confirmation.confirmationType}</span>
          <span>預期版本 {confirmation.expectedRecordVersion}</span>
        </div>
        {isLineEdit ? <div className="stack">
          <div>
            <p className="muted">目前紀錄</p>
            <strong>{confirmation.recordRawText}</strong>
            <p className="muted">發生時間：{new Date(confirmation.recordOccurredAt).toLocaleString('zh-TW')}</p>
          </div>
          <div>
            <p className="muted">AI 建議修改</p>
            <strong>{confirmation.proposedRawText ?? confirmation.recordRawText}</strong>
            <p className="muted">發生時間：{new Date(confirmation.occurredAt).toLocaleString('zh-TW')}</p>
          </div>
          <p className="muted">選好正確的紀錄標題後才會原子套用上述修改；若紀錄版本已改變，後端會拒絕舊建議。</p>
        </div> : <>
          <time>{new Date(confirmation.occurredAt).toLocaleString('zh-TW')}</time>
          <strong>{confirmation.recordRawText}</strong>
        </>}
        {(confirmation.candidates.length > 0 || extraCandidate) ? <div className="stack">
          <p className="muted">可能是既有紀錄標題：</p>
          <div className="filter-actions">
            {confirmation.candidates.map((candidate) => <button
              key={candidate.entityId}
              disabled={busy}
              onClick={() => void onResolve(confirmation.id, { action: 'USE_EXISTING', entityId: candidate.entityId })}
            >{isLineEdit ? `套用修改並使用「${candidate.name}」` : `使用「${candidate.name}」`}</button>)}
            {extraCandidate ? <button
              disabled={busy}
              onClick={() => void onResolve(confirmation.id, { action: 'USE_EXISTING', entityId: extraCandidate.entityId })}
            >{isLineEdit ? `套用修改並使用「${extraCandidate.name}」` : `使用「${extraCandidate.name}」`}</button> : null}
          </div>
        </div> : null}
        <div className="stack">
          <label>{isLineEdit ? '建立／採用正確的修改後標題' : '建立／採用新紀錄標題'}
            <input
              list="aftertrace-title-options"
              value={customTitle}
              onChange={(event) => setDrafts((current) => ({ ...current, [confirmation.id]: event.target.value }))}
              placeholder="輸入正確的紀錄標題"
            />
          </label>
          <div className="filter-actions">
            <button
              disabled={busy || !customTitle.trim()}
              onClick={() => void onResolve(confirmation.id, { action: 'CREATE_TITLE', title: customTitle.trim() })}
            >{isLineEdit ? '套用修改並使用這個標題' : '使用這個新標題'}</button>
            <button className="ghost" disabled={busy} onClick={() => void onResolve(confirmation.id, { action: 'REJECT' })}>
              {isLineEdit ? '拒絕這次 AI 修改' : '略過'}
            </button>
          </div>
        </div>
      </article>;
    })}
  </section>;
}

function RecordFiltersPanel({ draft, entities, onChange, onApply, onClear }: {
  draft: FilterDraft;
  entities: WorklogEntity[];
  onChange: (value: FilterDraft) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return <section className="panel record-filter-card">
    <div className="record-filter-grid">
      <label>紀錄標題
        <select value={draft.entityId} onChange={(event) => onChange({ ...draft, entityId: event.target.value })}>
          <option value="">全部</option>
          {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
      </label>
      <label>模糊搜尋
        <input value={draft.query} onChange={(event) => onChange({ ...draft, query: event.target.value })} placeholder="標題、其他稱呼或紀錄內容" />
      </label>
      <label>從<input type="datetime-local" value={draft.from} onChange={(event) => onChange({ ...draft, from: event.target.value })} /></label>
      <label>到<input type="datetime-local" value={draft.to} onChange={(event) => onChange({ ...draft, to: event.target.value })} /></label>
    </div>
    <div className="filter-actions"><button onClick={onApply}>套用篩選</button><button className="ghost" onClick={onClear}>清除</button></div>
  </section>;
}

function RecordEditor({ heading, draft, entities, hideTitle = false, onChange, onCancel, onSave, busy }: {
  heading: string;
  draft: RecordDraft;
  entities: WorklogEntity[];
  hideTitle?: boolean;
  onChange: (value: RecordDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const occurredAtValid = validLocalDate(draft.occurredAt);
  return <div className="stack">
    <h2>{heading}</h2>
    {!hideTitle ? <label>紀錄標題
      <input list="aftertrace-title-options" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder="選擇既有標題或直接輸入新標題" />
    </label> : null}
    <label>紀錄內容<textarea rows={6} value={draft.rawText} onChange={(event) => onChange({ ...draft, rawText: event.target.value })} /></label>
    <label>發生時間<input type="datetime-local" value={draft.occurredAt} onChange={(event) => onChange({ ...draft, occurredAt: event.target.value })} /></label>
    <div className="filter-actions">
      <button disabled={busy || (!hideTitle && !draft.title.trim()) || !draft.rawText.trim() || !occurredAtValid} onClick={onSave}>儲存</button>
      <button className="ghost" onClick={onCancel}>取消</button>
    </div>
    <TitleDatalist entities={entities} />
  </div>;
}

function TitleDatalist({ entities }: { entities: WorklogEntity[] }) {
  return <datalist id="aftertrace-title-options">
    {entities.map((entity) => <option key={entity.id} value={entity.name}>{entity.aliases.join('、')}</option>)}
  </datalist>;
}

function RecordCard({ record, deleted, selected, onSelect, onEdit, onMove, onHistory, onDelete, onRestore }: {
  record: WorklogRecord;
  deleted: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onMove: () => void;
  onHistory: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return <article className="worklog-record-card">
    <div className="worklog-record-meta">
      {!deleted ? <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} /> : null}
      <span>{inputLabel(record.inputType)}</span>
      <span>{record.title ?? '待確認'}</span>
      {record.version > 1 ? <span>已編輯</span> : null}
      <time>{new Date(record.occurredAt).toLocaleString('zh-TW')}</time>
    </div>
    <strong>{record.rawText}</strong>
    <div className="filter-actions">
      {!deleted ? <><button className="ghost" onClick={onEdit}>編輯</button><button className="ghost" onClick={onMove}>移動標題</button><button className="ghost" onClick={onDelete}>刪除</button></> : <button onClick={onRestore}>還原</button>}
      <button className="ghost" onClick={onHistory}>編輯紀錄</button>
    </div>
  </article>;
}

function HistoryPanel({ record, revisions, onClose }: {
  record: WorklogRecord;
  revisions: WorklogRecordRevision[];
  onClose: () => void;
}) {
  return <section className="panel stack">
    <div className="topbar"><div><p className="eyebrow">HISTORY</p><h2>{record.title ?? '待確認'} · 編輯紀錄</h2></div><button className="ghost" onClick={onClose}>關閉</button></div>
    {revisions.length === 0 ? <p className="muted">這筆紀錄尚無修改歷史。</p> : revisions.map((revision) => <article className="worklog-record-card" key={revision.id}>
      <div className="worklog-record-meta"><span>版本 {revision.version}</span><span>{revision.editorDisplayName ?? `使用者 ${revision.editorUserId ?? '-'}`}</span><time>{new Date(revision.createdAt).toLocaleString('zh-TW')}</time></div>
      <p>{revision.previousTitle ?? '待確認'} → {revision.newTitle ?? '待確認'}</p>
      <p>{revision.previousRawText}</p><p>→</p><strong>{revision.newRawText}</strong>
      {revision.previousStatus !== revision.newStatus ? <p>{revision.previousStatus} → {revision.newStatus}</p> : null}
    </article>)}
  </section>;
}

function FeedbackPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  return <section className="panel feedback-panel">
    <p className="eyebrow">FEEDBACK</p><h2>告訴我們哪裡不好用</h2>
    <p className="muted">送出時會附上目前頁面、畫面尺寸、瀏覽器與目前紀錄範圍，方便排查；不會附上你的原始工作紀錄內容。</p>
    <textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：群組紀錄篩選很難找、某個附件一直失敗…" />
    <button disabled={busy || !text.trim()} onClick={() => void onSubmit(text.trim()).then(() => setText('')).catch(() => undefined)}>送出意見</button>
  </section>;
}

function recordScope(value: Scope): RecordScope {
  return value.type === 'PERSONAL'
    ? { type: 'PERSONAL', sourceId: value.sourceId }
    : { type: 'GROUP', sourceId: value.sourceId };
}

function apiFilters(value: FilterDraft, offset: number): RecordFilters {
  return {
    entityId: value.entityId ? Number(value.entityId) : undefined,
    query: value.query,
    from: value.from && validLocalDate(value.from) ? new Date(value.from).toISOString() : undefined,
    to: value.to && validLocalDate(value.to) ? new Date(value.to).toISOString() : undefined,
    limit: 50,
    offset,
  };
}

function filtersFromUrl(): FilterDraft {
  const params = new URL(window.location.href).searchParams;
  const entityId = params.get('entityId')?.trim() ?? '';
  const query = params.get('q')?.trim() ?? '';
  const from = urlDateToLocal(params.get('from'));
  const to = urlDateToLocal(params.get('to'));
  return { entityId: /^\d+$/.test(entityId) ? entityId : '', query, from, to };
}

function urlDateToLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : datetimeLocalValue(date.toISOString());
}

function scopeFromEntry(entry: WebEntryContext | null, surfaces: WorklogSurfaces): Scope | null {
  if (!entry) return null;
  if (entry.type === 'PRIVATE') {
    return surfaces.personal?.sourceId === entry.sourceId
      ? { type: 'PERSONAL', sourceId: entry.sourceId }
      : null;
  }
  const group = surfaces.groups.find((value) => value.lineGroupId === entry.lineGroupId);
  return group ? { type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId } : null;
}

function storedScope(): Scope | null {
  const raw = localStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') return { type: 'PERSONAL', sourceId: value.sourceId };
    if (value.type === 'GROUP' && typeof value.sourceId === 'number' && typeof value.lineGroupId === 'string') {
      return { type: 'GROUP', sourceId: value.sourceId, lineGroupId: value.lineGroupId };
    }
  } catch {
    // Ignore invalid persisted UI state and choose a fresh authorized scope.
  }
  return null;
}

function defaultScope(surfaces: WorklogSurfaces): Scope | null {
  if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId };
  const group = surfaces.groups[0];
  return group ? { type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId } : null;
}

function scopeExists(scope: Scope, surfaces: WorklogSurfaces) {
  return scope.type === 'PERSONAL'
    ? surfaces.personal?.sourceId === scope.sourceId
    : surfaces.groups.some((group) => group.sourceId === scope.sourceId && group.lineGroupId === scope.lineGroupId);
}

function persistSession(token: string) { localStorage.setItem(SESSION_KEY, token); }
function dedupeRecords(records: WorklogRecord[]) { const seen = new Set<number>(); return records.filter((record) => seen.has(record.id) ? false : (seen.add(record.id), true)); }
function message(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
function inputLabel(type: WorklogInputType) { return ({ TEXT: '文字', AUDIO: '音檔', IMAGE: '圖片', FILE: '檔案' } as const)[type]; }
function nowLocalValue() { return datetimeLocalValue(new Date().toISOString()); }
function datetimeLocalValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function validLocalDate(value: string) {
  if (!value.trim()) return false;
  return !Number.isNaN(new Date(value).getTime());
}
