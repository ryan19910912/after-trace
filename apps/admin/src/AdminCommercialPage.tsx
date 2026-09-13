import { useEffect, useMemo, useState } from 'react';
import { AdminCommercialApi, type FreeAiTrialConfig, type SubscriptionPlanConfig, type SubscriptionPlanInput } from './commercial-api';

const SESSION_KEY = 'aftertrace.admin.session';
const MB = 1024 * 1024;
const DEFAULT_NEW_PLAN: PlanDraft = {
  displayName: 'AI Pro Plus', priceTwd: '199', enabled: true,
  aiMediaIngestion: true, aiNaturalSearch: true, aiRelatedRecords: true, aiTimeRangeSummary: true, aiRecordRewrite: true, aiTaskProposal: true,
  monthlyAiPointCap: '200000', monthlyProviderCostCapTwd: '60', perRequestAiPointCap: '',
  maxImagesPerRequest: '1', maxImageMb: '5', maxAudioSeconds: '300', maxAudioMb: '10', maxFileMb: '10',
};

type PlanDraft = {
  displayName: string; priceTwd: string; enabled: boolean;
  aiMediaIngestion: boolean; aiNaturalSearch: boolean; aiRelatedRecords: boolean; aiTimeRangeSummary: boolean; aiRecordRewrite: boolean; aiTaskProposal: boolean;
  monthlyAiPointCap: string; monthlyProviderCostCapTwd: string; perRequestAiPointCap: string;
  maxImagesPerRequest: string; maxImageMb: string; maxAudioSeconds: string; maxAudioMb: string; maxFileMb: string;
};

export function AdminCommercialPage({ api }: { api: AdminCommercialApi }) {
  const [trial, setTrial] = useState<FreeAiTrialConfig | null>(null);
  const [trialPoints, setTrialPoints] = useState('');
  const [plans, setPlans] = useState<SubscriptionPlanConfig[]>([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [draft, setDraft] = useState<PlanDraft>({ ...DEFAULT_NEW_PLAN });
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY); api.setSessionToken(token);
    if (!token) { setError('請先登入管理後台。'); setLoading(false); return; }
    void load();
  }, [api]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [nextTrial, nextPlans] = await Promise.all([api.getFreeAiTrial(), api.getPlans()]);
      setTrial(nextTrial); setTrialPoints(nextTrial ? String(nextTrial.freeInitialAiTrialPoints) : ''); setPlans(nextPlans);
      const wanted = nextPlans.find((plan) => plan.code === selectedCode) ?? nextPlans[0] ?? null;
      if (wanted) { setSelectedCode(wanted.code); setDraft(planDraft(wanted)); setAdding(false); }
      else { setSelectedCode(''); setDraft({ ...DEFAULT_NEW_PLAN }); setAdding(true); }
    } catch (cause) { setError(friendlyError(cause, '商業方案設定載入失敗')); }
    finally { setLoading(false); }
  }

  function selectPlan(code: string) {
    const plan = plans.find((item) => item.code === code); if (!plan) return;
    setSelectedCode(code); setDraft(planDraft(plan)); setAdding(false); setError(null); setNotice(null);
  }
  function startAddPlan() { setSelectedCode(''); setDraft({ ...DEFAULT_NEW_PLAN }); setAdding(true); setError(null); setNotice(null); }

  async function saveTrial() {
    const parsed = Number(trialPoints);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) { setError('免費 AI 搜尋體驗點數必須是大於 0 的整數。'); return; }
    if (!window.confirm(`確定將之後符合資格的新帳號 AI 搜尋體驗設為 ${parsed.toLocaleString()} 點？\n已經發放的帳號不會被修改。`)) return;
    setSaving(true); setError(null); setNotice(null);
    try { const next = await api.setFreeAiTrial(parsed); setTrial(next); setTrialPoints(String(next.freeInitialAiTrialPoints)); setNotice('免費 AI 搜尋體驗設定已更新，只影響之後符合資格的新帳號。'); }
    catch (cause) { setError(friendlyError(cause, '免費 AI 搜尋體驗設定更新失敗')); }
    finally { setSaving(false); }
  }

  async function savePlan() {
    const input = planInput(draft);
    if ('error' in input) { setError(input.error); return; }
    if (!window.confirm(adding ? '確定新增這個訂閱方案？' : '確定更新這個訂閱方案？')) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const saved = adding ? await api.createPlan(input.value) : await api.updatePlan(selectedCode, input.value);
      const nextPlans = await api.getPlans(); setPlans(nextPlans); setSelectedCode(saved.code); setDraft(planDraft(saved)); setAdding(false);
      setNotice(adding ? '訂閱方案已新增。' : '訂閱方案設定已更新。');
    } catch (cause) { setError(friendlyError(cause, '訂閱方案儲存失敗')); }
    finally { setSaving(false); }
  }

  const selected = useMemo(() => plans.find((plan) => plan.code === selectedCode) ?? null, [plans, selectedCode]);

  return <main className="shell">
    <header className="topbar admin-hero"><div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>商業方案設定</h1><p className="muted">管理免費 AI 搜尋體驗、訂閱方案功能與 AI 使用上限。</p></div><button disabled={loading || saving} onClick={() => void load()}>重新整理</button></header>
    {error && <div className="banner error">{error}</div>}{notice && <div className="banner success">{notice}</div>}

    <section className="stack commercial-stack">
      <article className="card plan-card">
        <div className="plan-section-head"><span className="plan-badge free">免費方案</span><p className="muted">一般紀錄與一般搜尋持續免費；這裡只設定一次性的 AI 搜尋體驗點數。</p></div>
        <div className="commercial-grid two-col"><div className="settings-block"><label>免費 AI 搜尋體驗點數<input type="number" min="1" step="1" value={trialPoints} disabled={loading || saving} onChange={(event) => setTrialPoints(event.target.value)} placeholder="尚未設定" /></label><p className="muted compact-copy">符合資格的新帳號只會取得一次，可用於自然語言 AI 搜尋；之後調整不會回頭修改已發放點數。</p><button disabled={loading || saving} onClick={() => void saveTrial()}>{saving ? '儲存中…' : '儲存搜尋體驗點數'}</button></div><div className="settings-block trial-status-block"><h3>體驗發放狀態</h3>{!trial ? <><strong>目前尚未啟用</strong><p className="muted">設定點數後，符合資格的新帳號才會收到一次性 AI 搜尋體驗。</p></> : <><strong>目前可發放</strong><p className="muted">新符合資格的免費用戶會依目前設定取得一次性 AI 搜尋體驗點數。</p></>}</div></div>
        {trial && <div className="metric-grid compact-metrics"><Metric name="目前發放量" value={trial.freeInitialAiTrialPoints}/><Metric name="已發放帳號" value={trial.recipients}/><Metric name="已耗盡帳號" value={trial.exhaustedRecipients}/><Metric name="累計已發放" value={trial.issuedPoints}/><Metric name="目前剩餘" value={trial.remainingPoints}/><Metric name="累計已消耗" value={trial.consumedPoints}/></div>}
      </article>

      <article className="card plan-card">
        <div className="plan-section-head"><span className="plan-badge paid">訂閱方案</span><p className="muted">方案清單由後端提供，可新增方案並分別設定功能與資源上限。</p></div>
        <div className="subscription-selector"><label>訂閱方案<select value={adding ? '__NEW__' : selectedCode} disabled={loading || saving} onChange={(event) => event.target.value === '__NEW__' ? startAddPlan() : selectPlan(event.target.value)}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.displayName} · NT${Number(plan.priceTwd).toLocaleString('zh-TW')}／月</option>)}<option value="__NEW__">＋ 新增訂閱方案</option></select></label><button className="ghost" disabled={loading || saving} onClick={startAddPlan}>新增方案</button></div>

        <div className="section-divider"/><h3>{adding ? '新增訂閱方案' : `編輯 ${selected?.displayName ?? '訂閱方案'}`}</h3>
        <div className="form-grid"><label>方案名稱<input value={draft.displayName} onChange={(e)=>setDraft({...draft,displayName:e.target.value})} placeholder="例如 AI Pro Plus" /></label><label>每月售價（TWD）<input inputMode="decimal" value={draft.priceTwd} onChange={(e)=>setDraft({...draft,priceTwd:e.target.value})} placeholder="例如 199" /></label><Toggle label="啟用此方案" checked={draft.enabled} disabled={loading||saving} onChange={(value)=>setDraft({...draft,enabled:value})}/></div>

        <div className="section-divider"/><h3>功能設定</h3><p className="muted">免費方案的 AI 額度只用於 AI 搜尋；以下其他 AI 功能都需要有效的訂閱方案。</p>
        <div className="feature-switch-grid"><Toggle label="圖片／音訊／檔案 AI" checked={draft.aiMediaIngestion} disabled={loading||saving} onChange={(v)=>setDraft({...draft,aiMediaIngestion:v})}/><Toggle label="AI 自然語言搜尋" checked={draft.aiNaturalSearch} disabled={loading||saving} onChange={(v)=>setDraft({...draft,aiNaturalSearch:v})}/><Toggle label="相關紀錄推薦" checked={draft.aiRelatedRecords} disabled={loading||saving} onChange={(v)=>setDraft({...draft,aiRelatedRecords:v})}/><Toggle label="時間區間摘要" checked={draft.aiTimeRangeSummary} disabled={loading||saving} onChange={(v)=>setDraft({...draft,aiTimeRangeSummary:v})}/><Toggle label="AI 改寫建議" checked={draft.aiRecordRewrite} disabled={loading||saving} onChange={(v)=>setDraft({...draft,aiRecordRewrite:v})}/><Toggle label="AI 待辦建議" checked={draft.aiTaskProposal} disabled={loading||saving} onChange={(v)=>setDraft({...draft,aiTaskProposal:v})}/></div>

        <div className="section-divider"/><h3>AI 使用與成本上限</h3><p className="muted">這些數值用來控制方案資源與成本，不是使用者的現金餘額。</p>
        <div className="form-grid"><label>每月 AI 點數上限<input type="number" min="1" value={draft.monthlyAiPointCap} onChange={(e)=>setDraft({...draft,monthlyAiPointCap:e.target.value})}/></label><label>每月 AI 供應商成本上限（TWD）<input inputMode="decimal" value={draft.monthlyProviderCostCapTwd} onChange={(e)=>setDraft({...draft,monthlyProviderCostCapTwd:e.target.value})}/></label><label>單次 AI 點數上限（選填）<input type="number" min="1" value={draft.perRequestAiPointCap} onChange={(e)=>setDraft({...draft,perRequestAiPointCap:e.target.value})}/></label></div>

        <div className="section-divider"/><h3>圖片、音訊與檔案限制</h3><p className="muted">「單次最多圖片數」是指一次 AI 請求最多可傳幾張圖片，不是帳號總共可傳幾張。目前前端一次只傳 1 張，保留此設定方便之後支援多圖。</p>
        <div className="form-grid"><label>單次最多圖片數<input type="number" min="1" max="10" value={draft.maxImagesPerRequest} onChange={(e)=>setDraft({...draft,maxImagesPerRequest:e.target.value})}/></label><label>單張圖片上限（MB）<input type="number" min="1" max="20" value={draft.maxImageMb} onChange={(e)=>setDraft({...draft,maxImageMb:e.target.value})}/></label><label>單段音訊最長秒數<input type="number" min="1" max="3600" value={draft.maxAudioSeconds} onChange={(e)=>setDraft({...draft,maxAudioSeconds:e.target.value})}/></label><label>單段音訊上限（MB）<input type="number" min="1" max="30" value={draft.maxAudioMb} onChange={(e)=>setDraft({...draft,maxAudioMb:e.target.value})}/></label><label>單一檔案上限（MB）<input type="number" min="1" max="30" value={draft.maxFileMb} onChange={(e)=>setDraft({...draft,maxFileMb:e.target.value})}/></label></div>
        <button disabled={loading || saving} onClick={() => void savePlan()}>{saving ? '儲存中…' : adding ? '新增訂閱方案' : '儲存方案設定'}</button>
      </article>
    </section>
  </main>;
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
