import { useEffect, useState } from 'react';
import { AdminCommercialApi, type FreeAiTrialConfig } from './commercial-api';

const SESSION_KEY = 'aftertrace.admin.session';

export function AdminCommercialPage({ api }: { api: AdminCommercialApi }) {
  const [config, setConfig] = useState<FreeAiTrialConfig | null>(null);
  const [points, setPoints] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY);
    api.setSessionToken(token);
    if (!token) { setError('請先回管理後台登入。'); setLoading(false); return; }
    void load();
  }, [api]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const next = await api.getFreeAiTrial();
      setConfig(next);
      setPoints(next ? String(next.freeInitialAiTrialPoints) : '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'FREE_AI_TRIAL_CONFIG_LOAD_FAILED');
    } finally { setLoading(false); }
  }

  async function save() {
    const parsed = Number(points);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      setError('FREE 初始 AI 試用點數必須是大於 0 的整數。');
      return;
    }
    if (!window.confirm(`確定將之後新帳號的一次性 AI 試用設為 ${parsed.toLocaleString()} 點？\n已經發放的帳號不會被修改。`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const next = await api.setFreeAiTrial(parsed);
      setConfig(next); setPoints(String(next.freeInitialAiTrialPoints));
      setNotice('設定已更新。此值只影響尚未收到 FREE_INITIAL 試用 Grant 的新帳號。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'FREE_AI_TRIAL_CONFIG_UPDATE_FAILED');
    } finally { setSaving(false); }
  }

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>商業方案設定</h1><p className="muted">V1 固定為 FREE + AI Pro NT$99/月。</p></div>
      <div className="header-actions"><a href="/">返回管理後台</a><button disabled={loading || saving} onClick={() => void load()}>重新整理</button></div>
    </header>
    {error && <div className="banner error">{error}</div>}
    {notice && <div className="banner success">{notice}</div>}

    <section className="stack">
      <article className="card">
        <p className="eyebrow">FREE</p>
        <h2>FREE 初始 AI 試用點數</h2>
        <p className="muted">每個新符合資格的 FREE 帳號只發放一次。這不是 TWD 額度、不會每月刷新，之後修改設定也不會重算已發放的 Grant。</p>
        <label>free_initial_ai_trial_points
          <input type="number" min="1" step="1" value={points} disabled={loading || saving} onChange={(event) => setPoints(event.target.value)} placeholder="尚未初始化" />
        </label>
        <div className="header-actions"><button disabled={loading || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存試用點數'}</button></div>
      </article>

      <article className="card">
        <h2>試用發放狀態</h2>
        {!config ? <p className="muted">尚未初始化。設定完成前，FREE 手動功能仍可正常使用；AI trial 會暫不發放。</p> : <div className="metric-grid">
          <Metric name="目前新帳號發放量" value={config.freeInitialAiTrialPoints} />
          <Metric name="已發放帳號" value={config.recipients} />
          <Metric name="已耗盡帳號" value={config.exhaustedRecipients} />
          <Metric name="累計已發放點數" value={config.issuedPoints} />
          <Metric name="目前剩餘點數" value={config.remainingPoints} />
          <Metric name="累計已消耗點數" value={config.consumedPoints} />
        </div>}
        {config && <p className="muted">最後更新：{new Date(config.updatedAt).toLocaleString('zh-TW')} {config.updatedBy ? `· ${config.updatedBy}` : ''}</p>}
      </article>

      <article className="card">
        <p className="eyebrow">AI PRO</p>
        <h2>V1 商業契約</h2>
        <p><strong>NT$99 / 月</strong></p>
        <p className="muted">不提供一次性 AI 加值商品，也沒有額外付費 tier。AI Pro 仍受每月 AI point/resource cap 與 operator provider-cost hard cap 保護。</p>
      </article>
    </section>
  </main>;
}

function Metric({ name, value }: { name: string; value: number }) {
  return <article className="metric"><span>{name}</span><strong>{value.toLocaleString()}</strong></article>;
}
