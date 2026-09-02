import { useEffect, useMemo, useState } from 'react';
import {
  AdminApi,
  type AdminAiRuntimeConfig,
  type AdminAnomalies,
  type AdminOverview,
  type AdminPlan,
  type Row,
  type UserListFilters,
} from './api';

const SESSION_KEY = 'aftertrace.admin.session';

type Props = { api: AdminApi };
type Tab = 'overview' | 'users' | 'groups' | 'plans' | 'ai' | 'feedback' | 'anomalies' | 'audit';
type DetailState = { kind: 'USER' | 'GROUP'; value: Record<string, unknown> } | null;

export function App({ api }: Props) {
  const [sessionToken, setSessionToken] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));
  const [username, setUsername] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<Row[]>([]);
  const [groups, setGroups] = useState<Row[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [aiConfig, setAiConfig] = useState<AdminAiRuntimeConfig | null>(null);
  const [feedback, setFeedback] = useState<Row[]>([]);
  const [anomalies, setAnomalies] = useState<AdminAnomalies>({ events: [], attachments: [], normalizations: [] });
  const [audit, setAudit] = useState<Row[]>([]);
  const [detail, setDetail] = useState<DetailState>(null);
  const [userFilters, setUserFilters] = useState<UserListFilters>({ sortUpdated: 'DESC', userType: '' });
  const [groupQuery, setGroupQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.setSessionToken(sessionToken);
    if (!sessionToken) {
      setUsername(null);
      setAuthChecked(true);
      return;
    }
    let active = true;
    void api.session().then((session) => {
      if (!active) return;
      setUsername(session.username);
      setAuthChecked(true);
    }).catch(() => {
      if (!active) return;
      clearSession();
      setAuthChecked(true);
    });
    return () => { active = false; };
  }, [api, sessionToken]);

  useEffect(() => {
    if (!username) return;
    void loadCurrent();
  }, [tab, username]);

  async function login(loginUsername: string, password: string) {
    setBusy(true); setError(null);
    try {
      const session = await api.login(loginUsername, password);
      sessionStorage.setItem(SESSION_KEY, session.sessionToken);
      api.setSessionToken(session.sessionToken);
      setSessionToken(session.sessionToken);
      setUsername(session.username);
      setNotice('已登入 AFTERTRACE Worklog Admin。');
    } catch (cause) {
      setError(message(cause, '登入失敗'));
    } finally { setBusy(false); setAuthChecked(true); }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    api.setSessionToken(null);
    setSessionToken(null);
    setUsername(null);
    setDetail(null);
  }

  async function loadCurrent() {
    setBusy(true); setError(null);
    try {
      if (tab === 'overview') setOverview(await api.overview());
      if (tab === 'users') {
        const [nextUsers, nextPlans] = await Promise.all([api.users(userFilters), api.plans()]);
        setUsers(nextUsers); setPlans(nextPlans);
      }
      if (tab === 'groups') setGroups(await api.groups(groupQuery));
      if (tab === 'plans') setPlans(await api.plans());
      if (tab === 'ai') setAiConfig(await api.aiRuntime());
      if (tab === 'feedback') setFeedback(await api.feedback());
      if (tab === 'anomalies') setAnomalies(await api.anomalies());
      if (tab === 'audit') setAudit(await api.audit());
    } catch (cause) {
      const text = message(cause, '載入失敗');
      if (/ADMIN_SESSION_(?:REQUIRED|INVALID)/.test(text)) clearSession();
      setError(text);
    } finally { setBusy(false); }
  }

  async function openUser(row: Row) {
    const id = String(row.id ?? ''); if (!id) return;
    setBusy(true); setError(null);
    try {
      const [value, nextPlans] = await Promise.all([api.userDetail(id), api.plans()]);
      setPlans(nextPlans);
      setDetail({ kind: 'USER', value });
    } catch (cause) { setError(message(cause, 'User detail 載入失敗')); }
    finally { setBusy(false); }
  }

  async function openGroup(row: Row) {
    const id = String(row.id ?? ''); if (!id) return;
    setBusy(true); setError(null);
    try { setDetail({ kind: 'GROUP', value: await api.groupDetail(id) }); }
    catch (cause) { setError(message(cause, 'Group detail 載入失敗')); }
    finally { setBusy(false); }
  }

  async function updateUserPlan(userId: string, planCode: string, currentPeriodEnd: string | null) {
    if (!window.confirm(`將 User #${userId} 調整為 ${planCode}？`)) return;
    setBusy(true); setError(null);
    try {
      await api.updateUserSubscription(userId, planCode, currentPeriodEnd);
      const value = await api.userDetail(userId);
      setDetail({ kind: 'USER', value });
      setNotice(`User #${userId} 已切換至 ${planCode}。`);
      if (tab === 'users') setUsers(await api.users(userFilters));
    } catch (cause) { setError(message(cause, '方案調整失敗')); }
    finally { setBusy(false); }
  }

  async function savePlan(input: Parameters<AdminApi['savePlan']>[0]) {
    setBusy(true); setError(null);
    try {
      await api.savePlan(input);
      setPlans(await api.plans());
      setNotice(`${input.code} 已儲存。`);
    } catch (cause) { setError(message(cause, '方案儲存失敗')); }
    finally { setBusy(false); }
  }

  async function saveAi(input: Parameters<AdminApi['saveAiRuntime']>[0]) {
    setBusy(true); setError(null);
    try {
      await api.saveAiRuntime(input);
      setAiConfig(await api.aiRuntime());
      setNotice('AI runtime / pricing 已更新；只影響後續 AI 呼叫。');
    } catch (cause) { setError(message(cause, 'AI 設定更新失敗')); }
    finally { setBusy(false); }
  }

  async function updateAnomaly(row: Row, status: 'OPEN' | 'RESOLVED' | 'IGNORED') {
    const id = String(row.id ?? ''); if (!id) return;
    setBusy(true); setError(null);
    try {
      await api.updateAnomaly(id, status);
      setAnomalies(await api.anomalies());
      setNotice(`Anomaly #${id} → ${status}`);
    } catch (cause) { setError(message(cause, 'Anomaly 更新失敗')); }
    finally { setBusy(false); }
  }

  const metrics = useMemo(() => overview ? [
    ['OA Friends', overview.oaFriends],
    ['All Worklog users', overview.users],
    ['Active groups', `${overview.activeGroups} / ${overview.groups}`],
    ['All records', overview.records],
    ['Records today', overview.recordsToday],
    ['AI calls today', overview.aiCallsToday],
    ['AI cost today', `NT$ ${Number(overview.aiCostTwdToday).toFixed(4)}`],
    ['Open anomalies', overview.openAnomalies],
    ['Failed attachments', overview.failedAttachments],
    ['Failed normalization', overview.failedNormalizations],
    ['Feedback 30d', overview.feedback30d],
  ] : [], [overview]);

  if (!authChecked) return <main className="shell auth-shell"><section className="login-card"><p className="eyebrow">AFTERTRACE</p><h1>Worklog Admin</h1><p className="muted">正在確認管理員登入狀態。</p></section></main>;
  if (!username) return <LoginView busy={busy} error={error} onLogin={login} />;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>Worklog Admin</h1><p className="muted">{username} · internal operations</p></div>
      <div className="header-actions"><button disabled={busy} onClick={() => void loadCurrent()}>重新整理</button><button className="ghost" onClick={clearSession}>登出</button></div>
    </header>

    <nav className="tabs">{(['overview','users','groups','plans','ai','feedback','anomalies','audit'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setDetail(null); setNotice(null); }}>{tabLabel(item)}</button>)}</nav>
    {error && <div className="banner error">{error}</div>}{notice && <div className="banner success">{notice}</div>}

    {tab === 'overview' && <section>
      <div className="metric-grid">{metrics.map(([name,value]) => <article className="metric" key={String(name)}><span>{name}</span><strong>{String(value)}</strong></article>)}</div>
      <article className="card"><h2>目前管理範圍</h2><p className="muted">這個 Admin 已切到 Worklog domain：使用者、群組 Owner/成員用量、方案與 AI quota、AI model/pricing、Feedback、Anomaly 與 Worklog audit。舊 Memory / Energy / Reminder 資料不再是這個介面的主資料源。</p></article>
    </section>}

    {tab === 'users' && <section className="stack">
      <article className="card filter-card"><div className="filter-grid">
        <label>搜尋<input value={userFilters.query ?? ''} onChange={(event) => setUserFilters((value) => ({ ...value, query: event.target.value }))} placeholder="User id / LINE id / 暱稱" /></label>
        <label>方案<select value={userFilters.planCode ?? ''} onChange={(event) => setUserFilters((value) => ({ ...value, planCode: event.target.value }))}><option value="">全部</option>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.code} · {plan.display_name}</option>)}</select></label>
        <label>類型<select value={userFilters.userType ?? ''} onChange={(event) => setUserFilters((value) => ({ ...value, userType: event.target.value as UserListFilters['userType'] }))}><option value="">全部</option><option value="INDIVIDUAL">個人</option><option value="GROUP_ENABLED">Group Owner</option></select></label>
        <label>更新時間<select value={userFilters.sortUpdated ?? 'DESC'} onChange={(event) => setUserFilters((value) => ({ ...value, sortUpdated: event.target.value as 'ASC' | 'DESC' }))}><option value="DESC">新 → 舊</option><option value="ASC">舊 → 新</option></select></label>
      </div><button disabled={busy} onClick={() => void loadCurrent()}>套用</button></article>
      <DataTable rows={users} preferred={['id','display_name','plan_code','user_type','ai_allowance_units','ai_used_units','ai_remaining_units','text_count','audio_count','image_count','file_count','owned_group_count','last_interaction_at','updated_at']} onRow={openUser} />
    </section>}

    {tab === 'groups' && <section className="stack">
      <article className="card filter-card"><div className="search-row"><input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="Source / LINE Group / Owner" /><button disabled={busy} onClick={() => void loadCurrent()}>搜尋</button></div></article>
      <DataTable rows={groups} preferred={['id','line_group_id','status','owner_user_id','owner_display_name','owner_plan_code','owner_ai_allowance_units','owner_ai_used_units','owner_ai_remaining_units','active_members','record_count','group_ai_used_units','group_ai_cost_twd','updated_at']} onRow={openGroup} />
    </section>}

    {tab === 'plans' && <section className="stack">
      <PlanEditor key="new-plan" plan={null} busy={busy} onSave={savePlan} />
      {plans.map((plan) => <PlanEditor key={plan.code} plan={plan} busy={busy} onSave={savePlan} />)}
    </section>}

    {tab === 'ai' && <section><AiRuntimeEditor config={aiConfig} busy={busy} onSave={saveAi} /></section>}

    {tab === 'feedback' && <section><DataTable rows={feedback} preferred={['id','user_id','display_name','channel','text','context','created_at']} /></section>}

    {tab === 'anomalies' && <section className="stack">
      <article className="card"><h2>Structured anomaly events</h2><DataTable rows={anomalies.events} preferred={['id','severity','status','category','error_code','summary','user_id','source_id','line_message_id','created_at']} action={(row) => <AnomalyActions row={row} disabled={busy} onChange={updateAnomaly} />} /></article>
      <article className="card"><h2>Attachment ingestion failures</h2><DataTable rows={anomalies.attachments} preferred={['command_line_message_id','quoted_line_message_id','source_id','actor_user_id','status','last_error_code','updated_at']} /></article>
      <article className="card"><h2>TEXT normalization failures</h2><DataTable rows={anomalies.normalizations} preferred={['record_id','status','last_error_code','last_error_detail','started_at','updated_at']} /></article>
    </section>}

    {tab === 'audit' && <section><DataTable rows={audit} preferred={['id','actor_admin','actor_user_id','workspace_id','action','target_type','target_id','before_value','after_value','created_at']} /></section>}

    {detail && <DetailDrawer state={detail} plans={plans} busy={busy} onClose={() => setDetail(null)} onUpdatePlan={updateUserPlan} />}
  </main>;
}

function LoginView({ busy, error, onLogin }: { busy: boolean; error: string | null; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return <main className="shell auth-shell"><form className="login-card" onSubmit={(event) => { event.preventDefault(); void onLogin(username, password); }}>
    <p className="eyebrow">AFTERTRACE</p><h1>Worklog Admin</h1><p className="muted">使用 API Worker 上設定的管理員帳號登入。</p>
    {error && <div className="banner error">{error}</div>}
    <label>帳號<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button disabled={busy || !username.trim() || !password}>{busy ? '登入中…' : '登入'}</button>
  </form></main>;
}

function PlanEditor({ plan, busy, onSave }: { plan: AdminPlan | null; busy: boolean; onSave: (input: Parameters<AdminApi['savePlan']>[0]) => Promise<void> }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [displayName, setDisplayName] = useState(plan?.display_name ?? '');
  const [priceTwd, setPriceTwd] = useState(plan?.price_twd ?? '0');
  const [rank, setRank] = useState(String(plan?.rank ?? 0));
  const [enabled, setEnabled] = useState(plan?.enabled ?? true);
  const [allowance, setAllowance] = useState(String(plan?.ai_allowance_units ?? 0));
  const [capabilities, setCapabilities] = useState(() => JSON.stringify(plan?.capabilities ?? defaultCapabilities(), null, 2));
  async function submit() {
    let parsed: Record<string, boolean | number | string>;
    try {
      const raw = JSON.parse(capabilities) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
      parsed = raw as Record<string, boolean | number | string>;
    } catch { window.alert('Capabilities 必須是 JSON object。'); return; }
    await onSave({ code: code.trim().toUpperCase(), displayName: displayName.trim(), priceTwd: priceTwd.trim(), rank: Number(rank), enabled, aiAllowanceUnits: Number(allowance), capabilities: parsed });
  }
  return <article className="card"><div className="card-head"><div><p className="eyebrow">{plan ? 'PLAN' : 'NEW PLAN'}</p><h2>{plan?.code ?? '新增方案'}</h2></div><label className="switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enabled</label></div>
    <div className="form-grid">
      <label>Code<input value={code} disabled={Boolean(plan)} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>
      <label>顯示名稱<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>價格 TWD<input inputMode="decimal" value={priceTwd} onChange={(event) => setPriceTwd(event.target.value)} /></label>
      <label>Rank<input inputMode="numeric" value={rank} onChange={(event) => setRank(event.target.value)} /></label>
      <label>AI allowance units<input inputMode="numeric" value={allowance} onChange={(event) => setAllowance(event.target.value)} /></label>
    </div>
    <label>Capabilities JSON<textarea rows={8} value={capabilities} onChange={(event) => setCapabilities(event.target.value)} /></label>
    {code.trim().toUpperCase() === 'FREE' && <p className="muted">FREE 的 groupCollaboration 會由 API 強制設為 false。</p>}
    <button disabled={busy || !code.trim() || !displayName.trim()} onClick={() => void submit()}>儲存方案</button>
  </article>;
}

function AiRuntimeEditor({ config, busy, onSave }: { config: AdminAiRuntimeConfig | null; busy: boolean; onSave: (input: Parameters<AdminApi['saveAiRuntime']>[0]) => Promise<void> }) {
  const [provider, setProvider] = useState(config?.provider ?? 'GOOGLE');
  const [model, setModel] = useState(config?.model ?? '');
  const [inputPrice, setInputPrice] = useState(config?.input_usd_per_million ?? '0');
  const [outputPrice, setOutputPrice] = useState(config?.output_usd_per_million ?? '0');
  const [audioPrice, setAudioPrice] = useState(config?.audio_usd_per_million ?? '');
  const [imagePrice, setImagePrice] = useState(config?.image_usd_per_million ?? '');
  const [fx, setFx] = useState(config?.usd_twd_rate ?? '');
  useEffect(() => {
    setProvider(config?.provider ?? 'GOOGLE'); setModel(config?.model ?? '');
    setInputPrice(config?.input_usd_per_million ?? '0'); setOutputPrice(config?.output_usd_per_million ?? '0');
    setAudioPrice(config?.audio_usd_per_million ?? ''); setImagePrice(config?.image_usd_per_million ?? ''); setFx(config?.usd_twd_rate ?? '');
  }, [config?.updated_at]);
  return <article className="card"><p className="eyebrow">AI RUNTIME</p><h2>Provider / model / pricing</h2><p className="muted">更新只影響未來呼叫；歷史 usage event 保留執行當下的 pricing snapshot。</p>
    <div className="form-grid">
      <label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} /></label>
      <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label>Input USD / 1M<input inputMode="decimal" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} /></label>
      <label>Output USD / 1M<input inputMode="decimal" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} /></label>
      <label>Audio USD / 1M<input inputMode="decimal" value={audioPrice} onChange={(event) => setAudioPrice(event.target.value)} placeholder="optional" /></label>
      <label>Image USD / 1M<input inputMode="decimal" value={imagePrice} onChange={(event) => setImagePrice(event.target.value)} placeholder="optional" /></label>
      <label>USD → TWD<input inputMode="decimal" value={fx} onChange={(event) => setFx(event.target.value)} placeholder="optional" /></label>
    </div>
    <button disabled={busy || !provider.trim() || !model.trim()} onClick={() => void onSave({ provider: provider.trim(), model: model.trim(), inputUsdPerMillion: inputPrice.trim(), outputUsdPerMillion: outputPrice.trim(), audioUsdPerMillion: audioPrice.trim() || null, imageUsdPerMillion: imagePrice.trim() || null, usdTwdRate: fx.trim() || null })}>儲存 AI 設定</button>
    {config?.updated_at && <p className="muted">最後更新：{display(config.updated_at)}{config.updated_by ? ` · ${config.updated_by}` : ''}</p>}
  </article>;
}

function DetailDrawer({ state, plans, busy, onClose, onUpdatePlan }: { state: Exclude<DetailState, null>; plans: AdminPlan[]; busy: boolean; onClose: () => void; onUpdatePlan: (userId: string, planCode: string, end: string | null) => Promise<void> }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">{state.kind}</p><h2>Detail</h2></div><button className="ghost" onClick={onClose}>關閉</button></div>
    {state.kind === 'USER' ? <UserDetail value={state.value} plans={plans} busy={busy} onUpdatePlan={onUpdatePlan} /> : <GroupDetail value={state.value} />}
  </aside></div>;
}

function UserDetail({ value, plans, busy, onUpdatePlan }: { value: Record<string, unknown>; plans: AdminPlan[]; busy: boolean; onUpdatePlan: (userId: string, planCode: string, end: string | null) => Promise<void> }) {
  const user = asRow(value.user);
  const userId = String(user.id ?? '');
  const [planCode, setPlanCode] = useState(String(user.plan_code ?? plans[0]?.code ?? 'FREE'));
  const [periodEnd, setPeriodEnd] = useState(toLocalInput(user.current_period_end));
  useEffect(() => { setPlanCode(String(user.plan_code ?? plans[0]?.code ?? 'FREE')); setPeriodEnd(toLocalInput(user.current_period_end)); }, [user.id, user.plan_code, user.current_period_end, plans.length]);
  return <div className="stack"><article className="card"><h3>Profile / quota</h3><Detail value={user} /></article>
    <article className="card"><h3>手動方案調整</h3><div className="form-grid"><label>Plan<select value={planCode} onChange={(event) => setPlanCode(event.target.value)}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.code} · {plan.display_name}</option>)}</select></label><label>Period end<input type="datetime-local" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div><button disabled={busy || !userId || !planCode} onClick={() => void onUpdatePlan(userId, planCode, periodEnd ? new Date(periodEnd).toISOString() : null)}>套用方案</button></article>
    <DetailTable title="Owned groups" value={value.ownedGroups} preferred={['source_id','line_group_id','status','owner_binding_method','active_members','record_count','ai_used_units','updated_at']} />
    <DetailTable title="Group memberships" value={value.memberGroups} preferred={['source_id','line_group_id','status','recording_enabled','first_seen_at','last_seen_at','updated_at']} />
    <DetailTable title="Recent AI usage" value={value.aiUsage} preferred={['id','billing_relation','source_id','record_id','provider','model','ai_units_consumed','provider_cost_twd','created_at']} />
    <DetailTable title="Subscription history" value={value.subscriptionHistory} preferred={['id','previous_plan_code','next_plan_code','source','actor','metadata','created_at']} />
  </div>;
}

function GroupDetail({ value }: { value: Record<string, unknown> }) {
  return <div className="stack"><article className="card"><h3>Owner / quota / binding</h3><Detail value={value.group} /></article><DetailTable title="Members" value={value.members} preferred={['user_id','display_name','is_active','recording_enabled','ai_used_units','ai_cost_twd','text_count','audio_count','image_count','file_count','last_seen_at','updated_at']} /><DetailTable title="Recent records" value={value.recentRecords} preferred={['id','author_user_id','input_type','category','normalized_summary','raw_text','source_timestamp']} /><DetailTable title="Recent AI usage" value={value.recentUsage} preferred={['id','actor_user_id','charged_user_id','record_id','provider','model','ai_units_consumed','provider_cost_twd','created_at']} /></div>;
}

function DetailTable({ title, value, preferred }: { title: string; value: unknown; preferred: string[] }) {
  return <article className="card"><h3>{title}</h3><DataTable rows={Array.isArray(value) ? value.filter(isRow) as Row[] : []} preferred={preferred} /></article>;
}

function AnomalyActions({ row, disabled, onChange }: { row: Row; disabled: boolean; onChange: (row: Row, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => Promise<void> }) {
  return <div className="row-actions"><button disabled={disabled} onClick={() => void onChange(row, 'OPEN')}>Open</button><button disabled={disabled} onClick={() => void onChange(row, 'RESOLVED')}>Resolve</button><button className="ghost" disabled={disabled} onClick={() => void onChange(row, 'IGNORED')}>Ignore</button></div>;
}

function DataTable({ rows, preferred, onRow, action }: { rows: Row[]; preferred: string[]; onRow?: (row: Row) => void; action?: (row: Row) => React.ReactNode }) {
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;
  const columns = preferred.filter((column) => rows.some((row) => column in row));
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}{action && <th>Action</th>}</tr></thead><tbody>{rows.map((row,index) => <tr key={`${String(row.id ?? row.source_id ?? row.command_line_message_id ?? index)}-${index}`} className={onRow ? 'clickable' : ''} onClick={() => onRow?.(row)}>{columns.map((column) => <td key={column}>{display(row[column])}</td>)}{action && <td onClick={(event) => event.stopPropagation()}>{action(row)}</td>}</tr>)}</tbody></table></div>;
}

function Detail({ value }: { value: unknown }): React.ReactNode {
  if (Array.isArray(value)) return <div className="detail-list">{value.map((item,index) => <Detail key={index} value={item} />)}</div>;
  if (value && typeof value === 'object') return <div className="detail-object">{Object.entries(value as Record<string,unknown>).map(([key,item]) => <div className="detail-row" key={key}><strong>{humanize(key)}</strong>{item && typeof item === 'object' ? <Detail value={item} /> : <span>{display(item)}</span>}</div>)}</div>;
  return <span>{display(value)}</span>;
}

function defaultCapabilities(): Record<string, boolean | number | string> {
  return { privateOaRecording: true, groupCollaboration: false, maxGroupCount: 0, aiTextRecording: true, aiMediaIngestion: true, pwaEditing: true, export: false };
}

function isRow(value: unknown): value is Row { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function asRow(value: unknown): Row { return isRow(value) ? value : {}; }
function message(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
function humanize(value: string) { return value.replaceAll('_', ' '); }
function display(value: unknown): string { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'object') { const text = JSON.stringify(value); return text.length > 160 ? `${text.slice(0,157)}…` : text; } const text = String(value); if (/^\d{4}-\d{2}-\d{2}T/.test(text)) { const date = new Date(text); if (!Number.isNaN(date.getTime())) return date.toLocaleString('zh-TW'); } return text.length > 160 ? `${text.slice(0,157)}…` : text; }
function toLocalInput(value: unknown): string { if (!value) return ''; const date = new Date(String(value)); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0,16); }
function tabLabel(tab: Tab): string { return ({ overview:'Overview', users:'Users', groups:'Groups', plans:'Plans', ai:'AI Pricing', feedback:'Feedback', anomalies:'Anomalies', audit:'Audit' })[tab]; }
