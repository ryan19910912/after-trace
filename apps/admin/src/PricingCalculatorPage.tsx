import { useEffect, useMemo, useState } from 'react';
import type { AdminAiRuntimeConfig, AdminApi } from './api';
import { calculatePricingRecommendation } from './pricing-calculator';

const SESSION_KEY = 'aftertrace.admin.session';

type Props = { api: AdminApi };
type PricingMode = 'SUBSCRIPTION' | 'ONE_TIME';

export function PricingCalculatorPage({ api }: Props) {
  const [username, setUsername] = useState<string | null>(null);
  const [config, setConfig] = useState<AdminAiRuntimeConfig | null>(null);
  const [mode, setMode] = useState<PricingMode>('SUBSCRIPTION');
  const [priceTwd, setPriceTwd] = useState('99');
  const [targetMargin, setTargetMargin] = useState('40');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY)?.trim() || null;
    api.setSessionToken(token);
    if (!token) {
      setLoading(false);
      setError('尚未登入管理後台。請先回到管理首頁登入。');
      return;
    }
    let active = true;
    void Promise.all([api.session(), api.aiRuntime()]).then(([session, runtime]) => {
      if (!active) return;
      setUsername(session.username);
      setConfig(runtime);
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      const text = cause instanceof Error ? cause.message : String(cause);
      if (/ADMIN_SESSION_(?:REQUIRED|INVALID)/.test(text)) {
        sessionStorage.removeItem(SESSION_KEY);
        api.setSessionToken(null);
      }
      setError(text || '定價資料載入失敗');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  const price = Number(priceTwd);
  const margin = Number(targetMargin);
  const calculation = useMemo(() => calculatePricingRecommendation({
    priceTwd: price,
    targetGrossMarginPercent: margin,
    usdTwdRate: Number(config?.usd_twd_rate ?? 0),
    outputUsdPerMillion: Number(config?.output_usd_per_million ?? 0),
  }), [price, margin, config]);

  function changeMode(next: PricingMode) {
    setMode(next);
    setTargetMargin(next === 'SUBSCRIPTION' ? '40' : '50');
  }

  return <main className="shell">
    <header className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>AI 方案定價計算器</h1>
        <p className="muted">{username ? `${username} · ` : ''}只提供建議點數，不會自動修改方案或歷史 Grant</p>
      </div>
      <div className="header-actions"><a href="/">返回管理首頁</a><a href="/profitability">成本報表</a></div>
    </header>

    {error && <div className="banner error">{error}</div>}
    {loading && <article className="card"><p className="muted">載入 AI 計價設定中…</p></article>}

    {!loading && !config && <article className="card"><h2>尚未設定 AI runtime pricing</h2><p className="muted">請先回管理首頁的「AI 計價」設定 provider/model、output price 與 USD/TWD 匯率，才能計算建議點數。</p></article>}

    {!loading && config && <section className="stack">
      <article className="card">
        <h2>目前計價快照</h2>
        <div className="detail-object">
          <div className="detail-row"><strong>Provider</strong><span>{config.provider}</span></div>
          <div className="detail-row"><strong>Model</strong><span>{config.model}</span></div>
          <div className="detail-row"><strong>Output USD / 100 萬</strong><span>{config.output_usd_per_million}</span></div>
          <div className="detail-row"><strong>USD/TWD</strong><span>{config.usd_twd_rate ?? '未設定'}</span></div>
        </div>
      </article>

      <article className="card">
        <h2>規劃條件</h2>
        <p className="muted">訂閱方案預設目標毛利 40%；一次性／加購預設 50%。可自行調整。建議點數以目前 output-price-equivalent point 定義計算，並向下取整以不超過規劃 AI 成本預算。</p>
        <div className="form-grid">
          <label>產品類型<select value={mode} onChange={(event) => changeMode(event.target.value as PricingMode)}><option value="SUBSCRIPTION">月訂閱</option><option value="ONE_TIME">一次性／加購</option></select></label>
          <label>售價（TWD）<input inputMode="decimal" value={priceTwd} onChange={(event) => setPriceTwd(event.target.value)} /></label>
          <label>目標毛利（%）<input inputMode="decimal" value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} /></label>
        </div>
      </article>

      {calculation ? <>
        <div className="metric-grid">
          <article className="metric"><span>售價</span><strong>NT$ {price.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</strong></article>
          <article className="metric"><span>目標毛利</span><strong>{margin.toFixed(1)}%</strong></article>
          <article className="metric"><span>AI 成本預算</span><strong>NT$ {calculation.aiBudgetTwd.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</strong></article>
          <article className="metric"><span>AI 成本預算 USD</span><strong>${calculation.aiBudgetUsd.toFixed(6)}</strong></article>
          <article className="metric"><span>建議 included AI 點數</span><strong>{calculation.recommendedPoints.toLocaleString('zh-TW')}</strong></article>
        </div>
        <article className="card">
          <h2>使用方式</h2>
          <p className="muted">把「建議 included AI 點數」當成規劃參考，再由 Admin 回方案管理手動確認真正的 subscription-period points。既有 Grant 永遠不因這個計算器或之後的價格／匯率變更而被重算。</p>
        </article>
      </> : <div className="banner error">請確認售價 ≥ 0、目標毛利在 0～100% 之間，且 AI runtime 已設定正數 output price 與 USD/TWD 匯率。</div>}
    </section>}
  </main>;
}
