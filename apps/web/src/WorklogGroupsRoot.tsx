import { useEffect, useMemo, useState } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type CreatedNativeGroupInvite, type NativeGroupRole, type WorklogSurfaces } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';

type SharedInvite = CreatedNativeGroupInvite & { groupName: string; revoked: boolean };

export function WorklogGroupsRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const [session] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [groupName, setGroupName] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [sharedInvite, setSharedInvite] = useState<SharedInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    void bootstrap(session);
  }, [session]);

  async function bootstrap(token: string) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(window.location.href);
      const invite = normalizeInviteToken(url.searchParams.get('invite') ?? '');
      if (invite) {
        const joined = await api.joinGroup(token, invite);
        setNotice(joined.status === 'ALREADY_MEMBER' ? `你已經在「${joined.group.name}」群組中。` : `已加入「${joined.group.name}」。`);
        url.searchParams.delete('invite');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      }
      await reloadSurfaces(token);
    } catch (cause) {
      setError(message(cause, '群組載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function reloadSurfaces(token = session) {
    if (!token) return;
    setSurfaces(await api.surfaces(token));
  }

  async function createGroup() {
    if (!session || !groupName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const group = await api.createGroup(session, groupName.trim());
      setGroupName('');
      await reloadSurfaces(session);
      setNotice(`已建立「${group.name}」。`);
    } catch (cause) {
      setError(message(cause, '建立群組失敗'));
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
      setJoinToken('');
      await reloadSurfaces(session);
      setNotice(joined.status === 'ALREADY_MEMBER' ? `你已經在「${joined.group.name}」群組中。` : `已加入「${joined.group.name}」。`);
    } catch (cause) {
      setError(message(cause, '加入群組失敗'));
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

  function openGroup(sourceId: number) {
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify({ type: 'GROUP', sourceId }));
    window.location.href = '/';
  }

  if (!session) {
    return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>群組</h1><p className="muted">登入後即可建立、加入與管理工作群組。</p><LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/worklog" /></section></main>;
  }

  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>群組</h1><p className="muted">建立工作群組，和同事共用同一個紀錄空間。</p></div></div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <nav className="worklog-main-tabs">
      <button onClick={() => { window.location.href = '/'; }}>紀錄</button>
      <button className="active">群組</button>
      <button onClick={() => { window.location.href = '/feedback'; }}>回饋</button>
    </nav>

    <div className="stack">
      <section className="panel stack">
        <div><p className="eyebrow">建立</p><h2>建立群組</h2></div>
        <p className="muted">建立群組後，就能和同事一起新增與查看群組紀錄。</p>
        <div className="filter-actions"><input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={255} placeholder="例如：晴空案團隊" /><button disabled={loading || !groupName.trim()} onClick={() => void createGroup()}>建立群組</button></div>
      </section>

      <section className="panel stack">
        <div><p className="eyebrow">加入</p><h2>加入群組</h2></div>
        <p className="muted">有同事傳邀請連結或邀請碼給你時，貼在這裡即可加入。</p>
        <div className="filter-actions"><input value={joinToken} onChange={(event) => setJoinToken(event.target.value)} placeholder="邀請連結或邀請碼" /><button disabled={loading || !normalizeInviteToken(joinToken)} onClick={() => void joinGroup()}>加入</button></div>
      </section>

      {sharedInvite ? <section className="panel stack">
        <div><p className="eyebrow">邀請同事</p><h2>{sharedInvite.groupName} 邀請</h2></div>
        <p className="muted">這是一次性邀請連結。離開這個畫面後，不會再次顯示同一組邀請碼。</p>
        <input readOnly value={inviteShareUrl(sharedInvite.inviteToken)} />
        <div className="filter-actions"><button className="ghost" disabled={sharedInvite.revoked} onClick={() => void copyText(inviteShareUrl(sharedInvite.inviteToken))}>複製邀請連結</button><button className="ghost" disabled={loading || sharedInvite.revoked} onClick={() => void revokeInvite()}>{sharedInvite.revoked ? '已撤銷' : '撤銷邀請'}</button></div>
      </section> : null}

      <section className="panel stack">
        <div><p className="eyebrow">我的群組</p><h2>工作群組</h2></div>
        {loading && !surfaces ? <div className="empty">載入中…</div> : null}
        {surfaces?.groups.length ? surfaces.groups.map((group) => <article className="worklog-record-card" key={group.sourceId}>
          <div className="worklog-record-meta"><strong>{group.name}</strong><span>{group.role === 'OWNER' ? '擁有者' : '成員'}</span></div>
          <div className="filter-actions"><button onClick={() => openGroup(group.sourceId)}>查看紀錄</button>{group.role === 'OWNER' ? <button className="ghost" disabled={loading} onClick={() => void createInvite(group)}>邀請同事</button> : null}</div>
        </article>) : !loading ? <div className="empty group-empty"><strong>還沒有工作群組</strong><span>有需要一起記錄的同事時，再建立群組即可。</span></div> : null}
      </section>
    </div>
  </main>;
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
  url.pathname = '/worklog';
  url.searchParams.set('invite', token);
  return url.toString();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  window.prompt('複製邀請連結', value);
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
