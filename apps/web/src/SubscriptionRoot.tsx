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
      setError(cause instanceof Error ? cause.message : '方案載入失敗');
    } finally {
      setBusy(false);
    }
  }

  async function choose(plan: SubscriptionPlan) {
    if (!session || plan.current || Number(plan.price_twd) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const intent = await api.createCheckoutIntent(session, plan.code, checkoutRequestKey());
      if (intent.checkout_url) {
        location.href = intent.checkout_url;
        return;
      }
      setNotice(intent.message || '付款服務尚未啟用，方案選擇已記錄。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '付款流程建立失敗');
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>方案與訂閱</h1>
        <p className="muted">請先使用 LINE 登入。</p>
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => {
          localStorage.setItem(RETURN_KEY, '/subscription');
          location.href = api.lineLoginUrl();
        }}>使用 LINE 登入</button>
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

    <section className="subscription-grid">
      {data?.plans.map((plan) => <article
        className={plan.current ? 'panel subscription-card current' : 'panel subscription-card'}
        key={plan.code}
      >
        <div>
          <p className="eyebrow">{plan.code}</p>
          <h2>{plan.display_name}</h2>
        </div>
        <strong className="subscription-price">
          {Number(plan.price_twd) <= 0 ? '免費' : `NT$ ${Number(plan.price_twd).toLocaleString('zh-TW')}`}
        </strong>
        <p>AI 點數：{Number(plan.ai_allowance_units).toLocaleString('zh-TW')}</p>
        <small>✓ 群組數量不限；手動 PWA 功能不依訂閱解鎖</small>
        {capabilitySummary(plan.capabilities).map((item) => <small key={item}>✓ {item}</small>)}
        <button
          disabled={busy || plan.current || Number(plan.price_twd) <= 0}
          onClick={() => void choose(plan)}
        >{plan.current ? '目前方案' : Number(plan.price_twd) <= 0 ? '免費方案' : '選擇方案'}</button>
      </article>)}
    </section>

    {!data?.checkoutEnabled ? <section className="panel">
      <strong>付款服務尚未啟用</strong>
      <p className="muted">目前只有方案展示與 provider-neutral checkout intent。正式付款仍需補上方案計費類型、支付商付款流程；月訂閱還需要定期扣款授權、續扣成功／失敗事件，以及成功後建立下一期 AI 點數 grant。</p>
    </section> : null}
  </main>;
}

function checkoutRequestKey() {
  const uuid = crypto.randomUUID().replaceAll('-', '');
  return `web_${uuid}`.slice(0, 64);
}

function capabilitySummary(value: Record<string, unknown>) {
  const result: string[] = [];
  if (value.privateOaRecording === true) result.push('個人 LINE AI 紀錄');
  if (value.aiTextRecording === true) result.push('文字 AI 處理');
  if (value.aiMediaIngestion === true) result.push('圖片 / 音檔 / 檔案 AI');
  if (value.export === true) result.push('資料匯出');
  return result;
}
