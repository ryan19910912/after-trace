import { useEffect, useMemo, useState } from 'react';
import { AiCaptureApi, type AiEntitlementDecision } from './ai-capture-api';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
type NewebPayForm = { action: string; fields: { MerchantID_: string; PostData_: string }; merchantOrderNo: string };
type PaymentRenewalState = 'ACTIVE' | 'TERMINATED' | 'PENDING' | 'FAILED' | 'NONE';
type SubscriptionPlan = {
  code: string;
  plan_type: 'FREE' | 'SUBSCRIPTION';
  display_name: string;
  price_twd: string;
  rank: number;
  monthly_ai_point_cap?: number | null;
  monthly_provider_cost_cap_twd?: string | null;
  per_request_ai_point_cap?: number | null;
  capabilities: Record<string, unknown>;
  current: boolean;
};
type FreeAiTrialState = { status: 'AVAILABLE' | 'EXHAUSTED' | 'NOT_ISSUED'; originalPoints: number; remainingPoints: number };
type SubscriptionPlans = { currentPlanCode: string; currentSubscriptionState?: string; freeAiTrial: FreeAiTrialState; plans: SubscriptionPlan[] };
type SubscriptionSnapshot = { plans: SubscriptionPlans; renewalState: PaymentRenewalState; periodEnd: string | null };

export function SubscriptionRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const aiApi = useMemo(() => new AiCaptureApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => new URLSearchParams(location.hash.replace(/^#/, '')).get('session')?.trim() || localStorage.getItem(SESSION_KEY));
  const [data, setData] = useState<SubscriptionPlans | null>(null);
  const [usage, setUsage] = useState<AiEntitlementDecision | null>(null);
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [renewalState, setRenewalState] = useState<PaymentRenewalState>('NONE');
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [payerEmail, setPayerEmail] = useState('');
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true); setReady(false); setError(null);
    try {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      const url = new URL(location.href);
      const paymentReturned = url.searchParams.get('payment') === 'returned';
      if (paymentReturned) setConfirmingPayment(true);
      const entry = url.searchParams.get('t')?.trim();
      if (entry) {
        const exchanged = await api.exchangeEntry(entry); token = exchanged.sessionToken;
        localStorage.setItem(SESSION_KEY, token); setSession(token); url.searchParams.delete('t');
        history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        token = callback; localStorage.setItem(SESSION_KEY, callback); setSession(callback);
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      }
      setPaymentAvailable(await paymentAvailability(apiBaseUrl).catch(() => false));
      if (token) {
        let snapshot = await subscriptionSnapshot(apiBaseUrl, token);
        setData(snapshot.plans); setRenewalState(snapshot.renewalState); setPeriodEnd(snapshot.periodEnd);
        if (paymentReturned) {
          snapshot = await waitForPaymentResult(apiBaseUrl, token, snapshot);
          setData(snapshot.plans); setRenewalState(snapshot.renewalState); setPeriodEnd(snapshot.periodEnd);
          if (snapshot.plans.currentPlanCode !== 'FREE') {
            const current = snapshot.plans.plans.find((plan) => plan.code === snapshot.plans.currentPlanCode);
            setNotice(`${current?.display_name ?? '訂閱方案'} 已啟用。`);
          } else if (snapshot.renewalState === 'FAILED') setNotice('付款未成功，請重新嘗試。');
          else setNotice('付款結果仍在確認中，請稍後重新整理。');
          url.searchParams.delete('payment'); history.replaceState({}, document.title, `${url.pathname}${url.search}`);
        }
        await loadUsage(token, snapshot.plans.currentPlanCode !== 'FREE');
      }
    } catch (cause) {
      if (isSessionError(cause)) { clearSession(); setError('登入已過期，請重新登入。'); }
      else setError(cause instanceof Error ? cause.message : '方案載入失敗');
    } finally { setConfirmingPayment(false); setBusy(false); setReady(true); }
  }

  async function loadUsage(token: string, paidActive: boolean) {
    if (!paidActive) { setUsage(null); return; }
    try {
      const surfaces = await api.surfaces(token);
      const sourceId = surfaces.personal?.sourceId ?? surfaces.groups[0]?.sourceId;
      setUsage(sourceId ? await aiApi.entitlement(token, sourceId) : null);
    } catch { setUsage(null); }
  }

  function openCheckout(plan: SubscriptionPlan) {
    if (!session || plan.current || plan.plan_type !== 'SUBSCRIPTION' || !paymentAvailable || busy || data?.currentPlanCode !== 'FREE') return;
    setError(null); setNotice(null); setCheckoutPlan(plan);
  }
  function closeCheckout() { if (busy) return; setCheckoutPlan(null); setError(null); }

  async function choose(plan: SubscriptionPlan) {
    if (!session || plan.current || plan.plan_type !== 'SUBSCRIPTION' || !paymentAvailable || data?.currentPlanCode !== 'FREE') return;
    if (!validEmail(payerEmail)) { setError('請輸入有效的付款 Email。'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/checkout`, {
        method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: plan.code, requestKey: checkoutRequestKey(), payerEmail: payerEmail.trim() }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `NEWEBPAY_CHECKOUT_FAILED_${response.status}`);
      submitProviderForm(paymentForm(body.form));
    } catch (cause) {
      if (isSessionError(cause)) { clearSession(); setCheckoutPlan(null); setError('登入已過期，請重新登入。'); }
      else setError(paymentError(cause));
      setBusy(false);
    }
  }

  async function cancelRenewal() {
    if (!session || data?.currentPlanCode === 'FREE' || renewalState !== 'ACTIVE' || !paymentAvailable || busy) return;
    const currentPlan = data.plans.find((plan) => plan.code === data.currentPlanCode);
    const planName = currentPlan?.display_name ?? '目前訂閱方案';
    if (!window.confirm(`確定取消 ${planName} 自動續訂？取消後不會再自動扣款，已付款的本期仍可使用到週期結束。`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${session}` } });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `NEWEBPAY_CANCEL_FAILED_${response.status}`);
      const cancelledPeriodEnd = typeof body.periodEnd === 'string' ? body.periodEnd : null;
      setNotice(cancelledPeriodEnd
        ? `已取消 ${planName} 自動續訂，可使用到 ${formatTaipeiDate(cancelledPeriodEnd)}。到期後如需再次使用，請重新訂閱。`
        : `已取消 ${planName} 自動續訂。到期後如需再次使用，請重新訂閱。`);
      const snapshot = await subscriptionSnapshot(apiBaseUrl, session);
      setData(snapshot.plans); setRenewalState(snapshot.renewalState); setPeriodEnd(snapshot.periodEnd ?? cancelledPeriodEnd);
    } catch (cause) {
      if (isSessionError(cause)) { clearSession(); setError('登入已過期，請重新登入。'); }
      else setError(paymentError(cause));
    } finally { setBusy(false); }
  }

  function clearSession() { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('aftertrace.worklog.scope'); setSession(null); setData(null); setUsage(null); setRenewalState('NONE'); setPeriodEnd(null); setCheckoutPlan(null); }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>方案</h1><p className="muted">登入後可查看免費版與目前可訂閱的方案。</p>{error ? <div className="error">{error}</div> : null}<LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/subscription" /></section></main>;
  if (!ready) return <main className="shell worklog-shell subscription-shell subscription-loading"><section className="subscription-loading-card" aria-live="polite"><span className="subscription-loading-dot" /><strong>{confirmingPayment ? '正在確認付款結果' : '正在載入方案'}</strong><p className="muted">{confirmingPayment ? '正在確認付款結果，請稍候…' : '正在確認你的方案與可用功能…'}</p></section></main>;
  if (!data) return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>方案暫時無法載入</h1><p className="muted">請稍後重新整理頁面再試一次。</p>{error ? <div className="error">{error}</div> : null}<button onClick={() => location.reload()}>重新載入</button></section></main>;

  const trial = data.freeAiTrial;
  const paidActive = data.currentPlanCode !== 'FREE';
  const currentPlan = data.plans.find((plan) => plan.code === data.currentPlanCode);

  return <main className="shell worklog-shell subscription-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>方案</h1><p className="muted">目前使用：{paidActive ? currentPlan?.display_name ?? '訂閱方案' : '免費版'}</p></div></div>
    {!checkoutPlan && error ? <div className="error">{error}</div> : null}{notice ? <div className="worklog-notice">{notice}</div> : null}

    {!paidActive ? <section className="panel stack subscription-trial"><h2>免費 AI 體驗</h2>{trial?.status === 'AVAILABLE' ? <p>你目前還有 <strong>{trial.remainingPoints.toLocaleString('zh-TW')}</strong> 點免費 AI 體驗額度，可用於 AI 搜尋、文字整理、圖片、音訊、檔案、摘要、改寫與待辦建議等功能。</p> : trial?.status === 'EXHAUSTED' ? <p>免費 AI 體驗額度已使用完畢；工作紀錄、一般搜尋、群組與待辦仍可繼續免費使用。</p> : <p>免費 AI 體驗額度尚未發放；其他免費功能仍可正常使用。</p>}<p className="muted">體驗額度每個帳號只發放一次，不會每月刷新。額度用完後可選擇適合的訂閱方案繼續使用完整 AI 功能。</p></section> : null}

    {paidActive ? <AiUsageStatus usage={usage} plan={currentPlan} /> : null}

    <section className="subscription-grid">{data.plans.map((plan) => {
      const paid = plan.plan_type === 'SUBSCRIPTION';
      const purchasable = paid && Number.isInteger(Number(plan.price_twd)) && Number(plan.price_twd) > 0;
      const disabled = busy || plan.current || !paid || !paymentAvailable || paidActive || !purchasable;
      const buttonLabel = plan.current ? '目前方案' : !paid ? '免費方案' : paidActive ? '已有訂閱方案' : !purchasable ? '暫不支援線上訂閱' : !paymentAvailable ? '暫時無法升級' : `訂閱 ${plan.display_name}`;
      return <article className={`panel subscription-card ${paid ? 'pro' : 'free'}${plan.current ? ' current' : ''}`} key={plan.code}>
        <div><p className="eyebrow">{paid ? 'SUBSCRIPTION' : 'FREE'}</p><h2>{plan.display_name || (paid ? 'AI 訂閱方案' : '免費版')}</h2></div>
        <strong className="subscription-price">{!paid ? 'NT$0' : `NT$${Number(plan.price_twd).toLocaleString('zh-TW')} / 月`}</strong>
        <p>{!paid ? '日常工作紀錄需要的基本功能都可以免費使用。' : '使用完整 AI 功能快速整理、搜尋與理解工作紀錄。'}</p>
        <small>✓ 工作紀錄、新增、編輯與一般搜尋</small><small>✓ 群組、待辦與通知</small>
        {!paid ? <><small>✓ 一次性免費 AI 體驗額度</small><small>✓ 體驗期間可使用完整 AI 功能</small></> : <><small>✓ AI 自然語言搜尋</small><small>✓ AI 文字整理</small><small>✓ 圖片、音訊與檔案整理</small><small>✓ 相關紀錄、摘要、改寫與待辦建議</small><small>✓ 每月最多 {Number(plan.monthly_ai_point_cap ?? 0).toLocaleString('zh-TW')} AI 點</small></>}
        {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
        <button disabled={disabled} onClick={() => openCheckout(plan)}>{buttonLabel}</button>
      </article>;
    })}</section>

    {!paidActive && !paymentAvailable ? <div className="worklog-notice">目前尚未開放線上升級；免費功能與一次性 AI 體驗不受影響。</div> : null}
    {paidActive ? <section className="panel stack subscription-renewal">
      <strong>{currentPlan?.display_name ?? '訂閱方案'} 訂閱管理</strong>
      {renewalState === 'TERMINATED'
        ? <div className="worklog-notice">已取消自動續訂。{periodEnd ? `目前方案可使用到 ${formatTaipeiDate(periodEnd)}。` : '目前已付款週期仍可使用到期。'} 到期後如需再次使用，請重新走一次訂閱流程。</div>
        : <p className="muted">{periodEnd ? `目前方案可使用到 ${formatTaipeiDate(periodEnd)}。` : ''} 取消續訂只會停止下一期扣款，目前已付款週期仍可使用到期。</p>}
      {renewalState === 'ACTIVE' ? <button className="ghost danger" disabled={busy || !paymentAvailable} onClick={() => void cancelRenewal()}>取消自動續訂</button> : null}
    </section> : null}

    {checkoutPlan ? <div className="subscription-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCheckout(); }}><section className="subscription-modal" role="dialog" aria-modal="true" aria-labelledby="subscription-checkout-title"><button className="subscription-modal-close" type="button" aria-label="關閉" disabled={busy} onClick={closeCheckout}>×</button><p className="eyebrow">訂閱方案</p><h2 id="subscription-checkout-title">{checkoutPlan.display_name}｜NT${Number(checkoutPlan.price_twd).toLocaleString('zh-TW')} / 月</h2><p className="subscription-modal-copy">輸入付款 Email 後，會前往藍新完成付款。</p><label className="subscription-email-label"><span>付款 Email</span><input type="email" autoComplete="email" autoFocus value={payerEmail} onChange={(event) => { setPayerEmail(event.target.value); if (error) setError(null); }} placeholder="name@example.com" onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void choose(checkoutPlan); }} /></label><p className="muted">此 Email 只用於本次付款與訂單查詢；AFTERTRACE 不會接收或保存信用卡號。</p>{error ? <div className="error">{error}</div> : null}<div className="subscription-modal-actions"><button className="ghost" type="button" disabled={busy} onClick={closeCheckout}>取消</button><button type="button" disabled={busy || !validEmail(payerEmail)} onClick={() => void choose(checkoutPlan)}>{busy ? '正在前往付款…' : '前往藍新付款'}</button></div></section></div> : null}
  </main>;
}

function AiUsageStatus({ usage, plan }: { usage: AiEntitlementDecision | null; plan?: SubscriptionPlan }) {
  const cap = Number(plan?.monthly_ai_point_cap ?? 0);
  const remaining = usage?.remainingPoints ?? null;
  const blocked = usage?.allowed === false && /MONTHLY_.*CAP/.test(usage.reason);
  const ratio = cap > 0 && remaining !== null ? remaining / cap : null;
  const state = blocked ? '已達本期上限' : ratio !== null && ratio <= .2 ? '接近本期上限' : '使用狀況正常';
  const detail = blocked
    ? '本期 AI 功能已暫停，手動紀錄與一般功能仍可正常使用。'
    : remaining !== null ? `本期約剩 ${remaining.toLocaleString('zh-TW')} 點 AI 用量。` : '目前 AI 功能可正常使用。';
  return <section className={`panel stack subscription-usage${blocked ? ' blocked' : ratio !== null && ratio <= .2 ? ' warning' : ''}`}><div><p className="eyebrow">AI 使用狀況</p><h2>{state}</h2></div><p>{detail}</p>{usage?.periodEndsAt ? <p className="muted">下一個方案週期預計於 {formatTaipeiDate(usage.periodEndsAt)} 開始。</p> : null}</section>;
}

async function paymentAvailability(apiBaseUrl: string) { const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/availability`); const body = await jsonBody(response); return response.ok && body.available === true; }
async function subscriptionSnapshot(apiBaseUrl: string, sessionToken: string): Promise<SubscriptionSnapshot> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/subscription/plans`, { headers: { Authorization: `Bearer ${sessionToken}` } });
  const body = await jsonBody(response); if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `SUBSCRIPTION_STATE_FAILED_${response.status}`);
  const planRows = Array.isArray(body.plans) ? body.plans.map(subscriptionPlan).filter((value): value is SubscriptionPlan => value !== null) : [];
  const trialRaw = body.freeAiTrial && typeof body.freeAiTrial === 'object' ? body.freeAiTrial as Record<string, unknown> : {};
  const trialStatus = trialRaw.status === 'AVAILABLE' || trialRaw.status === 'EXHAUSTED' || trialRaw.status === 'NOT_ISSUED' ? trialRaw.status : 'NOT_ISSUED';
  const renewalRaw = typeof body.paymentRenewalState === 'string' ? body.paymentRenewalState.toUpperCase() : 'NONE';
  const renewalState: PaymentRenewalState = renewalRaw === 'ACTIVE' || renewalRaw === 'TERMINATED' || renewalRaw === 'PENDING' || renewalRaw === 'FAILED' ? renewalRaw : 'NONE';
  const periodEnd = typeof body.currentPeriodEnd === 'string' && !Number.isNaN(new Date(body.currentPeriodEnd).getTime()) ? body.currentPeriodEnd : null;
  const currentPlanCode = typeof body.currentPlanCode === 'string' && body.currentPlanCode.trim() ? body.currentPlanCode.trim().toUpperCase() : 'FREE';
  return { plans: { currentPlanCode, currentSubscriptionState: typeof body.currentSubscriptionState === 'string' ? body.currentSubscriptionState : undefined, freeAiTrial: { status: trialStatus, originalPoints: Number(trialRaw.originalPoints ?? 0), remainingPoints: Number(trialRaw.remainingPoints ?? 0) }, plans: planRows }, renewalState, periodEnd };
}
async function waitForPaymentResult(apiBaseUrl: string, sessionToken: string, initial: SubscriptionSnapshot): Promise<SubscriptionSnapshot> { let snapshot = initial; for (let attempt = 0; attempt < 15; attempt += 1) { if (snapshot.plans.currentPlanCode !== 'FREE' || snapshot.renewalState === 'FAILED') return snapshot; await new Promise((resolve) => setTimeout(resolve, 1000)); snapshot = await subscriptionSnapshot(apiBaseUrl, sessionToken); } return snapshot; }
function subscriptionPlan(value: unknown): SubscriptionPlan | null { if (!value || typeof value !== 'object' || Array.isArray(value)) return null; const row = value as Record<string, unknown>; const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : ''; const planType = row.plan_type === 'FREE' || row.plan_type === 'SUBSCRIPTION' ? row.plan_type : null; if (!code || !planType) return null; return { code, plan_type: planType, display_name: String(row.display_name ?? code), price_twd: String(row.price_twd ?? '0'), rank: Number(row.rank ?? 0), monthly_ai_point_cap: row.monthly_ai_point_cap == null ? null : Number(row.monthly_ai_point_cap), monthly_provider_cost_cap_twd: row.monthly_provider_cost_cap_twd == null ? null : String(row.monthly_provider_cost_cap_twd), per_request_ai_point_cap: row.per_request_ai_point_cap == null ? null : Number(row.per_request_ai_point_cap), capabilities: row.capabilities && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities) ? row.capabilities as Record<string, unknown> : {}, current: row.current === true }; }
function paymentForm(value: unknown): NewebPayForm { if (!value || typeof value !== 'object') throw new Error('NEWEBPAY_FORM_INVALID'); const row = value as Record<string, unknown>; const fields = row.fields as Record<string, unknown> | undefined; if (typeof row.action !== 'string' || !/^https:\/\/(?:c?core)\.newebpay\.com\//.test(row.action) || !fields || typeof fields.MerchantID_ !== 'string' || typeof fields.PostData_ !== 'string') throw new Error('NEWEBPAY_FORM_INVALID'); return { action: row.action, fields: { MerchantID_: fields.MerchantID_, PostData_: fields.PostData_ }, merchantOrderNo: String(row.merchantOrderNo ?? '') }; }
function submitProviderForm(input: NewebPayForm) { const form = document.createElement('form'); form.method = 'POST'; form.action = input.action; form.style.display = 'none'; for (const [name, value] of Object.entries(input.fields)) { const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = name; hidden.value = value; form.appendChild(hidden); } document.body.appendChild(form); form.submit(); }
function validEmail(value: string) { const normalized = value.trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254; }
function checkoutRequestKey() { return `web_${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 64); }
function capabilitySummary(value: Record<string, unknown>) { const result: string[] = []; if (value.export === true) result.push('資料匯出'); return result; }
function isSessionError(cause: unknown) { const text = cause instanceof Error ? cause.message : String(cause ?? ''); return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED|WORKLOG_USER_NOT_FOUND/.test(text); }
async function jsonBody(response: Response): Promise<Record<string, unknown>> { const text = await response.text(); if (!text) return {}; try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`INVALID_PAYMENT_RESPONSE_${response.status}`); } }
function paymentError(cause: unknown) { const code = cause instanceof Error ? cause.message : String(cause ?? ''); if (code === 'NEWEBPAY_NOT_CONFIGURED') return '目前尚未開放線上升級。'; if (code === 'SUBSCRIPTION_ALREADY_ACTIVE') return '目前已有有效訂閱，不需要重複購買。'; if (code === 'PLAN_NOT_AVAILABLE') return '這個方案目前無法訂閱，請重新整理後再試。'; if (code === 'NEWEBPAY_CANCEL_REJECTED') return '目前無法取消這筆訂閱，請稍後再試。'; return cause instanceof Error && cause.message ? cause.message : '付款流程處理失敗'; }
function formatTaipeiDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
