import { useEffect, useMemo, useState } from 'react';
import { AdminCommercialApi, type AiProConfig, type FreeAiTrialConfig } from './commercial-api';

const SESSION_KEY = 'aftertrace.admin.session';

export function AdminCommercialPage({ api }: { api: AdminCommercialApi }) {
  const [trial, setTrial] = useState<FreeAiTrialConfig | null>(null);
  const [trialPoints, setTrialPoints] = useState('');
  const [aiPro, setAiPro] = useState<AiProConfig | null>(null);
  const [aiProEnabled, setAiProEnabled] = useState(true);
  const [aiMediaIngestion, setAiMediaIngestion] = useState(true);
  const [aiNaturalSearch, setAiNaturalSearch] = useState(true);
  const [aiRelatedRecords, setAiRelatedRecords] = useState(true);
  const [aiTimeRangeSummary, setAiTimeRangeSummary] = useState(true);
  const [aiRecordRewrite, setAiRecordRewrite] = useState(true);
  const [aiTaskProposal, setAiTaskProposal] = useState(true);
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
    if (!token) { setError('請先登入管理後台。'); setLoading(false); return; }
    void load();
  }, [api]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [nextTrial, nextAiPro] = await Promise.all([api.getFreeAiTrial(), api.getAiPro()]);
      setTrial(nextTrial); setTrialPoints(nextTrial ? String(nextTrial.freeInitialAiTrialPoints) : ''); applyAiPro(nextAiPro);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '商業方案設定載入失敗'); }
    finally { setLoading(false); }
  }

  function applyAiPro(value: AiProConfig | null) {
    setAiPro(value); setAiProEnabled(value?.enabled ?? true); setAiMediaIngestion(value?.aiMediaIngestion ?? true);
    setAiNaturalSearch(value?.aiNaturalSearch ?? true); setAiRelatedRecords(value?.aiRelatedRecords ?? true);
    setAiTimeRangeSummary(value?.aiTimeRangeSummary ?? true); setAiRecordRewrite(value?.aiRecordRewrite ?? true);
    setAiTaskProposal(value?.aiTaskProposal ?? true);
    setMonthlyPoints(value ? String(value.monthlyAiPointCap) : ''); setProviderCostCap(value?.monthlyProviderCostCapTwd ?? '');
    setPerRequestCap(value?.perRequestAiPointCap ? String(value.perRequestAiPointCap) : '');
  }

  async function saveTrial() {
    const parsed = Number(trialPoints);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) { setError('免費試用 AI 點數必須是大於 0 的整數。'); return; }
    if (!window.confirm(`確定將之後符合資格的新帳號一次性試用設為 ${parsed.toLocaleString()} 點？\n已經發放的帳號不會被修改。`)) return;
    setSaving(true); setError(null); setNotice(null);
    try { const next=await api.setFreeAiTrial(parsed); setTrial(next); setTrialPoints(String(next.freeInitialAiTrialPoints)); setNotice('免費試用設定已更新，只影響之後符合資格且尚未領取試用點數的帳號。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '免費試用設定更新失敗'); }
    finally { setSaving(false); }
  }

  async function saveAiPro() {
    const monthly=Number(monthlyPoints); const requestCap=perRequestCap.trim()?Number(perRequestCap):null; const providerCap=providerCostCap.trim();
    if (!Number.isSafeInteger(monthly)||monthly<=0) { setError('每月 AI 點數上限必須大於 0。'); return; }
    if (!/^\d+(?:\.\d{1,6})?$/.test(providerCap)||Number(providerCap)<=0) { setError('每月供應商成本上限必須是大於 0 的 TWD 金額。'); return; }
    if (requestCap!==null&&(!Number.isSafeInteger(requestCap)||requestCap<=0||requestCap>monthly)) { setError('單次 AI 點數上限必須大於 0，且不得超過每月上限。'); return; }
    if (!window.confirm('確定更新訂閱方案的功能與成本控制參數？')) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const next=await api.setAiPro({ enabled:aiProEnabled, aiMediaIngestion, aiNaturalSearch, aiRelatedRecords, aiTimeRangeSummary, aiRecordRewrite, aiTaskProposal, monthlyAiPointCap:monthly, monthlyProviderCostCapTwd:providerCap, perRequestAiPointCap:requestCap });
      applyAiPro(next); setNotice('訂閱方案設定已更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '訂閱方案設定更新失敗'); }
    finally { setSaving(false); }
  }

  const subscriptionOptions = useMemo(() => aiPro ? [{ code: aiPro.code, label: `${aiPro.displayName} NT$${Number(aiPro.priceTwd).toLocaleString('zh-TW')}／月` }] : [], [aiPro]);

  return <main className="shell">
    <header className="topbar admin-hero"><div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>商業方案設定</h1><p className="muted">設定免費方案與訂閱方案的功能、試用機制與資源上限。</p></div><button disabled={loading||saving} onClick={()=>void load()}>重新整理</button></header>
    {error&&<div className="banner error">{error}</div>}{notice&&<div className="banner success">{notice}</div>}
    <section className="stack commercial-stack">
      <article className="card plan-card">
        <div className="plan-section-head"><span className="plan-badge free">免費方案</span><p className="muted">設定免費用戶可使用的功能與一次性試用機制。</p></div>
        <div className="commercial-grid two-col">
          <div className="settings-block">
            <label>免費試用 AI 點數<input type="number" min="1" step="1" value={trialPoints} disabled={loading||saving} onChange={(event)=>setTrialPoints(event.target.value)} placeholder="尚未設定" /></label>
            <p className="muted compact-copy">符合資格的免費用戶僅會獲得一次試用 AI 點數；調整後不會影響已發放的帳號。</p>
            <button disabled={loading||saving} onClick={()=>void saveTrial()}>{saving?'儲存中…':'儲存試用點數'}</button>
          </div>
          <div className="settings-block trial-status-block">
            <h3>試用發放狀態</h3>
            {!trial?<><strong>目前尚未啟用試用發放</strong><p className="muted">設定免費試用 AI 點數後，符合資格的新用戶才會收到一次性試用點數；一般免費功能不受影響。</p></>:<><strong>目前可發放試用點數</strong><p className="muted">新符合資格的免費用戶可依目前設定獲得一次性 AI 試用點數。</p></>}
          </div>
        </div>
        {trial&&<div className="metric-grid compact-metrics"><Metric name="目前發放量" value={trial.freeInitialAiTrialPoints}/><Metric name="已發放帳號" value={trial.recipients}/><Metric name="已耗盡帳號" value={trial.exhaustedRecipients}/><Metric name="累計已發放" value={trial.issuedPoints}/><Metric name="目前剩餘" value={trial.remainingPoints}/><Metric name="累計已消耗" value={trial.consumedPoints}/></div>}
      </article>

      <article className="card plan-card">
        <div className="plan-section-head"><span className="plan-badge paid">訂閱方案</span><p className="muted">設定訂閱方案的功能開關、點數上限與成本控制參數。</p></div>
        <div className="subscription-selector">
          <label>訂閱方案<select disabled={loading || subscriptionOptions.length === 0}>{subscriptionOptions.length ? subscriptionOptions.map((option)=><option key={option.code} value={option.code}>{option.label}</option>) : <option>尚未設定訂閱方案</option>}</select></label>
          <p className="muted compact-copy">方案選項由後端提供；未來新增其他價格或方案時可直接擴充。</p>
        </div>
        <div className="section-divider" />
        <h3>功能設定</h3>
        <p className="muted">以下功能開關同時套用到訂閱方案與符合資格的一次性免費 AI 試用。AI 待辦只會先產生建議，需由使用者確認後才會建立待辦；一般手動功能不受影響。</p>
        <div className="feature-switch-grid">
          <Toggle label="啟用 AI Pro" checked={aiProEnabled} disabled={loading||saving} onChange={setAiProEnabled}/>
          <Toggle label="圖片／音訊／檔案 AI" checked={aiMediaIngestion} disabled={loading||saving||!aiProEnabled} onChange={setAiMediaIngestion}/>
          <Toggle label="AI 自然語言搜尋" checked={aiNaturalSearch} disabled={loading||saving||!aiProEnabled} onChange={setAiNaturalSearch}/>
          <Toggle label="相關紀錄推薦" checked={aiRelatedRecords} disabled={loading||saving||!aiProEnabled} onChange={setAiRelatedRecords}/>
          <Toggle label="時間區間 AI 摘要" checked={aiTimeRangeSummary} disabled={loading||saving||!aiProEnabled} onChange={setAiTimeRangeSummary}/>
          <Toggle label="AI 改寫建議" checked={aiRecordRewrite} disabled={loading||saving||!aiProEnabled} onChange={setAiRecordRewrite}/>
          <Toggle label="AI 待辦建議" checked={aiTaskProposal} disabled={loading||saving||!aiProEnabled} onChange={setAiTaskProposal}/>
        </div>
        <div className="section-divider" />
        <h3>成本控制參數</h3>
        <p className="muted">以下設定用於內部公平使用與成本控管，不代表使用者的現金餘額。</p>
        <div className="form-grid">
          <label>每月 AI 點數上限<input type="number" min="1" step="1" value={monthlyPoints} onChange={(e)=>setMonthlyPoints(e.target.value)} placeholder="例如 100000" /></label>
          <label>每月供應商成本上限（TWD）<input inputMode="decimal" value={providerCostCap} onChange={(e)=>setProviderCostCap(e.target.value)} placeholder="例如 30" /></label>
          <label>單次 AI 點數上限（選填）<input type="number" min="1" step="1" value={perRequestCap} onChange={(e)=>setPerRequestCap(e.target.value)} placeholder="留空表示不另外限制" /></label>
        </div>
        <button disabled={loading||saving} onClick={()=>void saveAiPro()}>{saving?'儲存中…':'儲存訂閱方案設定'}</button>
        {aiPro&&<p className="muted compact-copy">目前狀態：{aiPro.enabled?'啟用':'停用'} · 月點數 {aiPro.monthlyAiPointCap.toLocaleString()} · 每月供應商成本上限 NT$ {aiPro.monthlyProviderCostCapTwd} · 最後更新 {new Date(aiPro.updatedAt).toLocaleString('zh-TW')}</p>}
      </article>
    </section>
  </main>;
}

function Metric({name,value}:{name:string;value:number}) { return <article className="metric"><span>{name}</span><strong>{value.toLocaleString()}</strong></article>; }
function Toggle({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled:boolean;onChange:(value:boolean)=>void}) { return <label className="feature-toggle"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event)=>onChange(event.target.checked)}/></label>; }
