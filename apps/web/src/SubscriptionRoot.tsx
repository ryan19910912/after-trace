import { useEffect, useMemo, useState } from 'react';
import { AiCaptureApi, type AiEntitlementDecision } from './ai-capture-api';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type SubscriptionPlan, type SubscriptionPlans } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
type NewebPayForm = { action: string; fields: { MerchantID_: string; PostData_: string }; merchantOrderNo: string };
type PaymentRenewalState = 'ACTIVE' | 'TERMINATED' | 'PENDING' | 'FAILED' | 'NONE';
type SubscriptionSnapshot = { plans: SubscriptionPlans; renewalState: PaymentRenewalState };

export function SubscriptionRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const aiApi = useMemo(() => new AiCaptureApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => new URLSearchParams(location.hash.replace(/^#/, '')).get('session')?.trim() || localStorage.getItem(SESSION_KEY));
  const [data, setData] = useState<SubscriptionPlans | null>(null);
  const [usage, setUsage] = useState<AiEntitlementDecision | null>(null);
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [renewalState, setRenewalState] = useState<PaymentRenewalState>('NONE');
  const [payerEmail, setPayerEmail] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
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
        setData(snapshot.plans); setRenewalState(snapshot.renewalState);
        if (paymentReturned) {
          snapshot = await waitForPaymentResult(apiBaseUrl, token, snapshot);
          setData(snapshot.plans); setRenewalState(snapshot.renewalState);
          if (snapshot.plans.currentPlanCode === 'AI_PRO') setNotice('AI Pro 已啟用。');
          else if (snapshot.renewalState === 'FAILED') setNotice('付款未成功，請重新嘗試。');
          else setNotice('付款結果仍在確認中，請稍後重新整理。');
          url.searchParams.delete('payment'); history.replaceState({}, document.title, `${url.pathname}${url.search}`);
        }
        await loadUsage(token, snapshot.plans.currentPlanCode === 'AI_PRO');
      }
    } catch (cause) {
      if (isSessionError(cause)) { clearSession(); setError('登入已過期，請重新登入。'); }
      else setError(cause instanceof Error ? cause.message : '方案載入失敗');
    } finally { setConfirmingPayment(false); setBusy(false); setReady(true); }
  }

  async function loadUsage(token: string, aiProActive: boolean) {
    if (!aiProActive) { setUsage(null); return; }
    try {
      const surfaces = await api.surfaces(token);
      const sourceId = surfaces.personal?.sourceId ?? surfaces.groups[0]?.sourceId;
      setUsage(sourceId ? await aiApi.entitlement(token, sourceId) : null);
    } catch { setUsage(null); }
  }

  function openCheckout(plan: SubscriptionPlan) {
    if (!session || plan.current || plan.code !== 'AI_PRO' || !paymentAvailable || busy) return;
    setError(null); setNotice(null); setCheckoutOpen(true);
  }
  function closeCheckout() { if (busy) return; setCheckoutOpen(false); setError(null); }

  async function choose(plan: SubscriptionPlan) {
    if (!session || plan.current || plan.code !== 'AI_PRO' || !paymentAvailable) return;
    if (!validEmail(payerEmail)) { setError('請輸入有效的付款 Email。'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/checkout`, {
        method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey: checkoutRequestKey(), payerEmail: payerEmail.trim() }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `NEWEBPAY_CHECKOUT_FAILED_${response.status}`);
      submitProviderForm(paymentForm(body.form));
    } catch (cause) {
      if (isSessionError(cause)) { clearSession(); setCheckoutOpen(false); setError('登入已過期，請重新登入。'); }
      else setError(paymentError(cause));
      setBusy(false);
    }
  }

  async function cancelRenewal() {
    if (!session || data?.currentPlanCode !== 'AI_PRO' || renewalState !== 'ACTIVE' || !paymentAvailable || busy) return;
    if (!window.confirm('確定取消 AI Pro 自動續訂？已付款的本期仍可使用到目前週期結束。')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${session}` } });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `NEWEBPAY_CANCEL_FAILED_${response.status}`);
      setNotice('已取消 AI Pro 自動續訂。');
      const snapshot = await subscriptionSnapshot(apiBaseUrl, session); setData(snapshot.plans); setRenewalState(snapshot.renewalState);
    } catch (cause) {
      if (isSessionError(cause)) { clearSession(); setError('登入已過期，請重新登入。'); }
      else setError(paymentError(cause));
    } finally { setBusy(false); }
  }

  function clearSession() { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('aftertrace.worklog.scope'); setSession(null); setData(null); setUsage(null); setRenewalState('NONE'); }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>方案</h1><p className="muted">登入後可查看免費版與 AI Pro。</p>{error ? <div className="error">{error}</div> : null}<LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/subscription" /></section></main>;
  if (!ready) return <main className="shell worklog-shell subscription-shell subscription-loading"><section className="subscription-loading-card" aria-live="polite"><span className="subscription-loading-dot" /><strong>{confirmingPayment ? '正在確認付款結果' : '正在載入方案'}</strong><p className="muted">{confirmingPayment ? '正在確認付款結果，請稍候…' : '正在確認你的方案與可用功能…'}</p></section></main>;
  if (!data) return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>方案暫時無法載入</h1><p className="muted">請稍後重新整理頁面再試一次。</p>{error ? <div className="error">{error}</div> : null}<button onClick={() => location.reload()}>重新載入</button></section></main>;

  const trial = data.freeAiTrial;
  const aiProActive = data.currentPlanCode === 'AI_PRO';
  const aiProPlan = data.plans.find((plan) => plan.code === 'AI_PRO');

  return <main className="shell worklog-shell subscription-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>方案</h1><p className="muted">目前使用：{aiProActive ? 'AI Pro' : '免費版'}</p></div></div>
    {!checkoutOpen && error ? <div className="error">{error}</div> : null}{notice ? <div className="worklog-notice">{notice}</div> : null}

    {!aiProActive ? <section className="panel stack subscription-trial"><h2>免費 AI 搜尋體驗</h2>{trial?.status === 'AVAILABLE' ? <p>你目前還有 <strong>{trial.remainingPoints.toLocaleString('zh-TW')}</strong> 點 AI 搜尋體驗額度，可在搜尋頁使用自然語言找紀錄。</p> : trial?.status === 'EXHAUSTED' ? <p>AI 搜尋體驗額度已使用完畢；工作紀錄、一般搜尋、群組與待辦仍可繼續免費使用。</p> : <p>AI 搜尋體驗額度尚未發放；其他免費功能仍可正常使用。</p>}<p className="muted">體驗額度只發放一次，不會每月刷新。AI 整理、圖片、音訊、檔案、摘要、改寫與待辦建議僅提供 AI Pro。</p></section> : null}

    {aiProActive ? <AiUsageStatus usage={usage} plan={aiProPlan} /> : null}

    <section className="subscription-grid">{data.plans.map((plan) => {
      const paid = plan.code === 'AI_PRO';
      const disabled = busy || plan.current || !paid || !paymentAvailable;
      const buttonLabel = plan.current ? '目前方案' : !paid ? '免費方案' : !paymentAvailable ? '暫時無法升級' : '升級 AI Pro';
      return <article className={`panel subscription-card ${paid ? 'pro' : 'free'}${plan.current ? ' current' : ''}`} key={plan.code}>
        <div><p className="eyebrow">{paid ? 'AI PRO' : 'FREE'}</p><h2>{paid ? 'AI Pro' : '免費版'}</h2></div>
        <strong className="subscription-price">{!paid ? 'NT$0' : `NT$${Number(plan.price_twd || 99).toLocaleString('zh-TW')} / 月`}</strong>
        <p>{!paid ? '日常工作紀錄需要的基本功能都可以免費使用。' : '使用完整 AI 功能快速整理、搜尋與理解工作紀錄。'}</p>
        <small>✓ 工作紀錄、新增、編輯與一般搜尋</small><small>✓ 群組、待辦與通知</small>
        {!paid ? <small>✓ 一次 AI 搜尋體驗額度</small> : <><small>✓ AI 自然語言搜尋</small><small>✓ AI 文字整理</small><small>✓ 圖片、音訊與檔案整理</small><small>✓ 相關紀錄、摘要、改寫與待辦建議</small><small>✓ AI 使用受方案資源上限保護</small></>}
        {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
        <button disabled={disabled} onClick={() => openCheckout(plan)}>{buttonLabel}</button>
      </article>;
    })}</section>

    {!aiProActive && !paymentAvailable ? <div className="worklog-notice">目前尚未開放線上升級；免費功能與 AI 搜尋體驗不受影響。</div> : null}
    {aiProActive ? <section className="panel stack subscription-renewal"><strong>AI Pro 自動續訂</strong>{renewalState === 'TERMINATED' ? <div className="worklog-notice">已取消自動續訂。目前 AI Pro 仍可使用到這一期結束。</div> : <p className="muted">取消續訂只會停止下一期扣款，目前已付款週期仍可使用到期。</p>}{renewalState === 'ACTIVE' ? <button className="ghost danger" disabled={busy || !paymentAvailable} onClick={() => void cancelRenewal()}>取消 AI Pro 自動續訂</button> : null}</section> : null}

    {checkoutOpen && aiProPlan ? <div className="subscription-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCheckout(); }}><section className="subscription-modal" role="dialog" aria-modal="true" aria-labelledby="subscription-checkout-title"><button className="subscription-modal-close" type="button" aria-label="關閉" disabled={busy} onClick={closeCheckout}>×</button><p className="eyebrow">升級 AI PRO</p><h2 id="subscription-checkout-title">AI Pro｜NT$99 / 月</h2><p className="subscription-modal-copy">輸入付款 Email 後，會前往藍新完成付款。</p><label className="subscription-email-label"><span>付款 Email</span><input type="email" autoComplete="email" autoFocus value={payerEmail} onChange={(event) => { setPayerEmail(event.target.value); if (error) setError(null); }} placeholder="name@example.com" onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void choose(aiProPlan); }} /></label><p className="muted">此 Email 只用於本次付款與訂單查詢；AFTERTRACE 不會接收或保存信用卡號。</p>{error ? <div className="error">{error}</div> : null}<div className="subscription-modal-actions"><button className="ghost" type="button" disabled={busy} onClick={closeCheckout}>取消</button><button type="button" disabled={busy || !validEmail(payerEmail)} onClick={() => void choose(aiProPlan)}>{busy ? '正在前往付款…' : '前往藍新付款'}</button></div></section></div> : null}
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
  const planRows = Array.isArray(body.plans) ? body.plans.filter((value): value is SubscriptionPlan => Boolean(value && typeof value === 'object' && ((value as SubscriptionPlan).code === 'FREE' || (value as SubscriptionPlan).code === 'AI_PRO'))) : [];
  const trialRaw = body.freeAiTrial && typeof body.freeAiTrial === 'object' ? body.freeAiTrial as Record<string, unknown> : {};
  const trialStatus = trialRaw.status === 'AVAILABLE' || trialRaw.status === 'EXHAUSTED' || trialRaw.status === 'NOT_ISSUED' ? trialRaw.status : 'NOT_ISSUED';
  const renewalRaw = typeof body.paymentRenewalState === 'string' ? body.paymentRenewalState.toUpperCase() : 'NONE';
  const renewalState: PaymentRenewalState = renewalRaw === 'ACTIVE' || renewalRaw === 'TERMINATED' || renewalRaw === 'PENDING' || renewalRaw === 'FAILED' ? renewalRaw : 'NONE';
  return { plans: { currentPlanCode: body.currentPlanCode === 'AI_PRO' ? 'AI_PRO' : 'FREE', currentSubscriptionState: typeof body.currentSubscriptionState === 'string' ? body.currentSubscriptionState : undefined, checkoutEnabled: body.checkoutEnabled === true, freeAiTrial: { status: trialStatus, originalPoints: Number(trialRaw.originalPoints ?? 0), remainingPoints: Number(trialRaw.remainingPoints ?? 0) }, plans: planRows }, renewalState };
}
async function waitForPaymentResult(apiBaseUrl: string, sessionToken: string, initial: SubscriptionSnapshot): Promise<SubscriptionSnapshot> { let snapshot = initial; for (let attempt = 0; attempt < 15; attempt += 1) { if (snapshot.plans.currentPlanCode === 'AI_PRO' || snapshot.renewalState === 'FAILED') return snapshot; await new Promise((resolve) => setTimeout(resolve, 1000)); snapshot = await subscriptionSnapshot(apiBaseUrl, sessionToken); } return snapshot; }
function paymentForm(value: unknown): NewebPayForm { if (!value || typeof value !== 'object') throw new Error('NEWEBPAY_FORM_INVALID'); const row = value as Record<string, unknown>; const fields = row.fields as Record<string, unknown> | undefined; if (typeof row.action !== 'string' || !/^https:\/\/(?:c?core)\.newebpay\.com\//.test(row.action) || !fields || typeof fields.MerchantID_ !== 'string' || typeof fields.PostData_ !== 'string') throw new Error('NEWEBPAY_FORM_INVALID'); return { action: row.action, fields: { MerchantID_: fields.MerchantID_, PostData_: fields.PostData_ }, merchantOrderNo: String(row.merchantOrderNo ?? '') }; }
function submitProviderForm(input: NewebPayForm) { const form = document.createElement('form'); form.method = 'POST'; form.action = input.action; form.style.display = 'none'; for (const [name, value] of Object.entries(input.fields)) { const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = name; hidden.value = value; form.appendChild(hidden); } document.body.appendChild(form); form.submit(); }
function validEmail(value: string) { const normalized = value.trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254; }
function checkoutRequestKey() { return `web_${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 64); }
function capabilitySummary(value: Record<string, unknown>) { const result: string[] = []; if (value.export === true) result.push('資料匯出'); return result; }
function isSessionError(cause: unknown) { const text = cause instanceof Error ? cause.message : String(cause ?? ''); return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED|WORKLOG_USER_NOT_FOUND/.test(text); }
async function jsonBody(response: Response): Promise<Record<string, unknown>> { const text = await response.text(); if (!text) return {}; try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`INVALID_PAYMENT_RESPONSE_${response.status}`); } }
function paymentError(cause: unknown) { const code = cause instanceof Error ? cause.message : String(cause ?? ''); if (code === 'NEWEBPAY_NOT_CONFIGURED') return '目前尚未開放線上升級。'; if (code === 'AI_PRO_ALREADY_ACTIVE') return 'AI Pro 已經啟用，不需要重複購買。'; if (code === 'NEWEBPAY_CANCEL_REJECTED') return '目前無法取消這筆訂閱，請稍後再試。'; return cause instanceof Error && cause.message ? cause.message : '付款流程處理失敗'; }
function formatTaipeiDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
