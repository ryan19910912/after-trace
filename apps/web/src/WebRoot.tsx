import { useEffect, useMemo, useRef, useState } from 'react';
import { App } from './App';
import { ManagementApi, type ManagedGroup, type WebEntryContext, WebAuthApi } from './api';

const SESSION_KEY = 'aftertrace.web.session';
const LAST_GROUP_KEY = 'aftertrace.web.lastGroup';
const ENTRY_CONTEXT_KEY = 'aftertrace.web.entryContext';

type Props = {
  apiBaseUrl: string;
};

type SelectedGroup = {
  lineGroupId: string;
  groupContextToken: string;
};

function storedEntryContext(): WebEntryContext | null {
  const raw = localStorage.getItem(ENTRY_CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === 'GROUP' && typeof parsed.lineGroupId === 'string' && parsed.lineGroupId) {
      return { type: 'GROUP', lineGroupId: parsed.lineGroupId };
    }
    if (
      parsed.type === 'PRIVATE'
      && typeof parsed.userId === 'number'
      && Number.isSafeInteger(parsed.userId)
      && parsed.userId > 0
      && typeof parsed.sourceId === 'number'
      && Number.isSafeInteger(parsed.sourceId)
      && parsed.sourceId > 0
    ) {
      return { type: 'PRIVATE', userId: parsed.userId, sourceId: parsed.sourceId };
    }
  } catch {
    // Stale/corrupt client state is not an authorization source; discard it.
  }
  localStorage.removeItem(ENTRY_CONTEXT_KEY);
  return null;
}

function persistEntryContext(context: WebEntryContext | null) {
  if (!context) {
    localStorage.removeItem(ENTRY_CONTEXT_KEY);
    return;
  }
  localStorage.setItem(ENTRY_CONTEXT_KEY, JSON.stringify(context));
}

export function WebRoot({ apiBaseUrl }: Props) {
  const authApi = useMemo(() => new WebAuthApi(apiBaseUrl), [apiBaseUrl]);
  const bootstrapStarted = useRef(false);
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [entryContext, setEntryContext] = useState<WebEntryContext | null>(() => storedEntryContext());
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null);
  const [groups, setGroups] = useState<ManagedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callbackSession = hash.get('session')?.trim();
      if (callbackSession) {
        localStorage.setItem(SESSION_KEY, callbackSession);
        persistEntryContext(null);
        setSessionToken(callbackSession);
        setEntryContext(null);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
        await loadGroups(callbackSession);
        return;
      }

      const url = new URL(window.location.href);
      const entryToken = url.searchParams.get('t')?.trim();
      if (entryToken) {
        const exchanged = await authApi.exchangeEntry(entryToken);
        localStorage.setItem(SESSION_KEY, exchanged.sessionToken);
        persistEntryContext(exchanged.entryContext);
        setSessionToken(exchanged.sessionToken);
        setEntryContext(exchanged.entryContext);

        if (exchanged.entryContext.type === 'GROUP') {
          localStorage.setItem(LAST_GROUP_KEY, exchanged.entryContext.lineGroupId);
          const nextGroups = await authApi.groups(exchanged.sessionToken);
          setGroups(nextGroups);
          const current = nextGroups.find((group) => group.lineGroupId === exchanged.entryContext.lineGroupId);
          if (!current && !exchanged.groupContextToken) throw new Error('群組登入內容不完整');
          setSelectedGroup({
            lineGroupId: exchanged.entryContext.lineGroupId,
            groupContextToken: current?.groupContextToken ?? exchanged.groupContextToken!,
          });
        } else {
          // A PRIVATE entry must remain independent from group membership and the
          // legacy group-management surface. Worklog record APIs will populate
          // this personal surface in a later batch.
          setSelectedGroup(null);
          setGroups([]);
        }

        url.searchParams.delete('t');
        url.searchParams.delete('openExternalBrowser');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
        return;
      }

      const existing = localStorage.getItem(SESSION_KEY);
      if (existing) {
        const rememberedContext = storedEntryContext();
        setEntryContext(rememberedContext);
        if (rememberedContext?.type !== 'PRIVATE') await loadGroups(existing);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '登入初始化失敗';
      if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED|INVALID_USER_TOKEN/.test(message)) {
        localStorage.removeItem(SESSION_KEY);
        persistEntryContext(null);
        setSessionToken(null);
        setEntryContext(null);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadGroups(token: string) {
    const nextGroups = await authApi.groups(token);
    setGroups(nextGroups);
    const lastGroupId = localStorage.getItem(LAST_GROUP_KEY);
    const remembered = nextGroups.find((group) => group.lineGroupId === lastGroupId);
    if (remembered) {
      setSelectedGroup({
        lineGroupId: remembered.lineGroupId,
        groupContextToken: remembered.groupContextToken,
      });
    }
  }

  function chooseGroup(group: ManagedGroup) {
    const context: WebEntryContext = { type: 'GROUP', lineGroupId: group.lineGroupId };
    localStorage.setItem(LAST_GROUP_KEY, group.lineGroupId);
    persistEntryContext(context);
    setEntryContext(context);
    setSelectedGroup({
      lineGroupId: group.lineGroupId,
      groupContextToken: group.groupContextToken,
    });
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_GROUP_KEY);
    persistEntryContext(null);
    setSessionToken(null);
    setEntryContext(null);
    setSelectedGroup(null);
    setGroups([]);
  }

  if (loading) {
    return (
      <main className="shell fatal-shell">
        <section className="fatal-card">
          <p className="eyebrow">AFTERTRACE</p>
          <h1>正在開啟管理中心</h1>
          <p className="muted">正在確認登入狀態與紀錄範圍。</p>
        </section>
      </main>
    );
  }

  if (!sessionToken) {
    return (
      <main className="shell fatal-shell">
        <section className="fatal-card">
          <p className="eyebrow">AFTERTRACE</p>
          <h1>AFTERTRACE 紀錄中心</h1>
          <p>使用 LINE 登入後，可以查看你有權存取的個人與群組紀錄。</p>
          {error ? <div className="error">{error}</div> : null}
          <button type="button" onClick={() => { window.location.href = authApi.lineLoginUrl(); }}>
            使用 LINE 登入
          </button>
        </section>
      </main>
    );
  }

  if (entryContext?.type === 'PRIVATE') {
    return (
      <main className="shell">
        <div className="topbar">
          <div>
            <p className="eyebrow">AFTERTRACE</p>
            <h1>個人紀錄</h1>
          </div>
          <button className="ghost" type="button" onClick={logout}>登出</button>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <section className="panel">
          <div className="empty">
            已完成安全登入。個人工作紀錄列表會由新的 Worklog API 顯示，不會混入舊的群組 Memory 資料。
          </div>
        </section>
      </main>
    );
  }

  if (selectedGroup) {
    const managementApi = new ManagementApi(apiBaseUrl, sessionToken, selectedGroup.groupContextToken);
    return (
      <>
        <div className="web-session-bar">
          <button className="ghost" type="button" onClick={() => setSelectedGroup(null)}>切換群組</button>
          <button className="ghost" type="button" onClick={logout}>登出</button>
        </div>
        <App
          api={managementApi}
          authApi={authApi}
          sessionToken={sessionToken}
          groups={groups}
          selectedLineGroupId={selectedGroup.lineGroupId}
          onChooseGroup={chooseGroup}
        />
      </>
    );
  }

  return (
    <main className="shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">AFTERTRACE</p>
          <h1>我的群組</h1>
        </div>
        <button className="ghost" type="button" onClick={logout}>登出</button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <section className="panel">
        {groups.length === 0 ? (
          <div className="empty">目前找不到可管理的 LINE 群組。</div>
        ) : (
          <div className="list">
            {groups.map((group) => (
              <button className="group-card" key={group.lineGroupId} type="button" onClick={() => chooseGroup(group)}>
                <strong>{group.name}</strong>
                <span>開啟記憶、能量與提醒</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
