import { useEffect, useMemo, useState } from 'react';
import type { Capabilities, ManagedMemory, ManagedReminder, Overview } from './api';
import { ManagementApi } from './api';

type Props = { api: ManagementApi };
type Tab = 'memories' | 'energy' | 'reminders';

function bucketLabel(bucket: 'WELCOME' | 'AD' | 'PAID') {
  if (bucket === 'WELCOME') return 'Welcome';
  if (bucket === 'AD') return 'Reward';
  return 'Paid';
}

function stateLabel(state: { hasAvailable: boolean; hasReserved: boolean }) {
  if (state.hasAvailable && state.hasReserved) return '可用，且有保留額度';
  if (state.hasAvailable) return '有可用額度';
  if (state.hasReserved) return '目前全數保留中';
  return '目前沒有可用額度';
}

export function App({ api }: Props) {
  const [tab, setTab] = useState<Tab>('memories');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [memories, setMemories] = useState<ManagedMemory[]>([]);
  const [reminders, setReminders] = useState<ManagedReminder[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedMemory | null>(null);
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderAt, setReminderAt] = useState('');

  const activeReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status === 'SCHEDULED' || reminder.status === 'DISPATCHING'),
    [reminders],
  );

  async function reload() {
    setBusy(true);
    setError(null);
    try {
      const [overviewResult, memoryResult, reminderResult] = await Promise.all([
        api.overview(),
        api.memories(query),
        api.reminders(),
      ]);
      setOverview(overviewResult.overview);
      setCapabilities(overviewResult.capabilities);
      setMemories(memoryResult);
      setReminders(reminderResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '載入失敗');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setMemories(await api.memories(query));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '搜尋失敗');
    } finally {
      setBusy(false);
    }
  }

  async function saveMemory() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMemory(editing.id, {
        category: editing.category,
        subject: editing.subject,
        content: editing.content,
      });
      setEditing(null);
      setMemories(await api.memories(query));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新失敗');
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemory(memory: ManagedMemory) {
    if (!window.confirm('確定要刪除這則記憶嗎？之後若聊天再次出現相同資訊，仍可能重新建立。')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteMemory(memory.id);
      setMemories((items) => items.filter((item) => item.id !== memory.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '刪除失敗');
    } finally {
      setBusy(false);
    }
  }

  async function createReminder() {
    if (!reminderMessage.trim() || !reminderAt) return;
    setBusy(true);
    setError(null);
    try {
      await api.createReminder({
        requestKey: crypto.randomUUID(),
        message: reminderMessage.trim(),
        scheduledFor: new Date(reminderAt).toISOString(),
      });
      setReminderMessage('');
      setReminderAt('');
      setReminders(await api.reminders());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '建立提醒失敗');
    } finally {
      setBusy(false);
    }
  }

  async function cancelReminder(reminder: ManagedReminder) {
    if (!window.confirm('確定取消這個提醒嗎？已保留的 Paid 額度會釋放。')) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelReminder(reminder.id);
      setReminders(await api.reminders());
      const overviewResult = await api.overview();
      setOverview(overviewResult.overview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消提醒失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AFTERTRACE</p>
          <h1>群組記憶管理</h1>
        </div>
        <button className="ghost" disabled={busy} onClick={() => void reload()}>重新整理</button>
      </header>

      <nav className="tabs" aria-label="管理功能">
        <button className={tab === 'memories' ? 'active' : ''} onClick={() => setTab('memories')}>記憶</button>
        <button className={tab === 'energy' ? 'active' : ''} onClick={() => setTab('energy')}>Energy</button>
        <button className={tab === 'reminders' ? 'active' : ''} onClick={() => setTab('reminders')}>提醒</button>
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === 'memories' && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>群組記憶</h2>
              <p>只顯示目前有效記憶；來源資訊存在時會一併顯示。</p>
            </div>
            <div className="search-row">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋內容、分類或主題" />
              <button disabled={busy} onClick={() => void search()}>搜尋</button>
            </div>
          </div>

          <div className="list">
            {memories.map((memory) => (
              <article className="card" key={memory.id}>
                <div className="card-head">
                  <span className="pill">{memory.category}</span>
                  <span className="muted">#{memory.id}</span>
                </div>
                {memory.subject && <h3>{memory.subject}</h3>}
                <p className="content">{memory.content}</p>
                <div className="source">
                  <strong>來源</strong>
                  <span>{memory.sourceLineTimestamp ? new Date(memory.sourceLineTimestamp).toLocaleString() : '時間未知'}</span>
                  <span>{memory.sourceMessageId ? `LINE message ${memory.sourceMessageId}` : '無 message id'}</span>
                </div>
                <div className="actions">
                  <button className="ghost" onClick={() => setEditing({ ...memory })}>編輯</button>
                  <button className="danger" onClick={() => void deleteMemory(memory)}>刪除</button>
                </div>
              </article>
            ))}
            {!busy && memories.length === 0 && <p className="empty">目前沒有符合條件的記憶。</p>}
          </div>
        </section>
      )}

      {tab === 'energy' && overview && capabilities && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Energy / Credit 狀態</h2>
              <p>V1 尚未定義對外 Energy 換算，因此不顯示 Gemini/TWD 內部成本。</p>
            </div>
          </div>
          <div className="metric-grid">
            {(['WELCOME', 'AD', 'PAID'] as const).map((bucket) => (
              <article className="metric" key={bucket}>
                <span>{bucketLabel(bucket)}</span>
                <strong>{stateLabel(overview.buckets[bucket])}</strong>
              </article>
            ))}
            <article className="metric">
              <span>AI 使用次數</span>
              <strong>{overview.aiUsageCount}</strong>
            </article>
          </div>
          <article className="card">
            <h3>Rewarded Ad</h3>
            <p>今日已取得 {overview.rewardedAd.grantCountToday} / {capabilities.rewardedAdDailyLimit} 次獎勵。</p>
            <button disabled title="尚未定義可驗證的 Web rewarded-ad provider">
              看廣告取得 Energy
            </button>
            <p className="muted">目前只開放安全的 policy/status 顯示；尚未選定可驗證的 Web 廣告供應商前，不會讓前端自行偽造 reward event。</p>
          </article>
        </section>
      )}

      {tab === 'reminders' && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Paid Reminder</h2>
              <p>提醒只使用 Paid 額度；成功送達才真正 consume，取消會 release。</p>
            </div>
          </div>

          <article className="card form-card">
            <h3>建立提醒</h3>
            <textarea value={reminderMessage} onChange={(event) => setReminderMessage(event.target.value)} placeholder="提醒內容" />
            <input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} />
            <button
              disabled={busy || !capabilities?.reminderCreationEnabled || !reminderMessage.trim() || !reminderAt}
              onClick={() => void createReminder()}
            >
              建立提醒
            </button>
            {!capabilities?.reminderCreationEnabled && (
              <p className="muted">部署端尚未設定 Reminder reservation price，因此建立功能安全停用；既有提醒仍可查看與取消。</p>
            )}
          </article>

          <div className="list">
            {reminders.map((reminder) => (
              <article className="card" key={reminder.id}>
                <div className="card-head">
                  <span className="pill">{reminder.status}</span>
                  <span className="muted">{new Date(reminder.scheduledFor).toLocaleString()}</span>
                </div>
                <p className="content">{reminder.message}</p>
                {reminder.status === 'SCHEDULED' && (
                  <button className="danger" onClick={() => void cancelReminder(reminder)}>取消提醒</button>
                )}
                {reminder.status === 'DISPATCHING' && (
                  <p className="muted">正在進入 LINE delivery 邊界，為避免重複送達，此時不能由一般 UI 取消。</p>
                )}
              </article>
            ))}
            {!busy && activeReminders.length === 0 && reminders.length === 0 && <p className="empty">目前沒有提醒。</p>}
          </div>
        </section>
      )}

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="編輯記憶">
            <h2>編輯記憶</h2>
            <label>分類<input value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} /></label>
            <label>主題<input value={editing.subject ?? ''} onChange={(event) => setEditing({ ...editing, subject: event.target.value || null })} /></label>
            <label>內容<textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></label>
            <div className="actions">
              <button className="ghost" onClick={() => setEditing(null)}>取消</button>
              <button disabled={busy} onClick={() => void saveMemory()}>儲存</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
