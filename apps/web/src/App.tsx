import { useEffect, useMemo, useState } from 'react';
import type {
  CheckoutProductCode,
  CrossGroupMemory,
  EnergyBucket,
  EnergyCatalogResponse,
  ManagedGroup,
  ManagedMemory,
  ManagedReminder,
  PrivateEnergyOverview,
} from './api';
import { ManagementApi, WebAuthApi } from './api';
import { runGoogleRewardedAd } from './rewarded-ad';

type Props = {
  api: ManagementApi;
  authApi: WebAuthApi;
  sessionToken: string;
  groups: ManagedGroup[];
  selectedLineGroupId: string;
  onChooseGroup: (group: ManagedGroup) => void;
};
type Tab = 'memories' | 'energy' | 'reminders';

const buckets: EnergyBucket[] = ['FREE', 'SUBSCRIPTION', 'AD', 'PAID'];
const bucketLabels: Record<EnergyBucket, string> = {
  FREE: '免費能量',
  SUBSCRIPTION: '訂閱能量',
  AD: '廣告能量',
  PAID: '購買能量',
};

const reminderStatusLabels: Record<ManagedReminder['status'], string> = {
  SCHEDULED: '等待提醒',
  DISPATCHING: '傳送中',
  CANCELLED: '已取消',
  DELIVERED: '已送達',
};

const packLabels: Record<'SMALL' | 'MEDIUM' | 'LARGE', string> = {
  SMALL: '小份能量包',
  MEDIUM: '中份能量包',
  LARGE: '大份能量包',
};

function units(value: string) {
  return BigInt(value).toLocaleString();
}

function expiryLabel(value: string | null) {
  return value ? new Date(value).toLocaleString() : '不過期';
}

function priceLabel(value: string | null) {
  return value ? `新台幣 ${value} 元` : '價格尚未設定';
}

function subscriptionStatusLabel(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === 'ACTIVE') return '有效';
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return '已取消';
  if (normalized === 'PAST_DUE') return '付款逾期';
  if (normalized === 'EXPIRED') return '已到期';
  if (normalized === 'TRIALING') return '試用中';
  return '狀態更新中';
}

export function App({ api, authApi, sessionToken, groups, selectedLineGroupId, onChooseGroup }: Props) {
  const [tab, setTab] = useState<Tab>('memories');
  const [energy, setEnergy] = useState<PrivateEnergyOverview | null>(null);
  const [catalog, setCatalog] = useState<EnergyCatalogResponse | null>(null);
  const [memories, setMemories] = useState<ManagedMemory[]>([]);
  const [globalMemories, setGlobalMemories] = useState<CrossGroupMemory[]>([]);
  const [reminders, setReminders] = useState<ManagedReminder[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedMemory | null>(null);
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderAt, setReminderAt] = useState('');

  const activeReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status === 'SCHEDULED' || reminder.status === 'DISPATCHING'),
    [reminders],
  );

  const memoriesByGroup = useMemo(() => {
    const map = new Map<string, CrossGroupMemory[]>();
    for (const memory of globalMemories) {
      const items = map.get(memory.lineGroupId) ?? [];
      items.push(memory);
      map.set(memory.lineGroupId, items);
    }
    return map;
  }, [globalMemories]);

  async function reload() {
    setBusy(true);
    setError(null);
    try {
      const [energyResult, catalogResult, memoryResult, globalMemoryResult, reminderResult] = await Promise.all([
        api.energy(),
        api.catalog(),
        api.memories(),
        authApi.memories(sessionToken),
        api.reminders(),
      ]);
      setEnergy(energyResult);
      setCatalog(catalogResult);
      setMemories(memoryResult);
      setGlobalMemories(globalMemoryResult);
      setReminders(reminderResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '載入失敗');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [selectedLineGroupId]);

  async function refreshEnergy() {
    const [nextEnergy, nextCatalog] = await Promise.all([api.energy(), api.catalog()]);
    setEnergy(nextEnergy);
    setCatalog(nextCatalog);
  }

  async function watchRewardedAd() {
    if (!catalog?.rewardedAd.enabled) return;
    setAdBusy(true);
    setError(null);
    setNotice(null);
    try {
      const issued = await api.rewardedAdNonce();
      const completed = await runGoogleRewardedAd(issued);
      const claim = await api.claimRewardedAd(issued.nonce, completed.providerEventId);
      await refreshEnergy();
      setNotice(`已取得 ${units(claim.units)} 點能量，有效期限 7 天。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '獎勵廣告處理失敗');
    } finally {
      setAdBusy(false);
    }
  }

  async function beginCheckout(productCode: CheckoutProductCode) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const checkout = await api.checkout(productCode);
      window.location.assign(checkout.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法建立付款頁面');
      setBusy(false);
    }
  }

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setGlobalMemories(await authApi.memories(sessionToken, query));
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
      const [local, global] = await Promise.all([api.memories(), authApi.memories(sessionToken, query)]);
      setMemories(local);
      setGlobalMemories(global);
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
      setGlobalMemories((items) => items.filter((item) => !(item.lineGroupId === selectedLineGroupId && item.id === memory.id)));
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
      await refreshEnergy();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '建立提醒失敗');
    } finally {
      setBusy(false);
    }
  }

  async function cancelReminder(reminder: ManagedReminder) {
    if (!window.confirm('確定取消這個提醒嗎？建立提醒時已預扣的能量會退回原本的訂閱能量或購買能量。')) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelReminder(reminder.id);
      setReminders(await api.reminders());
      await refreshEnergy();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消提醒失敗');
    } finally {
      setBusy(false);
    }
  }

  function switchToMemoryGroup(memory: CrossGroupMemory) {
    const group = groups.find((item) => item.lineGroupId === memory.lineGroupId);
    if (group) onChooseGroup(group);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">群組記憶助手</p>
          <h1>記憶與能量</h1>
        </div>
        <button className="ghost" disabled={busy || adBusy} onClick={() => void reload()}>重新整理</button>
      </header>

      <nav className="tabs" aria-label="管理功能">
        <button className={tab === 'memories' ? 'active' : ''} onClick={() => setTab('memories')}>記憶</button>
        <button className={tab === 'energy' ? 'active' : ''} onClick={() => setTab('energy')}>能量</button>
        <button className={tab === 'reminders' ? 'active' : ''} onClick={() => setTab('reminders')}>提醒</button>
      </nav>

      {error && <div className="error">{error}</div>}
      {notice && <div className="card"><strong>{notice}</strong></div>}

      {tab === 'memories' && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>全部群組記憶</h2>
              <p>可以搜尋你目前仍加入的所有 AFTERTRACE 群組；每則結果都會標示來自哪個群組。</p>
            </div>
            <div className="search-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void search(); }}
                placeholder="搜尋全部群組的內容、分類或主題"
              />
              <button disabled={busy} onClick={() => void search()}>搜尋</button>
            </div>
          </div>

          <div className="list">
            {globalMemories.map((memory) => {
              const isCurrentGroup = memory.lineGroupId === selectedLineGroupId;
              const editable = isCurrentGroup ? memories.find((item) => item.id === memory.id) : undefined;
              return (
                <article className="card" key={`${memory.lineGroupId}:${memory.id}`}>
                  <div className="card-head">
                    <div className="memory-tags">
                      <span className="pill group-pill">{memory.groupName}</span>
                      <span className="pill">{memory.category}</span>
                    </div>
                    <span className="muted">編號 {memory.id}</span>
                  </div>
                  {memory.subject && <h3>{memory.subject}</h3>}
                  <p className="content">{memory.content}</p>
                  <div className="source">
                    <strong>來源群組：{memory.groupName}</strong>
                    <span>{memory.sourceLineTimestamp ? new Date(memory.sourceLineTimestamp).toLocaleString() : '時間未知'}</span>
                    <span>{memory.sourceMessageId ? `訊息編號 ${memory.sourceMessageId}` : '無訊息編號'}</span>
                  </div>
                  <div className="actions">
                    {isCurrentGroup && editable ? (
                      <>
                        <button className="ghost" onClick={() => setEditing({ ...editable })}>編輯</button>
                        <button className="danger" onClick={() => void deleteMemory(editable)}>刪除</button>
                      </>
                    ) : (
                      <button className="ghost" onClick={() => switchToMemoryGroup(memory)}>切換到此群組</button>
                    )}
                  </div>
                </article>
              );
            })}
            {!busy && globalMemories.length === 0 && <p className="empty">目前沒有符合條件的記憶。</p>}
          </div>
        </section>
      )}

      {tab === 'energy' && energy && catalog && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>我的能量</h2>
              <p>這是你的私人能量帳戶，會跨所有群組共用。</p>
            </div>
          </div>

          <div className="metric-grid">
            <article className="metric">
              <span>可用能量</span>
              <strong>{units(energy.usableUnits)}</strong>
            </article>
          </div>

          {buckets.some((bucket) => BigInt(energy.buckets[bucket].usableUnits) > 0n) && (
            <div className="metric-grid">
              {buckets
                .filter((bucket) => BigInt(energy.buckets[bucket].usableUnits) > 0n)
                .map((bucket) => (
                  <article className="metric" key={bucket}>
                    <span>{bucketLabels[bucket]}</span>
                    <strong>{units(energy.buckets[bucket].usableUnits)}</strong>
                  </article>
                ))}
            </div>
          )}

          <article className="card">
            <h3>我的群組與記憶</h3>
            <p className="muted">這些是你目前仍加入、而且 AFTERTRACE 還在的群組。</p>
            <div className="group-memory-grid">
              {groups.map((group) => {
                const groupMemories = memoriesByGroup.get(group.lineGroupId) ?? [];
                return (
                  <button className="group-memory-card" key={group.lineGroupId} type="button" onClick={() => onChooseGroup(group)}>
                    <div className="card-head">
                      <strong>{group.name}</strong>
                      <span className="pill">{groupMemories.length} 則記憶</span>
                    </div>
                    {groupMemories.length === 0 ? (
                      <span className="muted">目前還沒有記憶。</span>
                    ) : (
                      <ul className="memory-preview-list">
                        {groupMemories.slice(0, 3).map((memory) => (
                          <li key={memory.id}>{memory.subject || memory.content}</li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
              {groups.length === 0 && <p className="empty">目前沒有可管理的群組。</p>}
            </div>
          </article>

          <article className="card">
            <h3>我的訂閱</h3>
            {energy.subscription ? (
              <>
                <p>{subscriptionStatusLabel(energy.subscription.status)}</p>
                <p className="muted">
                  本期至 {energy.subscription.currentPeriodEnd ? new Date(energy.subscription.currentPeriodEnd).toLocaleString() : '未知'}
                  {energy.subscription.cancelAtPeriodEnd ? '，本期結束後取消' : ''}
                </p>
              </>
            ) : (
              <p className="muted">目前沒有有效的訂閱紀錄。</p>
            )}
          </article>

          <article className="card">
            <h3>獎勵廣告</h3>
            <p>
              {catalog.rewardedAd.energyUnits
                ? `完成一則廣告可取得 ${units(catalog.rewardedAd.energyUnits)} 點能量，有效期限 7 天。`
                : '目前尚未設定廣告能量。'}
            </p>
            <button
              disabled={adBusy || !catalog.rewardedAd.enabled}
              onClick={() => void watchRewardedAd()}
            >
              {adBusy ? '廣告處理中…' : '看廣告取得能量'}
            </button>
            <p className="muted">
              每日最多 {catalog.rewardedAd.dailyLimit} 次；兩次獎勵至少間隔 {catalog.rewardedAd.cooldownMinutes} 分鐘。
            </p>
          </article>

          {catalog.catalog.subscription && (
            <article className="card">
              <h3>訂閱方案</h3>
              <p>每個計費週期發放 {units(catalog.catalog.subscription.energyUnits)} 點能量，於當期結束時過期，未使用的能量不會累積到下一期。</p>
              <p><strong>{priceLabel(catalog.catalog.subscription.priceTwd)}</strong></p>
              <button
                disabled={busy || !catalog.catalog.checkoutEnabled || !catalog.catalog.subscription.priceTwd}
                onClick={() => void beginCheckout('SUBSCRIPTION_V1')}
              >
                {catalog.catalog.checkoutEnabled ? '前往訂閱' : '付款服務尚未啟用'}
              </button>
            </article>
          )}

          <div className="list">
            {catalog.catalog.paidPacks.map((pack) => (
              <article className="card" key={pack.code}>
                <div className="card-head">
                  <span className="pill">{packLabels[pack.code]}</span>
                  <strong>{units(pack.energyUnits)} 點能量</strong>
                </div>
                <p>一次性購買，不過期，跨群組共用。</p>
                <p><strong>{priceLabel(pack.priceTwd)}</strong></p>
                <button
                  disabled={busy || !catalog.catalog.checkoutEnabled || !pack.priceTwd}
                  onClick={() => void beginCheckout(`PAID_${pack.code}` as CheckoutProductCode)}
                >
                  {catalog.catalog.checkoutEnabled ? '購買能量' : '付款服務尚未啟用'}
                </button>
              </article>
            ))}
          </div>

          <article className="card">
            <h3>能量明細</h3>
            <div className="list">
              {energy.lots
                .filter((lot) => BigInt(lot.availableUnits) > 0n)
                .map((lot) => (
                  <div className="source" key={lot.id}>
                    <strong>{bucketLabels[lot.bucket]} · {units(lot.availableUnits)}</strong>
                    <span>{expiryLabel(lot.expiresAt)}</span>
                  </div>
                ))}
              {energy.lots.every((lot) => BigInt(lot.availableUnits) === 0n) && <p className="empty">目前沒有可用能量。</p>}
            </div>
          </article>
        </section>
      )}

      {tab === 'reminders' && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>提醒</h2>
              <p>提醒屬於你本人，並會送到目前群組；每個提醒只會執行一次，建立時會先預扣所需的訂閱能量或購買能量，取消時再退回。</p>
            </div>
          </div>

          <article className="card form-card">
            <h3>建立提醒</h3>
            <textarea value={reminderMessage} onChange={(event) => setReminderMessage(event.target.value)} placeholder="提醒內容" />
            <input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} />
            <button
              disabled={busy || !energy?.proactive.enabled || !reminderMessage.trim() || !reminderAt}
              onClick={() => void createReminder()}
            >
              建立提醒
            </button>
            {!energy?.proactive.enabled && (
              <p className="muted">需要有效的訂閱能量或可用的購買能量，才能建立提醒。</p>
            )}
          </article>

          <div className="list">
            {reminders.map((reminder) => (
              <article className="card" key={reminder.id}>
                <div className="card-head">
                  <span className="pill">{reminderStatusLabels[reminder.status]}</span>
                  <span className="muted">{new Date(reminder.scheduledFor).toLocaleString()}</span>
                </div>
                <p className="content">{reminder.message}</p>
                {reminder.status === 'SCHEDULED' && (
                  <button className="danger" onClick={() => void cancelReminder(reminder)}>取消提醒</button>
                )}
                {reminder.status === 'DISPATCHING' && (
                  <p className="muted">提醒正在傳送中，為避免重複送達，此時暫時無法取消。</p>
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
