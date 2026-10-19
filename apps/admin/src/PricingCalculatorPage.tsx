import { useEffect, useMemo, useState } from 'react';
import type { AdminAiRuntimeConfig, AdminApi } from './api';
import { calculatePricingRecommendation } from './pricing-calculator';

const SESSION_KEY = 'aftertrace.admin.session';
type Props = { api: AdminApi };

export function PricingCalculatorPage({ api }: Props) {
  const [config, setConfig] = useState<AdminAiRuntimeConfig | null>(null);
  const [targetMargin, setTargetMargin] = useState('40');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY)?.trim() || null;
    api.setSessionToken(token);
    if (!token) {
      setLoading(false);
      setError('尚未登入管理後台。');
      return;
    }
    let active = true;
    void api.aiRuntime().then((runtime) => {
      if (!active) return;
      setConfig(runtime);
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      const text = cause instanceof Error ? cause.message : String(cause);
      if (/ADMIN_SESSION_(?:REQUIRED|INVALID)/.test(text)) {
        sessionStorage.removeItem(SESSION_KEY);
        api.setSessionToken(null);
      }
      setError(text || '成本試算資料載入失敗');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  const price = 99;
  const margin = Number(targetMargin);
  const calculation = useMemo(() => calculatePricingRecommendation({
    priceTwd: price,
    targetGrossMarginPercent: margin,
    usdTwdRate: Number(config?.usd_twd_rate ?? 0),
    outputUsdPerMillion: Number(config?.output_usd_per_million ?? 0),
  }), [margin, config]);

  return <main className="shell">
    <header className="topbar admin-hero">
      <div>
        <p className="eyebrow">AFTERTRACE ADMIN</p>
        <h1>AI 成本試算</h1>
        <p className="muted">依目前模型價格、匯率與目標毛利，估算方案可配置的 AI 成本與點數。</p>
      </div>
      <a href="/ai-runtime"><button className="ghost">模型與價格設定</button></a>
    </header>

    {error && <div className="banner error">{error}</div>}
    {loading && <article className="card"><p className="muted">載入 AI 成本設定中…</p></article>}

    {!loading && !config && <article className="card empty-state-card cost-empty-state">
      <strong>尚未設定 AI 模型與價格</strong>
      <p className="muted">請先設定目前使用的模型、輸出價格與 USD/TWD 匯率，完成後這裡就能試算免費體驗與訂閱方案的 AI 點數配置。</p>
      <a href="/ai-runtime"><button className="primary-action">前往模型與價格設定</button></a>
      <div className="cost-preview-grid">
        <div><b>單次請求成本估算</b><span>比較不同模型的使用成本。</span></div>
        <div><b>每月資源上限</b><span>依預算與匯率估算可用資源。</span></div>
        <div><b>點數配置建議</b><span>依成本與使用量提供配置參考。</span></div>
      </div>
    </article>}

    {!loading && config && <section className="stack">
      <article className="card">
        <h2>目前成本參數</h2>
        <div className="detail-object">
          <div className="detail-row"><strong>供應商</strong><span>{config.provider}</span></div>
          <div className="detail-row"><strong>模型</strong><span>{config.model}</span></div>
          <div className="detail-row"><strong>輸出價格（每 100 萬單位／美元）</strong><span>{config.output_usd_per_million}</span></div>
          <div className="detail-row"><strong>美元兌新台幣匯率</strong><span>{config.usd_twd_rate ?? '未設定'}</span></div>
        </div>
      </article>

      <article className="card">
        <h2>試算條件</h2>
        <p className="muted">目標毛利用於估算可配置的 AI 成本預算，不會自動修改商業方案設定。</p>
        <div className="form-grid">
          <label>方案售價（TWD）<input value="99" disabled /></label>
          <label>目標毛利（%）<input inputMode="decimal" value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} /></label>
        </div>
      </article>

      {calculation ? <>
        <div className="metric-grid">
          <article className="metric"><span>方案售價</span><strong>NT$ 99</strong></article>
          <article className="metric"><span>目標毛利</span><strong>{margin.toFixed(1)}%</strong></article>
          <article className="metric"><span>AI 成本預算</span><strong>NT$ {calculation.aiBudgetTwd.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</strong></article>
          <article className="metric"><span>AI 成本預算（美元）</span><strong>${calculation.aiBudgetUsd.toFixed(6)}</strong></article>
          <article className="metric"><span>建議 AI 點數</span><strong>{calculation.recommendedPoints.toLocaleString('zh-TW')}</strong></article>
        </div>
        <article className="card">
          <h2>使用建議</h2>
          <p className="muted">可將試算結果作為營運參考，再到「商業方案設定」調整每月 AI 點數與供應商成本上限。</p>
        </article>
      </> : <div className="banner error">請確認目標毛利介於 0～100%，且 AI 模型輸出價格與匯率皆為正數。</div>}
    </section>}
  </main>;
}
