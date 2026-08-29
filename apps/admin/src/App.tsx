import { useEffect, useMemo, useState } from 'react';
import type { AdminOverview, AdminSetting, Row } from './api';
import { AdminApi } from './api';

type Props = { api: AdminApi };
type Tab = 'overview' | 'users' | 'groups' | 'failures' | 'settings' | 'audit';
type Failures = { memory: Row[]; chat: Row[]; proactive: Row[] };

export function App({ api }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<Row[]>([]);
  const [groups, setGroups] = useState<Row[]>([]);
  const [failures, setFailures] = useState<Failures>({ memory: [], chat: [], proactive: [] });
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadCurrent() {
    setBusy(true); setError(null);
    try {
      if (tab === 'overview') setOverview(await api.overview());
      if (tab === 'users') setUsers(await api.users(query));
      if (tab === 'groups') setGroups(await api.groups(query));
      if (tab === 'failures') setFailures(await api.failures());
      if (tab === 'settings') setSettings(await api.settings());
      if (tab === 'audit') setAudit(await api.audit());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '載入失敗'); }
    finally { setBusy(false); }
  }

  useEffect(() => { void loadCurrent(); }, [tab]);

  async function openUser(row: Row) { await openDetail(row, (id) => api.userDetail(id), 'User detail 載入失敗'); }
  async function openGroup(row: Row) { await openDetail(row, (id) => api.groupDetail(id), 'Group detail 載入失敗'); }
  async function openDetail(row: Row, loader: (id: string) => Promise<Record<string, unknown>>, fallback: string) {
    const id = String(row.id ?? ''); if (!id) return; setBusy(true);
    try { setSelected(await loader(id)); } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); } finally { setBusy(false); }
  }
  async function retryMemory(row: Row) {
    const id = String(row.id ?? ''); if (!id || !window.confirm(`重新排入 Memory request #${id}？`)) return;
    setBusy(true); try { await api.retryMemoryRequest(id); setNotice(`Memory request #${id} 已重新排入。`); setFailures(await api.failures()); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Retry 失敗'); } finally { setBusy(false); }
  }
  async function cancelProactive(row: Row) {
    const id = String(row.id ?? ''); if (!id || !window.confirm(`取消 Proactive #${id}？`)) return;
    setBusy(true); try { await api.cancelProactive(id); setNotice(`Proactive #${id} 已取消。`); setFailures(await api.failures()); } catch (cause) { setError(cause instanceof Error ? cause.message : '取消失敗'); } finally { setBusy(false); }
  }
  async function saveSetting(setting: AdminSetting, value: string) {
    if (!window.confirm(`更新 ${setting.label}？\n${setting.value ?? '未設定'} → ${value}`)) return;
    setBusy(true); setError(null);
    try { await api.updateSetting(setting.key, value); setNotice(`${setting.label} 已更新，後續請求立即使用新值。`); setSettings(await api.settings()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '設定更新失敗'); }
    finally { setBusy(false); }
  }

  const metrics = useMemo(() => overview ? [
    ['Users', overview.users], ['Groups', `${overview.activeGroups} / ${overview.groups}`], ['AI calls today', overview.aiCallsToday],
    ['AI cost today', `NT$ ${Number(overview.aiCostTwdToday).toFixed(4)}`], ['Subsidy units today', overview.platformSubsidyUnitsToday],
    ['Failed memory', overview.failedMemoryRequests], ['Failed chat', overview.failedChats], ['Reminders', overview.scheduledReminders], ['Proactive', overview.scheduledProactive],
  ] : [], [overview]);

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>Internal Admin</h1><p className="muted">Cloudflare Access protected · operational console</p></div><button disabled={busy} onClick={() => void loadCurrent()}>重新整理</button></header>
    <nav className="tabs">{(['overview','users','groups','failures','settings','audit'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setSelected(null); }}>{label(item)}</button>)}</nav>
    {error && <div className="banner error">{error}</div>}{notice && <div className="banner success">{notice}</div>}

    {tab === 'overview' && <section><div className="metric-grid">{metrics.map(([name,value]) => <article className="metric" key={String(name)}><span>{name}</span><strong>{String(value)}</strong></article>)}</div><article className="card"><h2>使用方式</h2><p>Settings 管理 AI、Energy、商品價格與安全預算；Infrastructure secrets 仍只存在 Cloudflare。</p></article></section>}
    {(tab === 'users' || tab === 'groups') && <section><div className="search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'users' ? 'User id / LINE user id' : 'Group id / LINE group id'} /><button disabled={busy} onClick={() => void loadCurrent()}>搜尋</button></div><DataTable rows={tab === 'users' ? users : groups} preferred={tab === 'users' ? ['id','line_user_id','usable_units','reserved_units','subscription_status','active_group_count','updated_at'] : ['id','line_group_id','status','active_members','active_memories','pending_message_count','updated_at']} onRow={tab === 'users' ? openUser : openGroup} /></section>}
    {tab === 'failures' && <section className="stack"><FailureSection title="Memory requests" rows={failures.memory} onAction={retryMemory} actionLabel="Retry" /><FailureSection title="Explicit AI chat" rows={failures.chat} /><FailureSection title="Proactive" rows={failures.proactive} onAction={cancelProactive} actionLabel="Cancel" /></section>}
    {tab === 'settings' && <SettingsPanel settings={settings} busy={busy} onSave={saveSetting} />}
    {tab === 'audit' && <section><DataTable rows={audit} preferred={['id','group_id','actor_line_user_id','action','target_type','target_id','created_at']} /></section>}
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><h2>Detail</h2><button className="ghost" onClick={() => setSelected(null)}>關閉</button></div><Detail value={selected} /></aside></div>}
  </main>;
}

function SettingsPanel({ settings, busy, onSave }: { settings: AdminSetting[]; busy: boolean; onSave: (setting: AdminSetting, value: string) => Promise<void> }) {
  const sections = [...new Set(settings.map((item) => item.section))];
  return <section className="stack">{sections.map((section) => <article className="card" key={section}><h2>{section}</h2><div className="detail-list">{settings.filter((item) => item.section === section).map((item) => <SettingRow key={item.key} setting={item} busy={busy} onSave={onSave} />)}</div></article>)}</section>;
}
function SettingRow({ setting, busy, onSave }: { setting: AdminSetting; busy: boolean; onSave: (setting: AdminSetting, value: string) => Promise<void> }) {
  const [value, setValue] = useState(setting.value ?? '');
  useEffect(() => setValue(setting.value ?? ''), [setting.value]);
  const changed = value.trim() !== (setting.value ?? '');
  return <div className="detail-row"><div><strong>{setting.label}</strong><div className="muted">{setting.key} · {setting.source}{setting.updatedBy ? ` · ${setting.updatedBy}` : ''}</div></div><div className="search-row"><input value={value} onChange={(event) => setValue(event.target.value)} inputMode={setting.kind === 'text' ? undefined : 'decimal'} /><button disabled={busy || !changed || !value.trim()} onClick={() => void onSave(setting, value.trim())}>儲存</button></div></div>;
}
function FailureSection(props: { title: string; rows: Row[]; onAction?: (row: Row) => void; actionLabel?: string }) { return <article className="card"><h2>{props.title}</h2><DataTable rows={props.rows} preferred={['id','group_id','user_id','origin','last_error_code','attempt_count','updated_at']} onAction={props.onAction} actionLabel={props.actionLabel} /></article>; }
function DataTable(props: { rows: Row[]; preferred: string[]; onRow?: (row: Row) => void; onAction?: (row: Row) => void; actionLabel?: string }) {
  const columns = props.preferred.filter((column) => props.rows.some((row) => column in row)); if (props.rows.length === 0) return <p className="empty">沒有資料。</p>;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}{props.onAction && <th />}</tr></thead><tbody>{props.rows.map((row,index) => <tr key={`${String(row.id ?? index)}-${index}`} className={props.onRow ? 'clickable' : ''} onClick={() => props.onRow?.(row)}>{columns.map((column) => <td key={column}>{display(row[column])}</td>)}{props.onAction && <td><button onClick={(event) => { event.stopPropagation(); props.onAction?.(row); }}>{props.actionLabel}</button></td>}</tr>)}</tbody></table></div>;
}
function Detail({ value }: { value: unknown }) { if (Array.isArray(value)) return <div className="detail-list">{value.map((item,index) => <Detail key={index} value={item} />)}</div>; if (value && typeof value === 'object') return <div className="detail-object">{Object.entries(value as Record<string,unknown>).map(([key,item]) => <div className="detail-row" key={key}><strong>{key}</strong>{item && typeof item === 'object' ? <Detail value={item} /> : <span>{display(item)}</span>}</div>)}</div>; return <span>{display(value)}</span>; }
function display(value: unknown): string { if (value === null || value === undefined) return '—'; if (typeof value === 'object') return JSON.stringify(value); const text = String(value); if (/^\d{4}-\d{2}-\d{2}T/.test(text)) { const date = new Date(text); if (!Number.isNaN(date.getTime())) return date.toLocaleString(); } return text.length > 120 ? `${text.slice(0,117)}…` : text; }
function label(tab: Tab): string { return ({ overview:'Overview', users:'Users', groups:'Groups', failures:'Failures', settings:'Settings', audit:'Audit' })[tab]; }
