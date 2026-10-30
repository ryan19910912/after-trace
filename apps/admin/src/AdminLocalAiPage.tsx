import { useEffect, useState } from 'react';
import { AdminCommercialApi, type SubscriptionPlanConfig } from './commercial-api';

export function AdminLocalAiPage({ api, history = false }: { api: AdminCommercialApi; history?: boolean }) {
  const [plans, setPlans] = useState<SubscriptionPlanConfig[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(history);
  useEffect(() => {
    const token = sessionStorage.getItem('aftertrace.admin.session');
    if (!token) { setError('請先登入管理後台。'); setLoading(false); return; }
    if (!history) return;
    let active = true; api.setSessionToken(token);
    void api.getPlans().then((value) => { if (active) setPlans(value); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '歷史方案載入失敗'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, history]);
  return <main className="shell"><header className="topbar"><div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>{history ? '歷史方案' : '本機 AI'}</h1><p className="muted">所有推論由使用者裝置執行，沒有雲端 AI 或雲端備援。</p></div></header>
    {error && <div className="banner error" role="alert">{error} <a href="/">返回登入</a></div>}
    <section className="panel stack"><h2>目前執行方式</h2><p>文字與圖片：Qwen3.5-0.8B（WebGPU）。短語音：Whisper small，最多 60 秒。</p><p>模型與執行資源在首次使用下載。後端只保存使用者確認的文字，不接收圖片或錄音。</p><p>舊雲端點數、模型價格及成本試算不再控制本機 AI；產品無訂閱或金流入口；歷史方案與帳務資料僅保留查閱。</p></section>
    {history && <section className="panel stack"><h2>既有方案資料</h2>{loading ? <p role="status">正在載入…</p> : plans.length ? plans.map((plan) => <article key={plan.code}><h3>{plan.displayName}</h3><p>{plan.code} · 原價格 NT${plan.priceTwd}</p></article>) : <p>目前沒有歷史方案。無需建立雲端點數方案即可使用本機 AI。</p>}</section>}
  </main>;
}
