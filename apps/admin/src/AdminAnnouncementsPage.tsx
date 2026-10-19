import { useEffect, useMemo, useState } from 'react';
import type { AdminApi } from './api';
import {
  AdminAnnouncementApi,
  searchAnnouncementUsers,
  type AdminAnnouncementPreview,
  type AdminAnnouncementSummary,
  type AdminAnnouncementUserOption,
} from './announcement-api';
import {
  EMPTY_ANNOUNCEMENT_FORM,
  announcementAudienceLabel,
  announcementModeLabel,
  announcementStatusLabel,
  canCancelAnnouncement,
  canSendAnnouncement,
  toAnnouncementInput,
  type AnnouncementFormState,
} from './announcement-form';

const SESSION_KEY = 'aftertrace.admin.session';

type Props = {
  api: AdminApi;
  announcementApi: AdminAnnouncementApi;
};

export function AdminAnnouncementsPage({ api, announcementApi }: Props) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AdminAnnouncementSummary[]>([]);
  const [selected, setSelected] = useState<AdminAnnouncementSummary | null>(null);
  const [form, setForm] = useState<AnnouncementFormState>({ ...EMPTY_ANNOUNCEMENT_FORM });
  const [preview, setPreview] = useState<AdminAnnouncementPreview | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<AdminAnnouncementUserOption[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY)?.trim() || null;
    api.setSessionToken(token);
    announcementApi.setSessionToken(token);
    if (!token) {
      setLoading(false);
      setError('尚未登入管理後台。');
      return;
    }
    let active = true;
    void api.session().then((session) => {
      if (!active) return;
      setUsername(session.username);
    }).catch(() => {
      if (!active) return;
      clearAdminSession(api, announcementApi);
      setError('管理員登入已失效，請重新登入。');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, announcementApi]);

  useEffect(() => {
    if (!username) return;
    let active = true;
    setLoading(true);
    setError(null);
    void announcementApi.announcements().then((items) => {
      if (!active) return;
      setAnnouncements(items);
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      handleAdminError(cause, api, announcementApi, setUsername, setError, '公告列表載入失敗');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, announcementApi, username]);

  const previewSpecificUsers = useMemo(() => {
    if (!preview || preview.audience !== 'SPECIFIC_USERS') return [];
    const ids = new Set(preview.specificUserIds);
    return form.selectedUsers.filter((user) => ids.has(user.id));
  }, [form.selectedUsers, preview]);

  function updateForm(patch: Partial<AnnouncementFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setNotice(null);
  }

  async function reloadAnnouncements(selectId?: number) {
    const items = await announcementApi.announcements();
    setAnnouncements(items);
    if (selectId) {
      const detail = await announcementApi.announcement(selectId);
      setSelected(detail);
    } else if (selected) {
      setSelected(items.find((item) => item.id === selected.id) ?? null);
    }
  }

  async function previewAnnouncement() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input = toAnnouncementInput(form);
      setPreview(await announcementApi.preview(input));
      setNotice('預覽已產生。送出前請再次確認對象、通知方式與時間。');
    } catch (cause) {
      handleAdminError(cause, api, announcementApi, setUsername, setError, '公告預覽失敗');
    } finally {
      setBusy(false);
    }
  }

  async function createAnnouncement() {
    if (!preview) {
      setError('請先產生預覽，再建立或送出公告。');
      return;
    }
    if (preview.mode === 'SEND_NOW' && !window.confirm(
      `確定立即送出「${preview.title}」？\n對象：${announcementAudienceLabel(preview.audience)}\n通知方式：${channelLabel(preview.inAppEnabled, preview.pushEnabled)}`,
    )) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await announcementApi.create(toAnnouncementInput(form));
      await reloadAnnouncements(created.id);
      setForm({ ...EMPTY_ANNOUNCEMENT_FORM });
      setPreview(null);
      setUserQuery('');
      setUserResults([]);
      setNotice(created.status === 'SENT' ? '公告已送出。' : created.status === 'SCHEDULED' ? '公告已排程。' : '公告草稿已建立。');
    } catch (cause) {
      handleAdminError(cause, api, announcementApi, setUsername, setError, '公告建立失敗');
    } finally {
      setBusy(false);
    }
  }

  async function searchUsers() {
    const query = userQuery.trim();
    if (!query) {
      setUserResults([]);
      return;
    }
    setSearchingUsers(true);
    setError(null);
    try {
      setUserResults(await searchAnnouncementUsers(api, query));
    } catch (cause) {
      handleAdminError(cause, api, announcementApi, setUsername, setError, '指定使用者搜尋失敗');
    } finally {
      setSearchingUsers(false);
    }
  }

  function addSpecificUser(user: AdminAnnouncementUserOption) {
    if (form.selectedUsers.some((item) => item.id === user.id)) return;
    updateForm({ selectedUsers: [...form.selectedUsers, user] });
  }

  function removeSpecificUser(userId: number) {
    updateForm({ selectedUsers: form.selectedUsers.filter((user) => user.id !== userId) });
  }

  async function openAnnouncement(id: number) {
    setBusy(true);
    setError(null);
    try {
      setSelected(await announcementApi.announcement(id));
    } catch (cause) {
      handleAdminError(cause, api, announcementApi, setUsername, setError, '公告詳細資料載入失敗');
    } finally {
      setBusy(false);
    }
  }

  async function sendExisting(announcement: AdminAnnouncementSummary) {
    if (!canSendAnnouncement(announcement)) return;
    if (!window.confirm(
      `確定立即送出「${announcement.title}」？\n目前狀態：${announcementStatusLabel(announcement.status)}\n對象：${announcementAudienceLabel(announcement.audience)}`,
    )) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sent = await announcementApi.send(announcement.id);
      await reloadAnnouncements(sent.id);
      setNotice('公告已送出。');
    } catch (cause) {
      handleAdminError(cause, api, announcementApi, setUsername, setError, '公告送出失敗');
    } finally {
      setBusy(false);
    }
  }

  async function cancelExisting(announcement: AdminAnnouncementSummary) {
    if (!canCancelAnnouncement(announcement)) return;
    if (!window.confirm(`確定取消「${announcement.title}」？取消後不會自動恢復。`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const cancelled = await announcementApi.cancel(announcement.id);
      await reloadAnnouncements(cancelled.id);
      setNotice('公告已取消。');
    } catch (cause) {
      handleAdminError(cause, api, announcementApi, setUsername, setError, '公告取消失敗');
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell">
    <header className="topbar admin-hero">
      <div>
        <p className="eyebrow">AFTERTRACE ADMIN</p>
        <h1>公告通知</h1>
        <p className="muted">建立、預覽與發送公告，可用於系統通知、維護公告與重要提醒。</p>
      </div>
      <button disabled={busy || !username} onClick={() => void reloadAnnouncements()}>重新整理</button>
    </header>

    {error && <div className="banner error">{error}</div>}
    {notice && <div className="banner success">{notice}</div>}

    <section className="stack">
      <article className="card">
        <p className="eyebrow">建立公告</p>
        <h2>先預覽，再送出</h2>
        <p className="muted">填寫公告內容並選擇發送對象，送出前可先預覽，確認訊息與通知方式是否正確。</p>
        <div className="form-grid">
          <label>標題
            <input value={form.title} maxLength={255} onChange={(event) => updateForm({ title: event.target.value })} placeholder="例如：今晚系統維護" />
          </label>
          <label>對象
            <select value={form.audience} onChange={(event) => updateForm({
              audience: event.target.value as AnnouncementFormState['audience'],
              selectedUsers: event.target.value === 'SPECIFIC_USERS' ? form.selectedUsers : [],
            })}>
              <option value="ALL_USERS">全部使用者</option>
              <option value="FREE_USERS">免費方案使用者</option>
              <option value="AI_SUBSCRIBERS">訂閱方案使用者</option>
              <option value="SPECIFIC_USERS">指定使用者</option>
            </select>
          </label>
          <label>處理方式
            <select value={form.mode} onChange={(event) => updateForm({ mode: event.target.value as AnnouncementFormState['mode'] })}>
              <option value="DRAFT">儲存草稿</option>
              <option value="SEND_NOW">立即送出</option>
              <option value="SCHEDULED">排程送出</option>
            </select>
          </label>
          {form.mode === 'SCHEDULED' && <label>排程時間
            <input type="datetime-local" value={form.scheduledLocal} onChange={(event) => updateForm({ scheduledLocal: event.target.value })} />
          </label>}
          <label>站內導向（選填）
            <input value={form.deepLink} onChange={(event) => updateForm({ deepLink: event.target.value })} placeholder="例如 /records/123" />
          </label>
        </div>

        <label>公告內容
          <textarea rows={6} maxLength={10_000} value={form.body} onChange={(event) => updateForm({ body: event.target.value })} placeholder="請輸入使用者會看到的公告內容" />
        </label>

        <div className="form-grid announcement-channel-grid">
          <label className="switch"><input type="checkbox" checked={form.inAppEnabled} onChange={(event) => updateForm({ inAppEnabled: event.target.checked })} /><span><strong>站內通知</strong><small className="muted">發布到站內通知中心，指定對象登入後即可查看。</small></span></label>
          <label className="switch"><input type="checkbox" checked={form.pushEnabled} onChange={(event) => updateForm({ pushEnabled: event.target.checked })} /><span><strong>推播通知</strong><small className="muted">透過瀏覽器推播主動提醒使用者；站內通知不受推播是否成功影響。</small></span></label>
        </div>

        {form.audience === 'SPECIFIC_USERS' && <SpecificUserPicker
          query={userQuery}
          onQuery={setUserQuery}
          results={userResults}
          selected={form.selectedUsers}
          searching={searchingUsers}
          onSearch={searchUsers}
          onAdd={addSpecificUser}
          onRemove={removeSpecificUser}
        />}

        <div className="plan-actions">
          <button disabled={busy || !username} onClick={() => void previewAnnouncement()}>產生預覽</button>
          <button className="primary-action" disabled={busy || !preview} onClick={() => void createAnnouncement()}>{preview ? `確認${announcementModeLabel(preview.mode)}` : '請先預覽'}</button>
        </div>
      </article>

      {preview && <article className="card">
        <p className="eyebrow">送出前預覽</p>
        <h2>{preview.title}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</p>
        <div className="detail-object">
          <SummaryRow label="處理方式" value={announcementModeLabel(preview.mode)} />
          <SummaryRow label="對象" value={announcementAudienceLabel(preview.audience)} />
          <SummaryRow label="通知方式" value={channelLabel(preview.inAppEnabled, preview.pushEnabled)} />
          <SummaryRow label="排程時間" value={displayDate(preview.scheduledAt)} />
          <SummaryRow label="站內導向" value={preview.deepLink || '—'} />
          {preview.audience === 'SPECIFIC_USERS' && <SummaryRow label="指定帳號" value={previewSpecificUsers.map(userLabel).join('、') || preview.specificUserIds.join(', ')} />}
        </div>
      </article>}

      <article className="card">
        <div className="card-head"><div><p className="eyebrow">公告紀錄</p><h2>公告紀錄</h2><p className="muted">查看已建立或發送的公告內容、對象與發送狀態。</p></div><span className="muted">{announcements.length} 筆</span></div>
        {loading ? <p className="muted">載入中…</p> : announcements.length === 0 ? <div className="empty-state-card"><strong>目前尚無公告紀錄。</strong><p className="muted">建立第一則公告後，紀錄會顯示在這裡。</p></div> : <div className="table-wrap">
          <table><thead><tr><th>狀態</th><th>標題</th><th>對象</th><th>通知方式</th><th>排程／送出</th><th>收件者</th><th>未讀</th><th>推播成功</th><th>推播失敗</th></tr></thead><tbody>
            {announcements.map((announcement) => <tr key={announcement.id} className="clickable" onClick={() => void openAnnouncement(announcement.id)}>
              <td>{announcementStatusLabel(announcement.status)}</td>
              <td>{announcement.title}</td>
              <td>{announcementAudienceLabel(announcement.audience)}</td>
              <td>{channelLabel(announcement.inAppEnabled, announcement.pushEnabled)}</td>
              <td>{displayDate(announcement.sentAt ?? announcement.scheduledAt)}</td>
              <td>{announcement.recipientCount}</td>
              <td>{announcement.unreadCount}</td>
              <td>{announcement.pushSentCount}</td>
              <td>{announcement.pushFailedCount}</td>
            </tr>)}
          </tbody></table>
        </div>}
      </article>

      {selected && <article className="card">
        <div className="card-head"><div><p className="eyebrow">公告 #{selected.id}</p><h2>{selected.title}</h2></div><button className="ghost" onClick={() => setSelected(null)}>關閉</button></div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{selected.body}</p>
        <div className="detail-object">
          <SummaryRow label="狀態" value={announcementStatusLabel(selected.status)} />
          <SummaryRow label="對象" value={announcementAudienceLabel(selected.audience)} />
          <SummaryRow label="通知方式" value={channelLabel(selected.inAppEnabled, selected.pushEnabled)} />
          <SummaryRow label="排程時間" value={displayDate(selected.scheduledAt)} />
          <SummaryRow label="開始派送" value={displayDate(selected.dispatchStartedAt)} />
          <SummaryRow label="送出時間" value={displayDate(selected.sentAt)} />
          <SummaryRow label="取消時間" value={displayDate(selected.cancelledAt)} />
          <SummaryRow label="建立者" value={selected.createdByActor || '—'} />
          <SummaryRow label="收件者" value={String(selected.recipientCount)} />
          <SummaryRow label="未讀" value={String(selected.unreadCount)} />
          <SummaryRow label="推播成功" value={String(selected.pushSentCount)} />
          <SummaryRow label="推播失敗" value={String(selected.pushFailedCount)} />
          <SummaryRow label="站內導向" value={selected.deepLink || '—'} />
        </div>
        <div className="plan-actions">
          {canSendAnnouncement(selected) && <button disabled={busy} onClick={() => void sendExisting(selected)}>立即送出</button>}
          {canCancelAnnouncement(selected) && <button className="danger" disabled={busy} onClick={() => void cancelExisting(selected)}>取消公告</button>}
        </div>
      </article>}
    </section>
  </main>;
}

function SpecificUserPicker({
  query,
  onQuery,
  results,
  selected,
  searching,
  onSearch,
  onAdd,
  onRemove,
}: {
  query: string;
  onQuery: (value: string) => void;
  results: AdminAnnouncementUserOption[];
  selected: AdminAnnouncementUserOption[];
  searching: boolean;
  onSearch: () => Promise<void>;
  onAdd: (user: AdminAnnouncementUserOption) => void;
  onRemove: (userId: number) => void;
}) {
  return <div className="stack">
    <article className="card">
      <h3>指定使用者</h3>
      <p className="muted">可用帳號 ID 或顯示名稱查找；只有明確選取的使用者會收到公告。</p>
      <div className="search-row">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="例如 AT-7K4M2P 或顯示名稱" />
        <button disabled={searching || !query.trim()} onClick={() => void onSearch()}>{searching ? '搜尋中…' : '搜尋'}</button>
      </div>
      {results.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>帳號 ID</th><th>顯示名稱</th><th>方案</th><th>操作</th></tr></thead><tbody>
        {results.map((user) => <tr key={user.id}><td>{user.publicAccountId || `#${user.id}`}</td><td>{user.displayName}</td><td>{user.planCode || '—'}</td><td><button disabled={selected.some((item) => item.id === user.id)} onClick={() => onAdd(user)}>{selected.some((item) => item.id === user.id) ? '已加入' : '加入'}</button></td></tr>)}
      </tbody></table></div>}
    </article>
    <article className="card">
      <h3>已選取 {selected.length} 位</h3>
      {selected.length === 0 ? <p className="empty">尚未選取任何使用者；指定使用者模式需要至少選取一位使用者。</p> : <div className="table-wrap"><table><thead><tr><th>帳號 ID</th><th>顯示名稱</th><th>方案</th><th>操作</th></tr></thead><tbody>
        {selected.map((user) => <tr key={user.id}><td>{user.publicAccountId || `#${user.id}`}</td><td>{user.displayName}</td><td>{user.planCode || '—'}</td><td><button className="danger" onClick={() => onRemove(user.id)}>移除</button></td></tr>)}
      </tbody></table></div>}
    </article>
  </div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><strong>{label}</strong><span>{value}</span></div>;
}

function channelLabel(inAppEnabled: boolean, pushEnabled: boolean): string {
  const channels = [];
  if (inAppEnabled) channels.push('站內通知');
  if (pushEnabled) channels.push('推播通知');
  return channels.join(' + ') || '未選擇';
}

function userLabel(user: AdminAnnouncementUserOption): string {
  return `${user.publicAccountId || `#${user.id}`} ${user.displayName}`.trim();
}

function displayDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function clearAdminSession(api: AdminApi, announcementApi: AdminAnnouncementApi) {
  sessionStorage.removeItem(SESSION_KEY);
  api.setSessionToken(null);
  announcementApi.setSessionToken(null);
}

function handleAdminError(
  cause: unknown,
  api: AdminApi,
  announcementApi: AdminAnnouncementApi,
  setUsername: (value: string | null) => void,
  setError: (value: string | null) => void,
  fallback: string,
) {
  const text = cause instanceof Error ? cause.message : String(cause ?? fallback);
  if (/ADMIN_SESSION_(?:REQUIRED|INVALID)/.test(text)) {
    clearAdminSession(api, announcementApi);
    setUsername(null);
    setError('管理員登入已失效，請重新登入。');
    return;
  }
  setError(text || fallback);
}
