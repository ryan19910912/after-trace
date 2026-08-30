import { useEffect, useMemo, useRef, useState } from 'react';
import { App } from './App';
import { ManagementApi, type ManagedGroup, WebAuthApi } from './api';

const SESSION_KEY = 'aftertrace.web.session';
const LAST_GROUP_KEY = 'aftertrace.web.lastGroup';

type Props = {
  apiBaseUrl: string;
};

type SelectedGroup = {
  lineGroupId: string;
  groupContextToken: string;
};

export function WebRoot({ apiBaseUrl }: Props) {
  const authApi = useMemo(() => new WebAuthApi(apiBaseUrl), [apiBaseUrl]);
  const bootstrapStarted = useRef(false);
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
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
        setSessionToken(callbackSession);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
        await loadGroups(callbackSession);
        return;
      }

      const url = new URL(window.location.href);
      const entryToken = url.searchParams.get('t')?.trim();
      if (entryToken) {
        const exchanged = await authApi.exchangeEntry(entryToken);
        localStorage.setItem(SESSION_KEY, exchanged.sessionToken);
        localStorage.setItem(LAST_GROUP_KEY, exchanged.lineGroupId);
        setSessionToken(exchanged.sessionToken);
        const nextGroups = await authApi.groups(exchanged.sessionToken);
        setGroups(nextGroups);
        const current = nextGroups.find((group) => group.lineGroupId === exchanged.lineGroupId);
        setSelectedGroup({
          lineGroupId: exchanged.lineGroupId,
          groupContextToken: current?.groupContextToken ?? exchanged.groupContextToken,
        });
        url.searchParams.delete('t');
        url.searchParams.delete('openExternalBrowser');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
        return;
      }

      const existing = localStorage.getItem(SESSION_KEY);
      if (existing) await loadGroups(existing);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '登入初始化失敗';
      if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED|INVALID_USER_TOKEN/.test(message)) {
        localStorage.removeItem(SESSION_KEY);
        setSessionToken(null);
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
    localStorage.setItem(LAST_GROUP_KEY, group.lineGroupId);
    setSelectedGroup({
      lineGroupId: group.lineGroupId,
      groupContextToken: group.groupContextToken,
    });
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_GROUP_KEY);
    setSessionToken(null);
    setSelectedGroup(null);
    setGroups([]);
  }

  if (loading) {
    return (
      <main className="shell fatal-shell">
        <section className="fatal-card">
          <p className="eyebrow">AFTERTRACE</p>
          <h1>正在開啟管理中心</h1>
          <p className="muted">正在確認登入狀態與群組資訊。</p>
        </section>
      </main>
    );
  }

  if (!sessionToken) {
    return (
      <main className="shell fatal-shell">
        <section className="fatal-card">
          <p className="eyebrow">AFTERTRACE</p>
          <h1>群組管理中心</h1>
          <p>使用 LINE 登入後，就能查看你加入且 AFTERTRACE 仍在群組內的群組。</p>
          {error ? <div className="error">{error}</div> : null}
          <button type="button" onClick={() => { window.location.href = authApi.lineLoginUrl(); }}>
            使用 LINE 登入
          </button>
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
