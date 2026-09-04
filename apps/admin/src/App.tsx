import { useEffect, useMemo, useState } from 'react';
import {
  AdminApi,
  type AdminAiRuntimeConfig,
  type AdminAnomalies,
  type AdminCapabilityDefinition,
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
  const [capabilityDefinitions, setCapabilityDefinitions] = useState<AdminCapabilityDefinition[]>([]);
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
      setNotice('已登入 AFTERTRACE 工作紀錄管理後台。');
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
      if (tab === 'plans') {
        const [nextPlans, definitions] = await Promise.all([api.plans(), api.capabilityDefinitions()]);
        setPlans(nextPlans);
        setCapabilityDefinitions(definitions);
      }
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
    } catch (cause) { setError(message(cause, '使用者詳細資料載入失敗')); }
    finally { setBusy(false); }
  }

  async function openGroup(row: Row) {
    const id = String(row.id ?? ''); if (!id) return;
    setBusy(true); setError(null);
    try { setDetail({ kind: 'GROUP', value: await api.groupDetail(id) }); }
    catch (cause) { setError(message(cause, '群組詳細資料載入失敗')); }
    finally { setBusy(false); }
  }

  async function updateUserPlan(userId: string, planCode: string, currentPeriodEnd: string | null) {
    if (!window.confirm(`確定要將使用者 #${userId} 調整為 ${planCode} 方案嗎？`)) return;
    setBusy(true); setError(null);
    try {
      await api.updateUserSubscription(userId, planCode, currentPeriodEnd);
      const value = await api.userDetail(userId);
      setDetail({ kind: 'USER', value });
      setNotice(`使用者 #${userId} 已切換至 ${planCode} 方案。`);
      if (tab === 'users') setUsers(await api.users(userFilters));
    } catch (cause) { setError(message(cause, '方案調整失敗')); }
    finally { setBusy(false); }
  }

  async function savePlan(input: Parameters<AdminApi['savePlan']>[0]) {
    setBusy(true); setError(null);
    try {
      await api.savePlan(input);
      setPlans(await api.plans());
      setNotice(`${input.code} 已儲存。方案模板只影響之後建立的訂閱週期 AI 點數 Grant，不會回頭修改既有 Grant。`);
    } catch (cause) { setError(message(cause, '方案儲存失敗')); }
    finally { setBusy(false); }
  }

  async function saveAi(input: Parameters<AdminApi['saveAiRuntime']>[0]) {
    setBusy(true); setError(null);
    try {
      await api.saveAiRuntime(input);
      setAiConfig(await api.aiRuntime());
      setNotice('AI 模型與計價設定已更新，只會影響之後的 AI 呼叫。');
    } catch (cause) { setError(message(cause, 'AI 設定更新失敗')); }
    finally { setBusy(false); }
  }

  async function updateAnomaly(row: Row, status: 'OPEN' | 'RESOLVED' | 'IGNORED') {
    const id = String(row.id ?? ''); if (!id) return;
    setBusy(true); setError(null);
    try {
      await api.updateAnomaly(id, status);
      setAnomalies(await api.anomalies());
      const label = status === 'OPEN' ? '待處理' : status === 'RESOLVED' ? '已解決' : '已忽略';
      setNotice(`異常 #${id} 已更新為「${label}」。`);
    } catch (cause) { setError(message(cause, '異常狀態更新失敗')); }
    finally { setBusy(false); }
  }

  const metrics = useMemo(() => overview ? [
    ['LINE 官方帳號好友數', overview.oaFriends],
    ['所有工作紀錄使用者', overview.users],
    ['啟用群組', `${overview.activeGroups} / ${overview.groups}`],
    ['全部工作紀錄', overview.records],
    ['今日新增紀錄', overview.recordsToday],
    ['今日 AI 呼叫次數', overview.aiCallsToday],
    ['今日客戶實扣 AI 點數', overview.aiPointsToday],
    ['今日平台補貼 AI 點數', overview.platformSubsidizedPointsToday],
    ['今日 AI 成本', `NT$ ${Number(overview.aiCostTwdToday).toFixed(4)}`],
    ['今日平台補貼成本', `NT$ ${Number(overview.platformSubsidizedCostTwdToday).toFixed(4)}`],
    ['待處理異常', overview.openAnomalies],
    ['附件處理失敗', overview.failedAttachments],
    ['文字整理失敗', overview.failedNormalizations],
    ['近 30 天意見回饋', overview.feedback30d],
  ] : [], [overview]);

  if (!authChecked) return <main className="shell auth-shell"><section className="login-card"><p className="eyebrow">AFTERTRACE</p><h1>工作紀錄管理後台</h1><p className="muted">正在確認管理員登入狀態。</p></section></main>;
  if (!username) return <LoginView busy={busy} error={error} onLogin={login} />;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>工作紀錄管理後台</h1><p className="muted">{username} · 內部管理</p></div>
      <div className="header-actions"><button disabled={busy} onClick={() => void loadCurrent()}>重新整理</button><button className="ghost" onClick={clearSession}>登出</button></div>
    </header>

    <nav className="tabs">{(['overview','users','groups','plans','ai','feedback','anomalies','audit'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setDetail(null); setNotice(null); }}>{tabLabel(item)}</button>)}</nav>
    {error && <div className="banner error">{error}</div>}{notice && <div className="banner success">{notice}</div>}

    {tab === 'overview' && <section>
      <div className="metric-grid">{metrics.map(([name,value]) => <article className="metric" key={String(name)}><span>{name}</span><strong>{String(value)}</strong></article>)}</div>
      <article className="card"><h2>目前管理範圍</h2><p className="muted">此後台用來管理工作紀錄系統，包括使用者、群組 AI 額度負責人、Grant／AI 點數、方案、AI 模型與成本、平台補貼、意見回饋、異常事件及操作紀錄。</p></article>
    </section>}

    {tab === 'users' && <section className="stack">
      <article className="card filter-card"><div className="filter-grid">
        <label>搜尋<input value={userFilters.query ?? ''} onChange={(event) => setUserFilters((value) => ({ ...value, query: event.target.value }))} placeholder="使用者編號 / LINE ID / 暱稱" /></label>
        <label>方案<select value={userFilters.planCode ?? ''} onChange={(event) => setUserFilters((value) => ({ ...value, planCode: event.target.value }))}><option value="">全部</option>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.code} · {plan.display_name}</option>)}</select></label>
        <label>使用者類型<select value={userFilters.userType ?? ''} onChange={(event) => setUserFilters((value) => ({ ...value, userType: event.target.value as UserListFilters['userType'] }))}><option value="">全部</option><option value="INDIVIDUAL">一般使用者</option><option value="GROUP_ENABLED">AI 額度負責人</option></select></label>
        <label>更新時間<select value={userFilters.sortUpdated ?? 'DESC'} onChange={(event) => setUserFilters((value) => ({ ...value, sortUpdated: event.target.value as 'ASC' | 'DESC' }))}><option value="DESC">新 → 舊</option><option value="ASC">舊 → 新</option></select></label>
      </div><button disabled={busy} onClick={() => void loadCurrent()}>套用篩選</button></article>
      <DataTable rows={users} preferred={['id','display_name','plan_code','user_type','ai_granted_points','ai_used_points','ai_reserved_points','ai_available_points','platform_subsidized_points','responsible_group_count','member_group_count','last_interaction_at','updated_at']} onRow={openUser} />
    </section>}

    {tab === 'groups' && <section className="stack">
      <article className="card filter-card"><div className="search-row"><input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="來源 / LINE 群組 / AI 額度負責人" /><button disabled={busy} onClick={() => void loadCurrent()}>搜尋</button></div></article>
      <DataTable rows={groups} preferred={['id','line_group_id','status','ai_responsible_user_id','ai_responsible_display_name','ai_responsible_plan_code','ai_available_points','ai_reserved_points','group_ai_used_points','platform_subsidized_points','group_ai_cost_twd','active_members','record_count','updated_at']} onRow={openGroup} />
    </section>}

    {tab === 'plans' && <section className="stack">
      <article className="card"><h2>訂閱週期 AI 點數模板</h2><p className="muted">方案內的點數只用來建立之後的訂閱週期 Grant。已經建立的 FREE／訂閱／加購 Grant 都是獨立歷史事實，不會因為修改方案模板而被重算。</p></article>
      <PlanEditor key="new-plan" plan={null} definitions={capabilityDefinitions} busy={busy} onSave={savePlan} />
      {plans.map((plan) => <PlanEditor key={plan.code} plan={plan} definitions={capabilityDefinitions} busy={busy} onSave={savePlan} />)}
    </section>}

    {tab === 'ai' && <section><AiRuntimeEditor config={aiConfig} busy={busy} onSave={saveAi} /></section>}
    {tab === 'feedback' && <section><DataTable rows={feedback} preferred={['id','user_id','display_name','channel','text','context','created_at']} /></section>}

    {tab === 'anomalies' && <section className="stack">
      <article className="card"><h2>系統異常事件</h2><DataTable rows={anomalies.events} preferred={['id','severity','status','category','error_code','summary','user_id','source_id','line_message_id','created_at']} action={(row) => <AnomalyActions row={row} disabled={busy} onChange={updateAnomaly} />} /></article>
      <article className="card"><h2>附件處理失敗</h2><p className="muted">「可安全重試」代表錯誤發生在外部 AI 呼叫之前，只要原始 LINE 內容仍可取得即可重新嘗試；「需請使用者重傳」表示附件必須重新傳送；「人工檢查」則禁止自動重送 AI 請求，以避免重複計費。</p><DataTable rows={anomalies.attachments} preferred={['command_line_message_id','quoted_line_message_id','source_id','actor_user_id','status','last_error_code','retry_disposition','retry_guidance','updated_at']} /></article>
      <article className="card"><h2>文字整理失敗</h2><DataTable rows={anomalies.normalizations} preferred={['record_id','status','last_error_code','last_error_detail','started_at','updated_at']} /></article>
    </section>}

    {tab === 'audit' && <section><DataTable rows={audit} preferred={['id','actor_admin','actor_user_id','workspace_id','action','target_type','target_id','before_value','after_value','created_at']} /></section>}
    {detail && <DetailDrawer state={detail} plans={plans} busy={busy} onClose={() => setDetail(null)} onUpdatePlan={updateUserPlan} />}
  </main>;
}

function LoginView({ busy, error, onLogin }: { busy: boolean; error: string | null; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return <main className="shell auth-shell"><form className="login-card" onSubmit={(event) => { event.preventDefault(); void onLogin(username, password); }}>
    <p className="eyebrow">AFTERTRACE</p><h1>工作紀錄管理後台</h1><p className="muted">請使用系統設定的管理員帳號登入。</p>
    {error && <div className="banner error">{error}</div>}
    <label>帳號<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button disabled={busy || !username.trim() || !password}>{busy ? '登入中…' : '登入'}</button>
  </form></main>;
}

function PlanEditor({ plan, definitions, busy, onSave }: { plan: AdminPlan | null; definitions: AdminCapabilityDefinition[]; busy: boolean; onSave: (input: Parameters<AdminApi['savePlan']>[0]) => Promise<void> }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [displayName, setDisplayName] = useState(plan?.display_name ?? '');
  const [priceTwd, setPriceTwd] = useState(plan?.price_twd ?? '0');
  const [rank, setRank] = useState(String(plan?.rank ?? 0));
  const [enabled, setEnabled] = useState(plan?.enabled ?? true);
  const [allowance, setAllowance] = useState(String(plan?.subscription_period_points ?? 0));
  const [capabilities, setCapabilities] = useState<Record<string, boolean | number | string>>(() => capabilityDefaults(definitions, plan?.capabilities));

  useEffect(() => {
    setCapabilities(capabilityDefaults(definitions, plan?.capabilities));
  }, [plan?.code, plan?.updated_at, definitions]);

  function setCapability(definition: AdminCapabilityDefinition, raw: boolean | string) {
    setCapabilities((current) => {
      let value: boolean | number | string;
      if (definition.type === 'boolean') value = Boolean(raw);
      else if (definition.type === 'number') value = raw === '' ? 0 : Number(raw);
      else value = String(raw);
      return { ...current, [definition.key]: value };
    });
  }

  async function submit() {
    await onSave({
      code: code.trim().toUpperCase(),
      displayName: displayName.trim(),
      priceTwd: priceTwd.trim(),
      rank: Number(rank),
      enabled,
      subscriptionPeriodPoints: Number(allowance),
      capabilities,
    });
  }

  return <article className="card"><div className="card-head"><div><p className="eyebrow">{plan ? '方案' : '新增方案'}</p><h2>{plan?.code ?? '新增方案'}</h2></div><label className="switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 啟用</label></div>
    <div className="form-grid">
      <label>方案代碼<input value={code} disabled={Boolean(plan)} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>
      <label>顯示名稱<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>價格（新台幣）<input inputMode="decimal" value={priceTwd} onChange={(event) => setPriceTwd(event.target.value)} /></label>
      <label>排序順位<input inputMode="numeric" value={rank} onChange={(event) => setRank(event.target.value)} /></label>
      <label>訂閱週期 AI 點數<input inputMode="numeric" value={allowance} onChange={(event) => setAllowance(event.target.value)} /></label>
    </div>

    <h3>功能權限</h3>
    {definitions.length === 0 ? <p className="muted">目前沒有可用的功能權限定義。</p> : <div className="form-grid">
      {definitions.map((definition) => {
        const value = capabilities[definition.key] ?? definition.defaultValue;
        if (definition.type === 'boolean') {
          return <label key={definition.key} className="switch"><input type="checkbox" checked={Boolean(value)} onChange={(event) => setCapability(definition, event.target.checked)} /> <span><strong>{definition.label}</strong>{definition.description && <small className="muted">{definition.description}</small>}</span></label>;
        }
        if (definition.type === 'number') {
          return <label key={definition.key}>{definition.label}<input type="number" min={definition.min} max={definition.max} value={String(value)} onChange={(event) => setCapability(definition, event.target.value)} />{definition.description && <small className="muted">{definition.description}</small>}</label>;
        }
        return <label key={definition.key}>{definition.label}<input value={String(value)} onChange={(event) => setCapability(definition, event.target.value)} />{definition.description && <small className="muted">{definition.description}</small>}</label>;
      })}
    </div>}

    <button disabled={busy || !code.trim() || !displayName.trim() || definitions.length === 0} onClick={() => void submit()}>儲存方案</button>
  </article>;
}

function AiRuntimeEditor({ config, busy, onSave }: { config: AdminAiRuntimeConfig | null; busy: boolean; onSave: (input: Parameters<AdminApi['saveAiRuntime']>[0]) => Promise<void> }) {
  const [provider, setProvider] = useState(config?.provider ?? 'GOOGLE');
  const [model, setModel] = useState(config?.model ?? '');
  const [inputPrice, setInputPrice] = useState(config?.input_usd_per_million ?? '0');
  const [outputPrice, setOutputPrice] = useState(config?.output_usd_per_million ?? '0');
  const [fx, setFx] = useState(config?.usd_twd_rate ?? '');
  useEffect(() => {
    setProvider(config?.provider ?? 'GOOGLE');
    setModel(config?.model ?? '');
    setInputPrice(config?.input_usd_per_million ?? '0');
    setOutputPrice(config?.output_usd_per_million ?? '0');
    setFx(config?.usd_twd_rate ?? '');
  }, [config?.updated_at]);
  return <article className="card"><p className="eyebrow">AI 執行設定</p><h2>AI 供應商、模型與計價</h2><p className="muted">文字、語音與圖片輸入統一使用同一個輸入價格。更新只會影響之後的 AI 呼叫；歷史使用紀錄會保留當時的計價資料。</p>
    <div className="form-grid">
      <label>AI 供應商<input value={provider} onChange={(event) => setProvider(event.target.value)} /></label>
      <label>模型<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label>輸入價格（美元／100 萬單位）<input inputMode="decimal" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} /></label>
      <label>輸出價格（美元／100 萬單位）<input inputMode="decimal" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} /></label>
      <label>美元兌新台幣匯率<input inputMode="decimal" value={fx} onChange={(event) => setFx(event.target.value)} placeholder="選填" /></label>
    </div>
    <button disabled={busy || !provider.trim() || !model.trim()} onClick={() => void onSave({ provider: provider.trim(), model: model.trim(), inputUsdPerMillion: inputPrice.trim(), outputUsdPerMillion: outputPrice.trim(), audioUsdPerMillion: inputPrice.trim(), imageUsdPerMillion: inputPrice.trim(), usdTwdRate: fx.trim() || null })}>儲存 AI 設定</button>
    {config?.updated_at && <p className="muted">最後更新：{display(config.updated_at)}{config.updated_by ? ` · ${config.updated_by}` : ''}</p>}
  </article>;
}

function DetailDrawer({ state, plans, busy, onClose, onUpdatePlan }: { state: Exclude<DetailState, null>; plans: AdminPlan[]; busy: boolean; onClose: () => void; onUpdatePlan: (userId: string, planCode: string, end: string | null) => Promise<void> }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">{state.kind === 'USER' ? '使用者' : '群組'}</p><h2>詳細資料</h2></div><button className="ghost" onClick={onClose}>關閉</button></div>
    {state.kind === 'USER' ? <UserDetail value={state.value} plans={plans} busy={busy} onUpdatePlan={onUpdatePlan} /> : <GroupDetail value={state.value} />}
  </aside></div>;
}

function UserDetail({ value, plans, busy, onUpdatePlan }: { value: Record<string, unknown>; plans: AdminPlan[]; busy: boolean; onUpdatePlan: (userId: string, planCode: string, end: string | null) => Promise<void> }) {
  const user = asRow(value.user);
  const userId = String(user.id ?? '');
  const [planCode, setPlanCode] = useState(String(user.plan_code ?? plans[0]?.code ?? 'FREE'));
  const [periodEnd, setPeriodEnd] = useState(toLocalInput(user.current_period_end));
  useEffect(() => { setPlanCode(String(user.plan_code ?? plans[0]?.code ?? 'FREE')); setPeriodEnd(toLocalInput(user.current_period_end)); }, [user.id, user.plan_code, user.current_period_end, plans.length]);
  return <div className="stack"><article className="card"><h3>使用者資料與 AI 點數</h3><Detail value={user} /></article>
    <article className="card"><h3>手動調整方案</h3><div className="form-grid"><label>方案<select value={planCode} onChange={(event) => setPlanCode(event.target.value)}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.code} · {plan.display_name}</option>)}</select></label><label>本期結束時間<input type="datetime-local" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div><button disabled={busy || !userId || !planCode} onClick={() => void onUpdatePlan(userId, planCode, periodEnd ? new Date(periodEnd).toISOString() : null)}>套用方案</button></article>
    <DetailTable title="AI Grant" value={value.grants} preferred={['id','type','status','original_points','remaining_points','scoped_used_points','scoped_reserved_points','enabled_source_count','effective_at','expires_at']} />
    <DetailTable title="擔任 AI 額度負責人的群組" value={value.responsibleGroups} preferred={['source_id','line_group_id','status','active_members','record_count','ai_used_points','platform_subsidized_points','assigned_at','updated_at']} />
    <DetailTable title="加入的群組" value={value.memberGroups} preferred={['source_id','line_group_id','status','first_seen_at','last_seen_at','updated_at']} />
    <DetailTable title="近期 AI 使用紀錄" value={value.aiUsage} preferred={['id','billing_relation','source_id','record_id','operation','provider','model','customer_points_charged','platform_subsidized_points','provider_cost_twd','created_at']} />
    <DetailTable title="方案異動紀錄" value={value.subscriptionHistory} preferred={['id','previous_plan_code','next_plan_code','source','actor','metadata','created_at']} />
  </div>;
}

function GroupDetail({ value }: { value: Record<string, unknown> }) {
  return <div className="stack"><article className="card"><h3>群組 AI 額度負責人與點數</h3><Detail value={value.group} /></article><DetailTable title="群組成員" value={value.members} preferred={['user_id','display_name','is_active','ai_used_points','platform_subsidized_points','ai_cost_twd','text_count','audio_count','image_count','file_count','last_seen_at','updated_at']} /><DetailTable title="近期工作紀錄" value={value.recentRecords} preferred={['id','title','author_display_name','input_type','raw_text','occurred_at','status','version','updated_at']} /><DetailTable title="近期 AI 使用紀錄" value={value.recentUsage} preferred={['id','actor_user_id','charged_user_id','record_id','operation','provider','model','customer_points_charged','platform_subsidized_points','provider_cost_twd','created_at']} /><DetailTable title="群組 Grant 分配" value={value.fundingScopes} preferred={['scope_id','grant_id','owner_user_id','grant_type','cap_points','used_points','reserved_points','enabled','remaining_points','expires_at','updated_at']} /><DetailTable title="AI 額度負責人異動" value={value.responsibilityHistory} preferred={['id','previous_user_id','next_user_id','actor_user_id','reason','created_at']} /></div>;
}

function DetailTable({ title, value, preferred }: { title: string; value: unknown; preferred: string[] }) {
  return <article className="card"><h3>{title}</h3><DataTable rows={Array.isArray(value) ? value.filter(isRow) as Row[] : []} preferred={preferred} /></article>;
}

function AnomalyActions({ row, disabled, onChange }: { row: Row; disabled: boolean; onChange: (row: Row, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => Promise<void> }) {
  return <div className="row-actions"><button disabled={disabled} onClick={() => void onChange(row, 'OPEN')}>待處理</button><button disabled={disabled} onClick={() => void onChange(row, 'RESOLVED')}>已解決</button><button className="ghost" disabled={disabled} onClick={() => void onChange(row, 'IGNORED')}>忽略</button></div>;
}

function DataTable({ rows, preferred, onRow, action }: { rows: Row[]; preferred: string[]; onRow?: (row: Row) => void; action?: (row: Row) => React.ReactNode }) {
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;
  const columns = preferred.filter((column) => rows.some((row) => column in row));
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}{action && <th>操作</th>}</tr></thead><tbody>{rows.map((row,index) => <tr key={`${String(row.id ?? row.source_id ?? row.command_line_message_id ?? index)}-${index}`} className={onRow ? 'clickable' : ''} onClick={() => onRow?.(row)}>{columns.map((column) => <td key={column}>{display(row[column])}</td>)}{action && <td onClick={(event) => event.stopPropagation()}>{action(row)}</td>}</tr>)}</tbody></table></div>;
}

function Detail({ value }: { value: unknown }): React.ReactNode {
  if (Array.isArray(value)) return <div className="detail-list">{value.map((item,index) => <Detail key={index} value={item} />)}</div>;
  if (value && typeof value === 'object') return <div className="detail-object">{Object.entries(value as Record<string,unknown>).map(([key,item]) => <div className="detail-row" key={key}><strong>{humanize(key)}</strong>{item && typeof item === 'object' ? <Detail value={item} /> : <span>{display(item)}</span>}</div>)}</div>;
  return <span>{display(value)}</span>;
}

function capabilityDefaults(definitions: AdminCapabilityDefinition[], current?: Record<string, boolean | number | string>): Record<string, boolean | number | string> {
  const result: Record<string, boolean | number | string> = {};
  for (const definition of definitions) result[definition.key] = current?.[definition.key] ?? definition.defaultValue;
  return result;
}

const COLUMN_LABELS: Record<string, string> = {
  id: '編號', user_id: '使用者編號', display_name: '顯示名稱', line_user_id: 'LINE 使用者 ID', line_group_id: 'LINE 群組 ID',
  plan_code: '方案', subscription_period_points: '訂閱週期 AI 點數', user_type: '使用者類型', status: '狀態', source_id: '來源編號',
  ai_responsible_user_id: 'AI 額度負責人編號', ai_responsible_display_name: 'AI 額度負責人', ai_responsible_plan_code: '負責人方案',
  ai_granted_points: '累計發放 AI 點數', ai_available_points: '可用 AI 點數', ai_reserved_points: '保留中 AI 點數', ai_used_points: '已扣 AI 點數',
  group_ai_used_points: '群組已扣 AI 點數', platform_subsidized_points: '平台補貼點數', group_ai_cost_twd: '群組 AI 成本', ai_cost_twd: 'AI 成本', provider_cost_twd: '供應商成本',
  responsible_group_count: '負責 AI 額度群組數', member_group_count: '加入群組數', active_members: '啟用成員數',
  text_count: '文字紀錄數', audio_count: '語音紀錄數', image_count: '圖片紀錄數', file_count: '檔案紀錄數', record_count: '紀錄數',
  last_interaction_at: '最後互動時間', first_seen_at: '首次出現時間', last_seen_at: '最後出現時間', updated_at: '更新時間', created_at: '建立時間', started_at: '開始時間', occurred_at: '發生時間',
  is_active: '啟用中', billing_relation: '計費關係', record_id: '紀錄編號', provider: 'AI 供應商', model: 'AI 模型', operation: 'AI 操作',
  customer_points_charged: '使用者扣點', previous_plan_code: '原方案', next_plan_code: '新方案', source: '來源', actor: '操作人員', metadata: '附加資料',
  author_user_id: '作者編號', author_display_name: '作者', actor_user_id: '操作使用者', charged_user_id: '計費使用者', input_type: '輸入類型', raw_text: '紀錄內容', title: '紀錄標題', version: '版本',
  channel: '管道', text: '內容', context: '相關資訊', severity: '嚴重程度', error_code: '錯誤代碼', summary: '摘要', line_message_id: 'LINE 訊息 ID',
  command_line_message_id: '指令訊息 ID', quoted_line_message_id: '引用訊息 ID', last_error_code: '最後錯誤代碼', last_error_detail: '最後錯誤內容', retry_disposition: '處理方式', retry_guidance: '處理建議',
  actor_admin: '操作管理員', workspace_id: '工作區編號', action: '操作', target_type: '目標類型', target_id: '目標編號', before_value: '修改前', after_value: '修改後',
  subscription_effective_state: '方案有效狀態', subscription_status: '訂閱狀態', current_period_start: '本期開始時間', current_period_end: '本期結束時間', effective_at: '生效時間', plan_enabled: '方案是否啟用',
  original_points: '原始點數', remaining_points: '剩餘點數', scoped_used_points: 'Scope 已用點數', scoped_reserved_points: 'Scope 保留點數', enabled_source_count: '啟用來源數', expires_at: '到期時間',
  scope_id: 'Scope 編號', grant_id: 'Grant 編號', owner_user_id: 'Grant 擁有者', grant_type: 'Grant 類型', cap_points: '群組上限點數', used_points: '已用點數', reserved_points: '保留點數', enabled: '啟用',
  previous_user_id: '前任負責人', next_user_id: '新負責人', reason: '原因', assigned_at: '指派時間',
};

function isRow(value: unknown): value is Row { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function asRow(value: unknown): Row { return isRow(value) ? value : {}; }
function message(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
function humanize(value: string) { return COLUMN_LABELS[value] ?? value.replaceAll('_', ' '); }
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0,157)}…` : text;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('zh-TW');
  }
  return text.length > 160 ? `${text.slice(0,157)}…` : text;
}
function toLocalInput(value: unknown): string { if (!value) return ''; const date = new Date(String(value)); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0,16); }
function tabLabel(tab: Tab): string { return ({ overview:'總覽', users:'使用者', groups:'群組', plans:'方案管理', ai:'AI 計價', feedback:'意見回饋', anomalies:'異常事件', audit:'操作紀錄' })[tab]; }
