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
    if (!validEmail(payerEmail)) { setError('請輸入有效的付款 Email；藍新首筆信用卡驗證會使用這項資料。'); return; }
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
    } catch (cause) { setError(paymentError(cause)); }
    finally { setBusy(false); }
  }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card">
    <p className="eyebrow">AFTERTRACE</p><h1>方案與訂閱</h1>
    <p className="muted">登入後可查看 FREE 試用與 AI Pro 狀態。</p>
    {error ? <div className="error">{error}</div> : null}
    <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/subscription" />
  </section></main>;

  const trial = data?.freeAiTrial;
  const aiProActive = data?.currentPlanCode === 'AI_PRO';

  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>方案與訂閱</h1><p className="muted">目前方案：{data?.currentPlanCode ?? '載入中'}</p></div><button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button></div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <section className="panel stack">
      <div><p className="eyebrow">FREE AI TRIAL</p><h2>免費體驗 AI Pro</h2></div>
      {trial?.status === 'AVAILABLE'
        ? <p>目前尚有 <strong>{trial.remainingPoints.toLocaleString('zh-TW')}</strong> 點一次性 AI 試用額度。</p>
        : trial?.status === 'EXHAUSTED'
          ? <p>你的免費 AI Pro 試用已使用完畢；FREE 手動功能仍可繼續使用。</p>
          : <p>AI 試用尚未發放；FREE 手動功能仍可正常使用。</p>}
      <p className="muted">試用點數不是 TWD 現金額度，不會每月刷新；每個符合資格的 AFTERTRACE 帳號只發放一次。</p>
    </section>

    <section className="panel stack">
      <div><p className="eyebrow">AI FAIR USE</p><h2>AI entitlement 屬於你本人</h2></div>
      <p className="muted">FREE 保留完整手動紀錄、搜尋、日期篩選、群組、待辦與通知；provider-backed AI 可在一次性試用尚有額度時使用。</p>
      <p className="muted">AI Pro 為 NT$99/月。日常使用不限次數，但仍受每月方案資源上限與 Provider Cost 安全上限限制；達到上限後，新的 AI 工作會等下一個週期恢復。</p>
    </section>

    {!aiProActive ? <section className="panel stack">
      <div><p className="eyebrow">NEWEBPAY</p><h2>升級 AI Pro</h2></div>
      <label>付款 Email<input type="email" autoComplete="email" value={payerEmail} onChange={(event) => setPayerEmail(event.target.value)} placeholder="name@example.com" /></label>
      <p className="muted">付款會直接前往藍新金流的信用卡定期定額頁面。AFTERTRACE 不接收或保存你的信用卡號。</p>
      {!paymentAvailable ? <div className="worklog-notice">藍新商店設定尚未完成；設定補齊後這裡會自動開放。</div> : null}
    </section> : null}

    <section className="subscription-grid">
      {data?.plans.map((plan) => {
        const paid = plan.code === 'AI_PRO';
        const disabled = busy || plan.current || !paid || !paymentAvailable || !validEmail(payerEmail);
        const buttonLabel = plan.current ? '目前方案' : !paid ? '免費方案' : !paymentAvailable ? '藍新尚未設定' : '使用藍新升級 AI Pro';
        return <article className={plan.current ? 'panel subscription-card current' : 'panel subscription-card'} key={plan.code}>
          <div><p className="eyebrow">{plan.code}</p><h2>{plan.display_name}</h2></div>
          <strong className="subscription-price">{!paid ? '免費' : 'NT$ 99 / 月'}</strong>
          {!paid ? <p>完整手動產品，並附一次性 AI Pro 試用；試用耗盡後手動功能不受影響。</p> : <p>在你有權限的個人或群組紀錄中，都使用你自己的 AI Pro entitlement。</p>}
          <small>✓ 手動新增、編輯、搜尋、刪除與還原不消耗 provider AI</small>
          {paid ? <small>✓ AI 使用受公平使用、月度資源與 Provider Cost hard cap 保護</small> : <small>✓ 不會自動把歷史免費紀錄送去 AI 回填</small>}
          {paid && plan.monthly_ai_point_cap ? <small>✓ 目前方案月度 AI 資源上限已由營運端設定</small> : null}
          {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
          <button disabled={disabled} onClick={() => void choose(plan)}>{buttonLabel}</button>
        </article>;
      })}
    </section>

    {aiProActive ? <section className="panel stack">
      <strong>AI Pro 自動續訂</strong>
      {renewalState === 'TERMINATED'
        ? <div className="worklog-notice">已取消自動續訂。目前 AI Pro 仍可使用到這一期結束，不會再向藍新發出下一期扣款。</div>
        : <p className="muted">取消續訂只會停止下一期藍新扣款；目前已付款週期仍保留到期。</p>}
      {renewalState === 'ACTIVE'
        ? <button className="ghost danger" disabled={busy || !paymentAvailable} onClick={() => void cancelRenewal()}>取消 AI Pro 自動續訂</button>
        : renewalState === 'PENDING'
          ? <div className="muted">藍新定期定額狀態仍在處理中。</div>
          : renewalState === 'FAILED'
            ? <div className="muted">藍新付款狀態需要確認；目前已付款週期權益不會因此被提前刪除。</div>
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
function paymentError(cause: unknown) { const code=cause instanceof Error?cause.message:String(cause??''); if (code==='NEWEBPAY_NOT_CONFIGURED') return '藍新商店設定尚未完成。'; if (code==='AI_PRO_ALREADY_ACTIVE') return 'AI Pro 已經啟用，不需要重複購買。'; if (code==='NEWEBPAY_CANCEL_REJECTED') return '藍新目前無法取消這筆定期定額，請稍後再試。'; return cause instanceof Error&&cause.message?cause.message:'付款流程處理失敗'; }