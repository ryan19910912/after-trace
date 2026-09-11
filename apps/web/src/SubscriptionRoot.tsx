import { useEffect, useMemo, useState } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type SubscriptionPlan, type SubscriptionPlans } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';

type NewebPayForm = { action: string; fields: { MerchantID_: string; PostData_: string }; merchantOrderNo: string };
type PaymentRenewalState = 'ACTIVE' | 'TERMINATED' | 'PENDING' | 'FAILED' | 'NONE';

export function SubscriptionRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [data, setData] = useState<SubscriptionPlans | null>(null);
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [renewalState, setRenewalState] = useState<PaymentRenewalState>('NONE');
  const [payerEmail, setPayerEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true); setError(null);
    try {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      const url = new URL(location.href);
      const entry = url.searchParams.get('t')?.trim();
      if (entry) {
        const exchanged = await api.exchangeEntry(entry);
        token = exchanged.sessionToken;
        localStorage.setItem(SESSION_KEY, token); setSession(token);
        url.searchParams.delete('t'); history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        token = callback; localStorage.setItem(SESSION_KEY, callback); setSession(callback);
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      }
      const availability = await paymentAvailability(apiBaseUrl).catch(() => false);
      setPaymentAvailable(availability);
      if (token) {
        const [plans, paymentState] = await Promise.all([
          api.subscriptionPlans(token),
          subscriptionRenewalState(apiBaseUrl, token),
        ]);
        setData(plans);
        setRenewalState(paymentState);
      }
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY); setSession(null); setData(null); setRenewalState('NONE');
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else setError(cause instanceof Error ? cause.message : '方案載入失敗');
    } finally { setBusy(false); }
  }

  async function choose(plan: SubscriptionPlan) {
    if (!session || plan.current || plan.code !== 'AI_PRO' || !paymentAvailable) return;
    if (!validEmail(payerEmail)) { setError('請先輸入有效的付款 Email。'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey: checkoutRequestKey(), payerEmail: payerEmail.trim() }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `NEWEBPAY_CHECKOUT_FAILED_${response.status}`);
      const form = paymentForm(body.form);
      submitProviderForm(form);
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY); setSession(null); setData(null); setRenewalState('NONE');
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else setError(paymentError(cause));
      setBusy(false);
    }
  }

  async function cancelRenewal() {
    if (!session || data?.currentPlanCode !== 'AI_PRO' || renewalState !== 'ACTIVE' || !paymentAvailable || busy) return;
    if (!window.confirm('確定取消 AI Pro 自動續訂？已付款的本期仍可使用到目前週期結束。')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${session}` },
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `NEWEBPAY_CANCEL_FAILED_${response.status}`);
      const periodEnd = typeof body.periodEnd === 'string' ? new Date(body.periodEnd) : null;
      setNotice(periodEnd && !Number.isNaN(periodEnd.getTime())
        ? `已取消 AI Pro 自動續訂，目前方案可使用至 ${periodEnd.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}。`
        : '已取消 AI Pro 自動續訂。');
      const [plans, paymentState] = await Promise.all([
        api.subscriptionPlans(session),
        subscriptionRenewalState(apiBaseUrl, session),
      ]);
      setData(plans);
      setRenewalState(paymentState);
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY); setSession(null); setData(null); setRenewalState('NONE');
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else {
        setError(paymentError(cause));
      }
    } finally { setBusy(false); }
  }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card">
    <p className="eyebrow">AFTERTRACE</p><h1>方案</h1>
    <p className="muted">登入後可查看免費版與 AI Pro。</p>
    {error ? <div className="error">{error}</div> : null}
    <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/subscription" />
  </section></main>;

  const trial = data?.freeAiTrial;
  const aiProActive = data?.currentPlanCode === 'AI_PRO';

  return <main className="shell worklog-shell subscription-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>方案</h1>
        <p className="muted">目前使用：{aiProActive ? 'AI Pro' : '免費版'}</p>
      </div>
      <button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button>
    </div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    {!aiProActive ? <section className="panel stack subscription-trial">
      <div><p className="eyebrow">免費 AI 體驗</p><h2>先試用，再決定要不要升級</h2></div>
      {trial?.status === 'AVAILABLE'
        ? <p>你目前還有 <strong>{trial.remainingPoints.toLocaleString('zh-TW')}</strong> 點 AI 體驗額度，可以直接使用 AI 搜尋、整理與改寫。</p>
        : trial?.status === 'EXHAUSTED'
          ? <p>你的免費 AI 體驗已使用完畢；工作紀錄、搜尋、群組與待辦仍可繼續免費使用。</p>
          : <p>免費 AI 體驗尚未發放；其他免費功能仍可正常使用。</p>}
      <p className="muted">體驗額度只發放一次，不會每月刷新。</p>
    </section> : null}

    <section className="subscription-grid">
      {data?.plans.map((plan) => {
        const paid = plan.code === 'AI_PRO';
        const emailReady = validEmail(payerEmail);
        const disabled = busy || plan.current || !paid || !paymentAvailable || !emailReady;
        const buttonLabel = plan.current ? '目前方案' : !paid ? '免費方案' : !paymentAvailable ? '暫時無法升級' : emailReady ? '升級 AI Pro' : '先填付款 Email';
        return <article className={plan.current ? 'panel subscription-card current' : 'panel subscription-card'} key={plan.code}>
          <div><p className="eyebrow">{paid ? 'AI PRO' : 'FREE'}</p><h2>{paid ? 'AI Pro' : '免費版'}</h2></div>
          <strong className="subscription-price">{!paid ? 'NT$0' : 'NT$99 / 月'}</strong>
          {!paid
            ? <p>日常工作紀錄需要的基本功能都可以免費使用。</p>
            : <p>需要更快整理、搜尋與理解工作紀錄時，再使用 AI 幫忙。</p>}
          <small>✓ 工作紀錄、新增、編輯與搜尋</small>
          <small>✓ 群組、待辦與通知</small>
          {!paid ? <small>✓ 一次免費 AI Pro 體驗額度</small> : <>
            <small>✓ AI 自然語言搜尋</small>
            <small>✓ 圖片、語音與檔案整理</small>
            <small>✓ 摘要、改寫與待辦建議</small>
            <small>✓ 日常使用不限次數；仍受公平使用與每月方案資源上限限制</small>
          </>}
          {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
          <button disabled={disabled} onClick={() => void choose(plan)}>{buttonLabel}</button>
        </article>;
      })}
    </section>

    {!aiProActive ? <section className="panel stack subscription-checkout">
      <div><p className="eyebrow">升級 AI PRO</p><h2>付款資料</h2></div>
      <label>付款 Email<input type="email" autoComplete="email" value={payerEmail} onChange={(event) => setPayerEmail(event.target.value)} placeholder="name@example.com" /></label>
      <p className="muted">輸入 Email 後，上方 AI Pro 的升級按鈕就會開放。付款會前往藍新金流頁面，AFTERTRACE 不接收或保存你的信用卡號。</p>
      {!paymentAvailable ? <div className="worklog-notice">目前尚未開放線上升級；免費版與 AI 體驗不受影響。</div> : null}
    </section> : null}

    {aiProActive ? <section className="panel stack subscription-renewal">
      <strong>AI Pro 自動續訂</strong>
      {renewalState === 'TERMINATED'
        ? <div className="worklog-notice">已取消自動續訂。目前 AI Pro 仍可使用到這一期結束。</div>
        : <p className="muted">取消續訂只會停止下一期扣款，目前已付款週期仍可使用到期。</p>}
      {renewalState === 'ACTIVE'
        ? <button className="ghost danger" disabled={busy || !paymentAvailable} onClick={() => void cancelRenewal()}>取消 AI Pro 自動續訂</button>
        : renewalState === 'PENDING'
          ? <div className="muted">付款狀態仍在處理中。</div>
          : renewalState === 'FAILED'
            ? <div className="muted">付款狀態需要確認，目前已付款週期不會被提前取消。</div>
            : null}
    </section> : null}
  </main>;
}

async function paymentAvailability(apiBaseUrl: string) {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/payments/newebpay/availability`);
  const body = await jsonBody(response); return response.ok && body.available === true;
}
async function subscriptionRenewalState(apiBaseUrl: string, sessionToken: string): Promise<PaymentRenewalState> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/subscription/plans`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const body = await jsonBody(response);
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `SUBSCRIPTION_STATE_FAILED_${response.status}`);
  const value = typeof body.paymentRenewalState === 'string' ? body.paymentRenewalState.toUpperCase() : 'NONE';
  return value === 'ACTIVE' || value === 'TERMINATED' || value === 'PENDING' || value === 'FAILED' ? value : 'NONE';
}
function paymentForm(value: unknown): NewebPayForm {
  if (!value || typeof value !== 'object') throw new Error('NEWEBPAY_FORM_INVALID');
  const row = value as Record<string, unknown>; const fields = row.fields as Record<string, unknown> | undefined;
  if (typeof row.action !== 'string' || !/^https:\/\/(?:c?core)\.newebpay\.com\//.test(row.action)
    || !fields || typeof fields.MerchantID_ !== 'string' || typeof fields.PostData_ !== 'string') throw new Error('NEWEBPAY_FORM_INVALID');
  return { action: row.action, fields: { MerchantID_: fields.MerchantID_, PostData_: fields.PostData_ }, merchantOrderNo: String(row.merchantOrderNo ?? '') };
}
function submitProviderForm(input: NewebPayForm) {
  const form = document.createElement('form'); form.method = 'POST'; form.action = input.action; form.style.display = 'none';
  for (const [name, value] of Object.entries(input.fields)) { const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = name; hidden.value = value; form.appendChild(hidden); }
  document.body.appendChild(form); form.submit();
}
function validEmail(value: string) { const normalized=value.trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254; }
function checkoutRequestKey() { return `web_${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 64); }
function capabilitySummary(value: Record<string, unknown>) { const result: string[]=[]; if (value.export===true) result.push('資料匯出'); return result; }
function isSessionError(cause: unknown) { const text=cause instanceof Error?cause.message:String(cause??''); return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text); }
async function jsonBody(response: Response): Promise<Record<string, unknown>> { const text=await response.text(); if (!text) return {}; try { return JSON.parse(text) as Record<string,unknown>; } catch { throw new Error(`INVALID_PAYMENT_RESPONSE_${response.status}`); } }
function paymentError(cause: unknown) { const code=cause instanceof Error?cause.message:String(cause??''); if (code==='NEWEBPAY_NOT_CONFIGURED') return '目前尚未開放線上升級。'; if (code==='AI_PRO_ALREADY_ACTIVE') return 'AI Pro 已經啟用，不需要重複購買。'; if (code==='NEWEBPAY_CANCEL_REJECTED') return '目前無法取消這筆定期訂閱，請稍後再試。'; return cause instanceof Error&&cause.message?cause.message:'付款流程處理失敗'; }
