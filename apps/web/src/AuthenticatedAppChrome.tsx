import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccountNotificationApi,
  notificationCategoryLabel,
  safeNotificationHref,
  type AccountProfile,
  type NotificationCenter,
  type NotificationCenterItem,
} from './account-notification-api';
import './account-notification.css';

const SESSION_KEY = 'aftertrace.worklog.session';

type Props = {
  apiBaseUrl: string;
  children: ReactNode;
};

export function AuthenticatedAppChrome({ apiBaseUrl, children }: Props) {
  const api = useMemo(() => new AccountNotificationApi(apiBaseUrl), [apiBaseUrl]);
  const loadGeneration = useRef(0);
  const [session, setSession] = useState<string | null>(() => currentSessionToken());
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [center, setCenter] = useState<NotificationCenter | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [copyState, setCopyState] = useState<'IDLE' | 'COPIED' | 'FAILED'>('IDLE');
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [busyNotificationId, setBusyNotificationId] = useState<number | 'ALL' | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const sync = () => setSession(currentSessionToken());
    const scheduleSync = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(sync, 0);
    };
    window.addEventListener('storage', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('click', scheduleSync);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('storage', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('click', scheduleSync);
    };
  }, []);

  useEffect(() => {
    loadGeneration.current += 1;
    const generation = loadGeneration.current;
    setNotificationsOpen(false);
    setCopyState('IDLE');
    setNotificationError(null);
    if (!session) {
      setProfile(null);
      setCenter(null);
      return;
    }
    void loadAuthenticatedChrome(session, generation);
  }, [session, api]);

  async function loadAuthenticatedChrome(token: string, generation = loadGeneration.current) {
    try {
      const nextProfile = await api.profile(token);
      if (generation !== loadGeneration.current) return;
      setProfile(nextProfile);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setProfile(null);
      setNotificationError(message(cause, '帳號資料載入失敗'));
    }

    try {
      const nextCenter = await api.notifications(token);
      if (generation !== loadGeneration.current) return;
      setCenter(nextCenter);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setCenter(null);
      setNotificationError((current) => current ?? message(cause, '通知載入失敗'));
    }
  }

  async function copyAccountId() {
    if (!profile) return;
    try {
      await copyText(profile.publicAccountId);
      setCopyState('COPIED');
      window.setTimeout(() => setCopyState('IDLE'), 1800);
    } catch {
      setCopyState('FAILED');
      window.setTimeout(() => setCopyState('IDLE'), 2200);
    }
  }

  async function markRead(item: NotificationCenterItem, navigateAfter = false) {
    if (!session) return;
    const href = safeNotificationHref(item.deepLink);
    setBusyNotificationId(item.id);
    setNotificationError(null);
    try {
      let readAt = item.readAt;
      if (!readAt) readAt = await api.markNotificationRead(session, item.id);
      setCenter((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, readAt } : candidate),
        unreadCount: item.readAt ? current.unreadCount : Math.max(0, current.unreadCount - 1),
      } : current);
      if (navigateAfter && href) window.location.href = href;
    } catch (cause) {
      setNotificationError(message(cause, '通知已讀狀態更新失敗'));
    } finally {
      setBusyNotificationId(null);
    }
  }

  async function markAllRead() {
    if (!session || !center?.unreadCount) return;
    setBusyNotificationId('ALL');
    setNotificationError(null);
    try {
      await api.markAllNotificationsRead(session);
      const readAt = new Date().toISOString();
      setCenter((current) => current ? {
        ...current,
        unreadCount: 0,
        items: current.items.map((item) => item.readAt ? item : { ...item, readAt }),
      } : current);
    } catch (cause) {
      setNotificationError(message(cause, '通知已讀狀態更新失敗'));
    } finally {
      setBusyNotificationId(null);
    }
  }

  return <>
    {session ? <header className="account-chrome" aria-label="AFTERTRACE 帳號與通知">
      <div className="account-chrome-inner">
        <div className="account-chrome-actions">
          <div className="notification-anchor">
            <button
              className="notification-bell"
              aria-label={center?.unreadCount ? `通知，${center.unreadCount} 則未讀` : '通知'}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <span aria-hidden="true">🔔</span>
              {center?.unreadCount ? <span className="notification-badge">{center.unreadCount > 99 ? '99+' : center.unreadCount}</span> : null}
            </button>
            {notificationsOpen ? <NotificationCenterPanel
              center={center}
              error={notificationError}
              busyNotificationId={busyNotificationId}
              onMarkRead={(item) => void markRead(item)}
              onOpen={(item) => void markRead(item, true)}
              onMarkAll={() => void markAllRead()}
              onClose={() => setNotificationsOpen(false)}
            /> : null}
          </div>

          <div className="account-summary" aria-live="polite">
            <span className="account-display-name">{profile ? (profile.displayName ?? 'AFTERTRACE 使用者') : '帳號載入中…'}</span>
            {profile ? <button className="account-id-copy" onClick={() => void copyAccountId()} title="複製帳號 ID">
              <span>帳號 ID</span>
              <strong>{profile.publicAccountId}</strong>
              <span className="copy-feedback">{copyState === 'COPIED' ? '已複製' : copyState === 'FAILED' ? '複製失敗' : '複製'}</span>
            </button> : null}
          </div>
        </div>
      </div>
    </header> : null}
    {children}
  </>;
}

function NotificationCenterPanel({
  center,
  error,
  busyNotificationId,
  onMarkRead,
  onOpen,
  onMarkAll,
  onClose,
}: {
  center: NotificationCenter | null;
  error: string | null;
  busyNotificationId: number | 'ALL' | null;
  onMarkRead: (item: NotificationCenterItem) => void;
  onOpen: (item: NotificationCenterItem) => void;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  return <section className="notification-center" aria-label="通知中心">
    <div className="notification-center-head">
      <div><strong>通知</strong><span>{center ? `${center.unreadCount} 則未讀` : '載入中…'}</span></div>
      <div className="notification-center-head-actions">
        {center?.unreadCount ? <button className="ghost compact" disabled={busyNotificationId !== null} onClick={onMarkAll}>全部已讀</button> : null}
        <button className="ghost compact" onClick={onClose} aria-label="關閉通知中心">關閉</button>
      </div>
    </div>
    {error ? <div className="notification-inline-error">{error}</div> : null}
    {!center && !error ? <div className="notification-empty">通知載入中…</div> : null}
    {center && center.items.length === 0 ? <div className="notification-empty">目前沒有通知。</div> : null}
    {center?.items.length ? <div className="notification-list">
      {center.items.map((item) => {
        const href = safeNotificationHref(item.deepLink);
        return <article key={item.id} className={`notification-item${item.readAt ? '' : ' unread'}`}>
          <div className="notification-item-meta">
            <span>{notificationCategoryLabel(item.category)}</span>
            <time>{formatNotificationTime(item.sentAt ?? item.createdAt)}</time>
          </div>
          <strong>{item.title}</strong>
          <p>{item.body}</p>
          <div className="notification-item-actions">
            {!item.readAt ? <button className="ghost compact" disabled={busyNotificationId !== null} onClick={() => onMarkRead(item)}>標為已讀</button> : <span className="notification-read-label">已讀</span>}
            {href ? <button className="compact" disabled={busyNotificationId !== null} onClick={() => onOpen(item)}>開啟</button> : null}
          </div>
        </article>;
      })}
    </div> : null}
  </section>;
}

function currentSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return hash.get('session')?.trim() || window.localStorage.getItem(SESSION_KEY)?.trim() || null;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('COPY_FAILED');
}

function formatNotificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
