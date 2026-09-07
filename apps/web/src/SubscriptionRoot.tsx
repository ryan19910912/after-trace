import { useEffect, useMemo, useState } from 'react';
import { WorklogApi, type SubscriptionPlan, type SubscriptionPlans } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const RETURN_KEY = 'aftertrace.worklog.returnTo';

export function SubscriptionRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [data, setData] = useState<SubscriptionPlans | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true);
    setError(null);
    try {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      const url = new URL(location.href);
      const entry = url.searchParams.get('t')?.trim();
      if (entry) {
        const exchanged = await api.exchangeEntry(entry);
        token = exchanged.sessionToken;
        localStorage.setItem(SESSION_KEY, token);
        setSession(token);
        url.searchParams.delete('t');
        history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        token = callback;
        localStorage.setItem(SESSION_KEY, callback);
        setSession(callback);
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      }
      if (token) setData(await api.subscriptionPlans(token));
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setData(null);
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else {
        setError(cause instanceof Error ? cause.message : '方案載入失敗');
      }
    } finally {
      setBusy(false);
    }
  }

  async function choose(plan: SubscriptionPlan) {
    if (!session || !data?.checkoutEnabled || plan.current || plan.code !== 'AI_PRO') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const intent = await api.createCheckoutIntent(session, 'AI_PRO', checkoutRequestKey());
      if (intent.checkout_url) {
        location.href = intent.checkout_url;
        return;
      }
      setNotice(intent.message || '付款服務目前無法使用，請稍後再試。');
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setData(null);
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else {
        setError(cause instanceof Error ? cause.message : '付款流程建立失敗');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>方案與訂閱</h1>
        <p className="muted">登入後可查看 FREE 試用與 AI Pro 狀態。</p>
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => {
          localStorage.setItem(RETURN_KEY, '/subscription');
          location.href = api.lineLoginUrl();
        }}>登入 AFTERTRACE</button>
      </section>
    </main>;
  }

  const trial = data?.freeAiTrial;

  return <main className="shell worklog-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>方案與訂閱</h1>
        <p className="muted">目前方案：{data?.currentPlanCode ?? '載入中'}</p>
      </div>
      <button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button>
    </div>

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

    <section className="subscription-grid">
      {data?.plans.map((plan) => {
        const paid = plan.code === 'AI_PRO';
        const checkoutUnavailable = paid && !data.checkoutEnabled;
        const disabled = busy || plan.current || !paid || checkoutUnavailable;
        const buttonLabel = plan.current
          ? '目前方案'
          : !paid
            ? '免費方案'
            : checkoutUnavailable
              ? 'AI Pro 尚未開放購買'
              : '升級 AI Pro';
        return <article
          className={plan.current ? 'panel subscription-card current' : 'panel subscription-card'}
          key={plan.code}
        >
          <div>
            <p className="eyebrow">{plan.code}</p>
            <h2>{plan.display_name}</h2>
          </div>
          <strong className="subscription-price">
            {!paid ? '免費' : 'NT$ 99 / 月'}
          </strong>
          {!paid
            ? <p>完整手動產品，並附一次性 AI Pro 試用；試用耗盡後手動功能不受影響。</p>
            : <p>在你有權限的個人或群組紀錄中，都使用你自己的 AI Pro entitlement。</p>}
          <small>✓ 手動新增、編輯、搜尋、刪除與還原不消耗 provider AI</small>
          {paid ? <small>✓ AI 使用受公平使用、月度資源與 Provider Cost hard cap 保護</small> : <small>✓ 不會自動把歷史免費紀錄送去 AI 回填</small>}
          {paid && plan.monthly_ai_point_cap ? <small>✓ 目前方案月度 AI 資源上限已由營運端設定</small> : null}
          {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
          <button disabled={disabled} onClick={() => void choose(plan)}>{buttonLabel}</button>
        </article>;
      })}
    </section>

    {!data?.checkoutEnabled ? <section className="panel">
      <strong>AI Pro 付款尚未開放</strong>
      <p className="muted">目前付款流程維持關閉。等 per-user AI entitlement、每月資源／Provider Cost hard cap、支付 provider 與續訂事件都通過驗證後才會開放購買。</p>
    </section> : null}
  </main>;
}

function checkoutRequestKey() {
  const uuid = crypto.randomUUID().replaceAll('-', '');
  return `web_${uuid}`.slice(0, 64);
}

function capabilitySummary(value: Record<string, unknown>) {
  const result: string[] = [];
  if (value.export === true) result.push('資料匯出');
  return result;
}

function isSessionError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text);
}
