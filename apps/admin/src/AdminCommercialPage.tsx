import { useEffect, useState } from 'react';
import { AdminCommercialApi, type AiProConfig, type FreeAiTrialConfig } from './commercial-api';

const SESSION_KEY = 'aftertrace.admin.session';

export function AdminCommercialPage({ api }: { api: AdminCommercialApi }) {
  const [trial, setTrial] = useState<FreeAiTrialConfig | null>(null);
  const [trialPoints, setTrialPoints] = useState('');
  const [aiPro, setAiPro] = useState<AiProConfig | null>(null);
  const [aiProEnabled, setAiProEnabled] = useState(true);
  const [monthlyPoints, setMonthlyPoints] = useState('');
  const [providerCostCap, setProviderCostCap] = useState('');
  const [perRequestCap, setPerRequestCap] = useState('');
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
      const [nextTrial, nextAiPro] = await Promise.all([api.getFreeAiTrial(), api.getAiPro()]);
      setTrial(nextTrial);
      setTrialPoints(nextTrial ? String(nextTrial.freeInitialAiTrialPoints) : '');
      applyAiPro(nextAiPro);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'COMMERCIAL_CONFIG_LOAD_FAILED');
    } finally { setLoading(false); }
  }

  function applyAiPro(value: AiProConfig | null) {
    setAiPro(value);
    setAiProEnabled(value?.enabled ?? true);
    setMonthlyPoints(value ? String(value.monthlyAiPointCap) : '');
    setProviderCostCap(value?.monthlyProviderCostCapTwd ?? '');
    setPerRequestCap(value?.perRequestAiPointCap ? String(value.perRequestAiPointCap) : '');
  }

  async function saveTrial() {
    const parsed = Number(trialPoints);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      setError('FREE 初始 AI 試用點數必須是大於 0 的整數。');
      return;
    }
    if (!window.confirm(`確定將之後新帳號的一次性 AI 試用設為 ${parsed.toLocaleString()} 點？\n已經發放的帳號不會被修改。`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const next = await api.setFreeAiTrial(parsed);
      setTrial(next); setTrialPoints(String(next.freeInitialAiTrialPoints));
      setNotice('FREE 試用設定已更新；只影響尚未收到 FREE_INITIAL Grant 的帳號。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'FREE_AI_TRIAL_CONFIG_UPDATE_FAILED');
    } finally { setSaving(false); }
  }

  async function saveAiPro() {
    const monthly = Number(monthlyPoints);
    const requestCap = perRequestCap.trim() ? Number(perRequestCap) : null;
    const providerCap = providerCostCap.trim();
    if (!Number.isSafeInteger(monthly) || monthly <= 0) { setError('AI Pro 每月 AI 點數上限必須大於 0。'); return; }
    if (!/^\d+(?:\.\d{1,6})?$/.test(providerCap) || Number(providerCap) <= 0) { setError('Provider Cost hard cap 必須是大於 0 的 TWD 金額。'); return; }
    if (requestCap !== null && (!Number.isSafeInteger(requestCap) || requestCap <= 0 || requestCap > monthly)) { setError('單次 AI 點數上限必須大於 0，且不得超過每月上限。'); return; }
    if (!window.confirm(`確定更新 AI Pro 營運上限？\n售價仍固定 NT$99/月；Provider Cost hard cap 只供內部風險控制。`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const next = await api.setAiPro({
        enabled: aiProEnabled,
        monthlyAiPointCap: monthly,
        monthlyProviderCostCapTwd: providerCap,
        perRequestAiPointCap: requestCap,
      });
      applyAiPro(next);
      setNotice('AI Pro 設定已更新。售價仍固定 NT$99/月。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI_PRO_CONFIG_UPDATE_FAILED');
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
          <input type="number" min="1" step="1" value={trialPoints} disabled={loading || saving} onChange={(event) => setTrialPoints(event.target.value)} placeholder="尚未初始化" />
        </label>
        <div className="header-actions"><button disabled={loading || saving} onClick={() => void saveTrial()}>{saving ? '儲存中…' : '儲存試用點數'}</button></div>
      </article>

      <article className="card">
        <h2>試用發放狀態</h2>
        {!trial ? <p className="muted">尚未初始化。設定完成前，FREE 手動功能仍可正常使用；AI trial 會暫不發放。</p> : <div className="metric-grid">
          <Metric name="目前新帳號發放量" value={trial.freeInitialAiTrialPoints} />
          <Metric name="已發放帳號" value={trial.recipients} />
          <Metric name="已耗盡帳號" value={trial.exhaustedRecipients} />
          <Metric name="累計已發放點數" value={trial.issuedPoints} />
          <Metric name="目前剩餘點數" value={trial.remainingPoints} />
          <Metric name="累計已消耗點數" value={trial.consumedPoints} />
        </div>}
        {trial && <p className="muted">最後更新：{new Date(trial.updatedAt).toLocaleString('zh-TW')} {trial.updatedBy ? `· ${trial.updatedBy}` : ''}</p>}
      </article>

      <article className="card">
        <p className="eyebrow">AI PRO</p>
        <h2>AI Pro · NT$99 / 月</h2>
        <p className="muted">售價鎖定為 V1 商業契約。以下都是內部公平使用／成本安全參數，不是客戶現金餘額。</p>
        <label><input type="checkbox" checked={aiProEnabled} disabled={loading || saving} onChange={(event) => setAiProEnabled(event.target.checked)} /> 啟用 AI Pro</label>
        <label>每月 AI 點數／資源上限
          <input type="number" min="1" step="1" value={monthlyPoints} onChange={(event) => setMonthlyPoints(event.target.value)} placeholder="例如 100000" />
        </label>
        <label>每月 Provider Cost hard cap（TWD）
          <input inputMode="decimal" value={providerCostCap} onChange={(event) => setProviderCostCap(event.target.value)} placeholder="例如 30" />
        </label>
        <label>單次 AI 點數上限（選填）
          <input type="number" min="1" step="1" value={perRequestCap} onChange={(event) => setPerRequestCap(event.target.value)} placeholder="留空表示沒有額外單次 cap" />
        </label>
        <div className="header-actions"><button disabled={loading || saving} onClick={() => void saveAiPro()}>{saving ? '儲存中…' : '儲存 AI Pro 設定'}</button></div>
        {aiPro && <p className="muted">目前：{aiPro.enabled ? '啟用' : '停用'} · 月點數 {aiPro.monthlyAiPointCap.toLocaleString()} · Provider Cost NT$ {aiPro.monthlyProviderCostCapTwd} · 最後更新 {new Date(aiPro.updatedAt).toLocaleString('zh-TW')}</p>}
      </article>

      <article className="card">
        <h2>V1 不存在的商品</h2>
        <p className="muted">不提供一次性 AI top-up，也不提供第三個付費 tier。舊 schema 中殘留的 ONE_TIME / TOP_UP 只屬 migration cleanup，不是可售商品。</p>
      </article>
    </section>
  </main>;
}

function Metric({ name, value }: { name: string; value: number }) {
  return <article className="metric"><span>{name}</span><strong>{value.toLocaleString()}</strong></article>;
}
