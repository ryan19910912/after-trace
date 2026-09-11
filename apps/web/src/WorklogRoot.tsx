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
      </section