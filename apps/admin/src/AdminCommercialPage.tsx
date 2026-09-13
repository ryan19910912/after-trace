import { useEffect, useMemo, useState } from 'react';
import type { AdminAiRuntimeConfig, AdminApi } from './api';
import { AdminCommercialApi, type FreeAiTrialConfig, type SubscriptionPlanConfig, type SubscriptionPlanInput } from './commercial-api';
import { calculatePricingRecommendation } from './pricing-calculator';

const SESSION_KEY = 'aftertrace.admin.session';
const MB = 1024 * 1024;
const DEFAULT_NEW_PLAN: PlanDraft = {
  displayName: 'AI Pro Plus', priceTwd: '199', enabled: true,
  aiMediaIngestion: true, aiNaturalSearch: true, aiRelatedRecords: true, aiTimeRangeSummary: true, aiRecordRewrite: true, aiTaskProposal: true,
  monthlyAiPointCap: '200000', monthlyProviderCostCapTwd: '60', perRequestAiPointCap: '',
  maxImagesPerRequest: '1', maxImageMb: '5', maxAudioSeconds: '300', maxAudioMb: '10', maxFileMb: '10',
};

type Tab = 'FREE' | 'SUBSCRIPTION';
type PlanDraft = {
  displayName: string; priceTwd: string; enabled: boolean;
  aiMediaIngestion: boolean; aiNaturalSearch: boolean; aiRelatedRecords: boolean; aiTimeRangeSummary: boolean; aiRecordRewrite: boolean; aiTaskProposal: boolean;
  monthlyAiPointCap: string; monthlyProviderCostCapTwd: string; perRequestAiPointCap: string;
  maxImagesPerRequest: string; maxImageMb: string; maxAudioSeconds: string; maxAudioMb: string; maxFileMb: string;
};

export function AdminCommercialPage({ api, runtimeApi }: { api: AdminCommercialApi; runtimeApi: AdminApi }) {
  const [tab, setTab] = useState<Tab>('FREE');
  const [trial, setTrial] = useState<FreeAiTrialConfig | null>(null);
  const [trialPoints, setTrialPoints] = useState('');
  const [trialBudgetTwd, setTrialBudgetTwd] = useState('5');
  const [runtime, setRuntime] = useState<AdminAiRuntimeConfig | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanConfig[]>([]);
  const [draft, setDraft] = useState<PlanDraft>({ ...DEFAULT_NEW_PLAN });
  const [modal, setModal] = useState<'CREATE' | 'DETAIL' | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY); api.setSessionToken(token); runtimeApi.setSessionToken(token);
    if (!token) { setError('請先登入管理後台。'); setLoading(false); return; }
    void load();
  }, [api, runtimeApi]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [nextTrial, nextPlans, nextRuntime] = await Promise.all([
        api.getFreeAiTrial(), api.getPlans(), runtimeApi.aiRuntime().catch(() => null),
      ]);
      setTrial(nextTrial); setTrialPoints(nextTrial ? String(nextTrial.freeInitialAiTrialPoints) : ''); setPlans(nextPlans); setRuntime(nextRuntime);
    } catch (cause) { setError(friendlyError(cause, '商業方案設定載入失敗')); }
    finally { setLoading(false); }
  }

  const trialEstimate = useMemo(() => {
    const twd = Number(trialBudgetTwd);
    if (!runtime || !Number.isFinite(twd) || twd <= 0) return null;
    return calculatePricingRecommendation({
      priceTwd: twd,
      targetGrossMarginPercent: 0,
      usdTwdRate: Number(runtime.usd_twd_rate ?? 0),
      outputUsdPerMillion: Number(runtime.output_usd_per_million ?? 0),
    });
  }, [trialBudgetTwd, runtime]);

  async function saveTrial() {
    const parsed = Number(trialPoints);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) { setError('一次性 AI 搜尋體驗額度必須是大於 0 的整數。'); return; }
    if (!window.confirm(`確定將之後符合資格的新帳號 AI 搜尋體驗設為 ${parsed.toLocaleString()} 點？\n已經發放的帳號不會被修改。`)) return;
    setSaving(true); setError(null); setNotice(null);
    try { const next = await api.setFreeAiTrial(parsed); setTrial(next); setTrialPoints(String(next.freeInitialAiTrialPoints)); setNotice('一次性 AI 搜尋體驗額度已更新，只影響之後符合資格的新帳號。'); }
    catch (cause) { setError(friendlyError(cause, '免費 AI 搜尋體驗設定更新失敗')); }
    finally { setSaving(false); }
  }

  function openCreate() { setDraft({ ...DEFAULT_NEW_PLAN }); setSelectedCode(''); setEditing(true); setModal('CREATE'); setError(null); setNotice(null); }
  function openDetail(plan: SubscriptionPlanConfig) { setSelectedCode(plan.code); setDraft(planDraft(plan)); setEditing(false); setModal('DETAIL'); setError(null); setNotice(null); }
  function closeModal() { if (saving) return; setModal(null); setEditing(false); }

  async function savePlan() {
    const input = planInput(draft);
    if ('error' in input) { setError(input.error); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const saved = modal === 'CREATE' ? await api.createPlan(input.value) : await api.updatePlan(selectedCode, input.value);
      setPlans(await api.getPlans()); setSelectedCode(saved.code); setDraft(planDraft(saved));
      setNotice(modal === 'CREATE' ? '訂閱方案已新增。' : '訂閱方案設定已更新。');
      setModal(null); setEditing(false);
    } catch (cause) { setError(friendlyError(cause, '訂閱方案儲存失敗')); }
    finally { setSaving(false); }
  }

  return <main className="shell">
    <header className="topbar admin-hero"><div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>商業方案設定</h1><p className="muted">管理免費體驗額度與訂閱方案；AI 模型與官方價格另外在「模型與價格設定」維護。</p></div><div className="header-actions"><a href="/ai-runtime"><button className="ghost">模型與價格設定</button></a><button disabled={loading || saving} onClick={() => void load()}>重新整理</button></div></header>
    {error && <div className="banner error">{error}</div>}{notice && <div className="banner success">{notice}</div>}

    <div className="commercial-tabs" role="tablist" aria-label="方案類型">
      <button className={tab === 'FREE' ? 'active' : ''} onClick={() => setTab('FREE')}>免費方案</button>
      <button className={tab === 'SUBSCRIPTION' ? 'active' : ''} onClick={() => setTab('SUBSCRIPTION')}>訂閱方案</button>
    </div>

    {tab === 'FREE' ? <section className="stack commercial-stack">
      <article className="card plan-card">
        <div className="plan-section-head"><span className="plan-badge free">免費方案</span><p className="muted">一般紀錄、一般搜尋與其他免費功能可持續使用；新帳號另提供一次性的 AI 搜尋體驗。</p></div>
        <div className="commercial-grid two-col">
          <div className="settings-block"><label>一次性 AI 搜尋體驗額度<input type="number" min="1" step="1" value={trialPoints} disabled={loading || saving} onChange={(event) => setTrialPoints(event.target.value)} placeholder="尚未設定" /></label><p className="muted compact-copy">每個符合資格的新帳號只會取得一次，額度只能用於自然語言 AI 搜尋，不會每月重新發放。</p><button disabled={loading || saving} onClick={() => void saveTrial()}>{saving ? '儲存中…' : '儲存體驗額度'}</button></div>
          <div className="settings-block trial-status-block"><h3>發放狀態</h3>{!trial ? <><strong>目前尚未啟用</strong><p className="muted">設定額度後，新符合資格的帳號才會收到一次性 AI 搜尋體驗。</p></> : <><strong>目前已啟用</strong><p className="muted">新符合資格的免費用戶會依目前設定取得一次性 AI 搜尋體驗額度。</p></>}</div>
        </div>
        {trial && <div className="metric-grid compact-metrics"><Metric name="單一帳號發放量" value={trial.freeInitialAiTrialPoints}/><Metric name="已發放帳號" value={trial.recipients}/><Metric name="已用完帳號" value={trial.exhaustedRecipients}/><Metric name="累計已發放" value={trial.issuedPoints}/><Metric name="尚未使用點數" value={trial.remainingPoints}/><Metric name="累計已使用" value={trial.consumedPoints}/></div>}
      </article>

      <article className="card plan-card">
        <div className="plan-section-head"><span className="plan-badge free">免費額度試算</span><p className="muted">輸入你願意負擔的 AI 成本，例如 NT$5，系統會依目前模型價格換算成建議點數。</p></div>
        <div className="commercial-grid two-col">
          <div className="settings-block"><label>預計贈送成本（TWD）<input inputMode="decimal" value={trialBudgetTwd} onChange={(event) => setTrialBudgetTwd(event.target.value)} placeholder="例如 5" /></label><p className="muted compact-copy">試算會使用目前設定的模型輸出價格與 USD/TWD 匯率，不會自動修改免費方案。</p></div>
          <div className="settings-block trial-calculator-result"><h3>建議體驗額度</h3>{trialEstimate ? <><strong>{trialEstimate.recommendedPoints.toLocaleString('zh-TW')} 點</strong><p className="muted">約對應 NT${Number(trialBudgetTwd).toLocaleString('zh-TW', { maximumFractionDigits: 2 })} 的 AI 輸出成本。</p><button className="ghost" onClick={() => setTrialPoints(String(trialEstimate.recommendedPoints))}>帶入上方額度</button></> : <><strong>尚無法試算</strong><p className="muted">請先完成 AI 模型價格與 USD/TWD 匯率設定。</p><a href="/ai-runtime"><button className="ghost">前往模型與價格設定</button></a></>}</div>
        </div>
      </article>
    </section> : <section className="stack commercial-stack">
      <article className="card plan-card">
        <div className="subscription-list-head"><div><span className="plan-badge paid">訂閱方案</span><p className="muted">新增方案使用彈窗；既有方案從下方清單查看詳情、編輯與儲存。</p></div><button className="primary-action" onClick={openCreate}>＋ 新增訂閱方案</button></div>
        <div className="subscription-plan-list">
          {plans.length === 0 ? <div className="empty-state-card"><strong>目前沒有訂閱方案</strong><p className="muted">點右上角「新增訂閱方案」建立第一個方案。</p></div> : plans.map((plan) => <article className="subscription-plan-row" key={plan.code}><div><strong>{plan.displayName}</strong><span>{plan.code}</span></div><div><strong>NT${Number(plan.priceTwd).toLocaleString('zh-TW')} / 月</strong><span>{plan.enabled ? '已啟用' : '已停用'}</span></div><div><strong>{plan.monthlyAiPointCap.toLocaleString('zh-TW')} 點</strong><span>每月 AI 上限</span></div><button className="ghost" onClick={() => openDetail(plan)}>詳情</button></article>)}
        </div>
      </article>
    </section>}

    {modal ? <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title"><div className="admin-modal-head"><div><p className="eyebrow">{modal === 'CREATE' ? 'NEW SUBSCRIPTION' : selectedCode}</p><h2 id="plan-modal-title">{modal === 'CREATE' ? '新增訂閱方案' : '訂閱方案詳情'}</h2></div><button className="ghost" aria-label="關閉" disabled={saving} onClick={closeModal}>×</button></div>
      <fieldset disabled={modal === 'DETAIL' && !editing} className="admin-modal-fieldset"><PlanFields draft={draft} setDraft={setDraft} loading={loading || saving} /></fieldset>
      <div className="admin-modal-actions"><button className="ghost" disabled={saving} onClick={closeModal}>關閉</button>{modal === 'DETAIL' && !editing ? <button onClick={() => setEditing(true)}>編輯</button> : <button className="primary-action" disabled={saving} onClick={() => void savePlan()}>{saving ? '儲存中…' : modal === 'CREATE' ? '建立方案' : '儲存變更'}</button>}</div>
    </section></div> : null}
  </main>;
}

function PlanFields({ draft, setDraft, loading }: { draft: PlanDraft; setDraft: (next: PlanDraft) => void; loading: boolean }) {
  return <div className="stack">
    <div className="form-grid"><label>方案名稱<input value={draft.displayName} onChange={(e)=>setDraft({...draft,displayName:e.target.value})} /></label><label>每月售價（TWD）<input inputMode="decimal" value={draft.priceTwd} onChange={(e)=>setDraft({...draft,priceTwd:e.target.value})} /></label><Toggle label="啟用此方案" checked={draft.enabled} disabled={loading} onChange={(value)=>setDraft({...draft,enabled:value})}/></div>
    <div className="section-divider"/><h3>功能設定</h3><div className="feature-switch-grid"><Toggle label="圖片／音訊／檔案 AI" checked={draft.aiMediaIngestion} disabled={loading} onChange={(v)=>setDraft({...draft,aiMediaIngestion:v})}/><Toggle label="AI 自然語言搜尋" checked={draft.aiNaturalSearch} disabled={loading} onChange={(v)=>setDraft({...draft,aiNaturalSearch:v})}/><Toggle label="相關紀錄推薦" checked={draft.aiRelatedRecords} disabled={loading} onChange={(v)=>setDraft({...draft,aiRelatedRecords:v})}/><Toggle label="時間區間摘要" checked={draft.aiTimeRangeSummary} disabled={loading} onChange={(v)=>setDraft({...draft,aiTimeRangeSummary:v})}/><Toggle label="AI 改寫建議" checked={draft.aiRecordRewrite} disabled={loading} onChange={(v)=>setDraft({...draft,aiRecordRewrite:v})}/><Toggle label="AI 待辦建議" checked={draft.aiTaskProposal} disabled={loading} onChange={(v)=>setDraft({...draft,aiTaskProposal:v})}/></div>
    <div className="section-divider"/><h3>AI 使用與成本上限</h3><div className="form-grid"><label>每月 AI 點數上限<input type="number" min="1" value={draft.monthlyAiPointCap} onChange={(e)=>setDraft({...draft,monthlyAiPointCap:e.target.value})}/></label><label>每月 AI 供應商成本上限（TWD）<input inputMode="decimal" value={draft.monthlyProviderCostCapTwd} onChange={(e)=>setDraft({...draft,monthlyProviderCostCapTwd:e.target.value})}/></label><label>單次 AI 點數上限（選填）<input type="number" min="1" value={draft.perRequestAiPointCap} onChange={(e)=>setDraft({...draft,perRequestAiPointCap:e.target.value})}/></label></div>
    <div className="section-divider"/><h3>圖片、音訊與檔案限制</h3><div className="form-grid"><label>單次最多圖片數<input type="number" min="1" max="10" value={draft.maxImagesPerRequest} onChange={(e)=>setDraft({...draft,maxImagesPerRequest:e.target.value})}/></label><label>單張圖片上限（MB）<input type="number" min="1" max="20" value={draft.maxImageMb} onChange={(e)=>setDraft({...draft,maxImageMb:e.target.value})}/></label><label>單段音訊最長秒數<input type="number" min="1" max="3600" value={draft.maxAudioSeconds} onChange={(e)=>setDraft({...draft,maxAudioSeconds:e.target.value})}/></label><label>單段音訊上限（MB）<input type="number" min="1" max="30" value={draft.maxAudioMb} onChange={(e)=>setDraft({...draft,maxAudioMb:e.target.value})}/></label><label>單一檔案上限（MB）<input type="number" min="1" max="30" value={draft.maxFileMb} onChange={(e)=>setDraft({...draft,maxFileMb:e.target.value})}/></label></div>
  </div>;
}

function planDraft(plan: SubscriptionPlanConfig): PlanDraft { return { displayName:plan.displayName,priceTwd:plan.priceTwd,enabled:plan.enabled,aiMediaIngestion:plan.aiMediaIngestion,aiNaturalSearch:plan.aiNaturalSearch,aiRelatedRecords:plan.aiRelatedRecords,aiTimeRangeSummary:plan.aiTimeRangeSummary,aiRecordRewrite:plan.aiRecordRewrite,aiTaskProposal:plan.aiTaskProposal,monthlyAiPointCap:String(plan.monthlyAiPointCap),monthlyProviderCostCapTwd:plan.monthlyProviderCostCapTwd,perRequestAiPointCap:plan.perRequestAiPointCap?String(plan.perRequestAiPointCap):'',maxImagesPerRequest:String(plan.maxImagesPerRequest),maxImageMb:String(Math.round(plan.maxImageBytes/MB)),maxAudioSeconds:String(plan.maxAudioSeconds),maxAudioMb:String(Math.round(plan.maxAudioBytes/MB)),maxFileMb:String(Math.round(plan.maxFileBytes/MB)) }; }
function planInput(draft: PlanDraft): { value: SubscriptionPlanInput } | { error: string } {
  const monthly=Number(draft.monthlyAiPointCap), request=draft.perRequestAiPointCap.trim()?Number(draft.perRequestAiPointCap):null, images=Number(draft.maxImagesPerRequest), imageMb=Number(draft.maxImageMb), audioSeconds=Number(draft.maxAudioSeconds), audioMb=Number(draft.maxAudioMb), fileMb=Number(draft.maxFileMb);
  if(!draft.displayName.trim()) return {error:'請輸入方案名稱。'}; if(!/^\d+(?:\.\d{1,2})?$/.test(draft.priceTwd)||Number(draft.priceTwd)<=0) return {error:'請輸入有效的每月售價。'}; if(!Number.isSafeInteger(monthly)||monthly<=0) return {error:'每月 AI 點數上限必須大於 0。'}; if(request!==null&&(!Number.isSafeInteger(request)||request<=0||request>monthly)) return {error:'單次 AI 點數上限必須大於 0，且不得超過每月上限。'}; if(!Number.isSafeInteger(images)||images<1||images>10) return {error:'單次圖片數請設定為 1～10。'}; if(![imageMb,audioMb,fileMb].every((v)=>Number.isSafeInteger(v)&&v>=1&&v<=30)) return {error:'檔案大小上限請使用 1～30 MB 的整數。'}; if(!Number.isSafeInteger(audioSeconds)||audioSeconds<1||audioSeconds>3600) return {error:'音訊長度請設定為 1～3600 秒。'};
  return {value:{displayName:draft.displayName.trim(),priceTwd:draft.priceTwd.trim(),enabled:draft.enabled,aiMediaIngestion:draft.aiMediaIngestion,aiNaturalSearch:draft.aiNaturalSearch,aiRelatedRecords:draft.aiRelatedRecords,aiTimeRangeSummary:draft.aiTimeRangeSummary,aiRecordRewrite:draft.aiRecordRewrite,aiTaskProposal:draft.aiTaskProposal,monthlyAiPointCap:monthly,monthlyProviderCostCapTwd:draft.monthlyProviderCostCapTwd.trim(),perRequestAiPointCap:request,maxImagesPerRequest:images,maxImageBytes:imageMb*MB,maxAudioSeconds:audioSeconds,maxAudioBytes:audioMb*MB,maxFileBytes:fileMb*MB}};
}
function friendlyError(cause:unknown,fallback:string){const code=cause instanceof Error?cause.message:'';const labels:Record<string,string>={PLAN_CODE_ALREADY_EXISTS:'已有相同識別的方案，請調整售價或方案設定。',INVALID_PLAN_NAME:'方案名稱不正確。',INVALID_PLAN_PRICE:'方案售價不正確。',INVALID_MEDIA_LIMIT:'圖片、音訊或檔案限制不正確。'};return labels[code]??code??fallback;}
function Metric({name,value}:{name:string;value:number}) { return <article className="metric"><span>{name}</span><strong>{value.toLocaleString()}</strong></article>; }
function Toggle({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled:boolean;onChange:(value:boolean)=>void}) { return <label className="feature-toggle"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event)=>onChange(event.target.checked)}/></label>; }
