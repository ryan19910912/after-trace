import { useEffect, useState } from 'react';
import type { AdminAiRuntimeConfig, AdminApi } from './api';

const SESSION_KEY = 'aftertrace.admin.session';

type Draft = {
  provider: string;
  model: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  audioUsdPerMillion: string;
  imageUsdPerMillion: string;
  usdTwdRate: string;
};

const EMPTY_DRAFT: Draft = {
  provider: 'GOOGLE',
  model: '',
  inputUsdPerMillion: '',
  outputUsdPerMillion: '',
  audioUsdPerMillion: '',
  imageUsdPerMillion: '',
  usdTwdRate: '',
};

export function AdminAiRuntimePage({ api }: { api: AdminApi }) {
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [saved, setSaved] = useState<AdminAiRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY);
    api.setSessionToken(token);
    if (!token) {
      setError('請先登入管理後台。');
      setLoading(false);
      return;
    }
    void load();
  }, [api]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const config = await api.aiRuntime();
      setSaved(config);
      setDraft(config ? fromConfig(config) : { ...EMPTY_DRAFT });
    } catch (cause) {
      setError(message(cause, 'AI 模型與成本設定載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const validation = validate(draft);
    if (validation) { setError(validation); return; }
    if (!window.confirm('確定儲存目前的 AI 模型、價格與匯率？這些數值會影響 AI 成本計算與免費額度試算。')) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const config = await api.saveAiRuntime({
        provider: 'GOOGLE',
        model: draft.model.trim(),
        inputUsdPerMillion: draft.inputUsdPerMillion.trim(),
        outputUsdPerMillion: draft.outputUsdPerMillion.trim(),
        audioUsdPerMillion: nullable(draft.audioUsdPerMillion),
        imageUsdPerMillion: nullable(draft.imageUsdPerMillion),
        usdTwdRate: nullable(draft.usdTwdRate),
      });
      setSaved(config);
      setDraft(fromConfig(config));
      setNotice('AI 模型與成本設定已儲存。');
    } catch (cause) {
      setError(message(cause, 'AI 模型與成本設定儲存失敗'));
    } finally {
      setSaving(false);
    }
  }

  return <main className="shell">
    <header className="topbar admin-hero">
      <div>
        <p className="eyebrow">AFTERTRACE ADMIN</p>
        <h1>AI 模型與成本設定</h1>
        <p className="muted">設定目前使用的 Gemini 模型、官方計價與美元匯率，供點數、成本上限與免費體驗試算使用。</p>
      </div>
      <button disabled={loading || saving} onClick={() => void load()}>重新整理</button>
    </header>

    {error ? <div className="banner error">{error}</div> : null}
    {notice ? <div className="banner success">{notice}</div> : null}

    <section className="stack">
      <article className="card">
        <div className="plan-section-head">
          <span className="plan-badge paid">AI Runtime</span>
          <p className="muted">價格請依供應商目前官方計價填寫；AFTERTRACE 不會自動猜測或替你更新價格。</p>
        </div>
        <div className="form-grid">
          <label>AI 供應商<input value="Google" disabled /></label>
          <label>模型名稱<input value={draft.model} disabled={loading || saving} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="例如：gemini-2.5-flash" /></label>
          <label>USD / TWD 匯率<input inputMode="decimal" value={draft.usdTwdRate} disabled={loading || saving} onChange={(event) => setDraft({ ...draft, usdTwdRate: event.target.value })} placeholder="例如：32.5" /></label>
        </div>
      </article>

      <article className="card">
        <h2>模型價格</h2>
        <p className="muted">單位皆為美元／每 100 萬計價單位。輸出價格與匯率是目前 readiness 與點數試算必要設定。</p>
        <div className="form-grid">
          <label>輸入價格<input inputMode="decimal" value={draft.inputUsdPerMillion} disabled={loading || saving} onChange={(event) => setDraft({ ...draft, inputUsdPerMillion: event.target.value })} placeholder="例如：0.30" /></label>
          <label>輸出價格<input inputMode="decimal" value={draft.outputUsdPerMillion} disabled={loading || saving} onChange={(event) => setDraft({ ...draft, outputUsdPerMillion: event.target.value })} placeholder="例如：2.50" /></label>
          <label>音訊價格（選填）<input inputMode="decimal" value={draft.audioUsdPerMillion} disabled={loading || saving} onChange={(event) => setDraft({ ...draft, audioUsdPerMillion: event.target.value })} placeholder="沒有獨立價格可留白" /></label>
          <label>圖片價格（選填）<input inputMode="decimal" value={draft.imageUsdPerMillion} disabled={loading || saving} onChange={(event) => setDraft({ ...draft, imageUsdPerMillion: event.target.value })} placeholder="沒有獨立價格可留白" /></label>
        </div>
        <div className="actions"><button className="primary-action" disabled={loading || saving} onClick={() => void save()}>{saving ? '儲存中…' : saved ? '儲存變更' : '建立 AI Runtime 設定'}</button></div>
      </article>

      <article className="card">
        <h2>這些設定會影響什麼？</h2>
        <div className="cost-preview-grid">
          <div><b>免費 AI 體驗試算</b><span>把想贈送的 TWD 成本換算成建議 AI 點數。</span></div>
          <div><b>訂閱成本控制</b><span>計算方案的供應商成本與每月安全上限。</span></div>
          <div><b>營運分析</b><span>讓後台成本與獲利報表使用一致的價格基準。</span></div>
        </div>
      </article>
    </section>
  </main>;
}

function fromConfig(config: AdminAiRuntimeConfig): Draft {
  return {
    provider: config.provider || 'GOOGLE',
    model: config.model || '',
    inputUsdPerMillion: config.input_usd_per_million || '',
    outputUsdPerMillion: config.output_usd_per_million || '',
    audioUsdPerMillion: config.audio_usd_per_million ?? '',
    imageUsdPerMillion: config.image_usd_per_million ?? '',
    usdTwdRate: config.usd_twd_rate ?? '',
  };
}

function validate(draft: Draft): string | null {
  if (!draft.model.trim()) return '請輸入模型名稱。';
  if (!decimal(draft.inputUsdPerMillion, true)) return '請輸入有效的輸入價格。';
  if (!decimal(draft.outputUsdPerMillion, false)) return '輸出價格必須大於 0。';
  if (draft.audioUsdPerMillion.trim() && !decimal(draft.audioUsdPerMillion, true)) return '音訊價格格式不正確。';
  if (draft.imageUsdPerMillion.trim() && !decimal(draft.imageUsdPerMillion, true)) return '圖片價格格式不正確。';
  if (!decimal(draft.usdTwdRate, false)) return 'USD / TWD 匯率必須大於 0。';
  return null;
}

function decimal(value: string, allowZero: boolean): boolean {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return false;
  const number = Number(normalized);
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0);
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function message(cause: unknown, fallback: string): string {
  const code = cause instanceof Error ? cause.message : '';
  const labels: Record<string, string> = {
    AI_PROVIDER_NOT_SUPPORTED: '目前只支援 Google AI。',
    AI_OUTPUT_PRICE_MUST_BE_POSITIVE: '輸出價格必須大於 0。',
    INVALID_USD_TWD_RATE: 'USD / TWD 匯率格式不正確。',
  };
  return labels[code] ?? (cause instanceof Error && cause.message ? cause.message : fallback);
}
