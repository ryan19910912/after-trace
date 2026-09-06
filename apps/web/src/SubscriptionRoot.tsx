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
    if (!session || !data?.checkoutEnabled || plan.current || Number(plan.price_twd) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const intent = await api.createCheckoutIntent(session, plan.code, checkoutRequestKey());
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
        <p className="muted">登入後可查看目前方案與 AI 功能開放狀態。</p>
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => {
          localStorage.setItem(RETURN_KEY, '/subscription');
          location.href = api.lineLoginUrl();
        }}>登入 AFTERTRACE</button>
      </section>
    </main>;
  }

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
      <div><p className="eyebrow">AI FAIR USE</p><h2>AI 是每位使用者自己的付費能力</h2></div>
      <p className="muted">免費方案保留完整手動紀錄、搜尋、日期篩選與允許的群組功能，不包含 AFTERTRACE provider-backed AI。</p>
      <p className="muted">付費 AI 採公平使用：日常使用不限次數，但仍受每月方案資源上限與 Provider Cost 安全上限限制；達到上限後，新的 AI 工作會等下一個週期恢復。</p>
    </section>

    <section className="subscription-grid">
      {data?.plans.map((plan) => {
        const paid = Number(plan.price_twd) > 0;
        const checkoutUnavailable = paid && !data.checkoutEnabled;
        const disabled = busy || plan.current || !paid || checkoutUnavailable;
        const buttonLabel = plan.current
          ? '目前方案'
          : !paid
            ? '免費方案'
            : checkoutUnavailable
              ? 'AI 訂閱尚未開放'
              : '選擇 AI 方案';
        return <article
          className={plan.current ? 'panel subscription-card current' : 'panel subscription-card'}
          key={plan.code}
        >
          <div>
            <p className="eyebrow">{plan.code}</p>
            <h2>{plan.display_name}</h2>
          </div>
          <strong className="subscription-price">
            {!paid ? '免費' : `NT$ ${Number(plan.price_twd).toLocaleString('zh-TW')}`}
          </strong>
          {!paid
            ? <p>手動紀錄與搜尋可持續使用，不需要 AI 點數或 Provider 額度。</p>
            : <p>AI entitlement 屬於你本人；在你有權限的個人或群組紀錄中皆使用自己的 AI 訂閱。</p>}
          <small>✓ 手動新增、編輯、搜尋、刪除與還原不消耗 provider AI</small>
          {paid ? <small>✓ AI 使用受方案公平使用與每月硬上限保護</small> : <small>✓ 不會自動把歷史免費紀錄送去 AI 回填</small>}
          {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
          <button disabled={disabled} onClick={() => void choose(plan)}>{buttonLabel}</button>
        </article>;
      })}
    </section>

    {!data?.checkoutEnabled ? <section className="panel">
      <strong>付費 AI 尚未開放</strong>
      <p className="muted">目前付款流程維持關閉。等 per-user AI entitlement、每月資源／Provider Cost hard cap、支付 provider 與續訂事件都通過驗證後才會開放購買；不會因畫面上存在舊的 point/Grant 資料就提前宣稱 AI 已可購買。</p>
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
