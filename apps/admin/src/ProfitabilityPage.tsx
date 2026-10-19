import { useEffect, useMemo, useState } from 'react';
import type {
  AdminApi,
  AdminProfitabilityPeriod,
  AdminProfitabilityReport,
} from './api';

const SESSION_KEY = 'aftertrace.admin.session';
const PERIODS: Array<{ value: AdminProfitabilityPeriod; label: string }> = [
  { value: 'TODAY', label: '今天' },
  { value: '7D', label: '近 7 天' },
  { value: '30D', label: '近 30 天' },
  { value: 'BILLING_MONTH', label: '本月' },
];

type Props = { api: AdminApi };

export function ProfitabilityPage({ api }: Props) {
  const [period, setPeriod] = useState<AdminProfitabilityPeriod>('TODAY');
  const [report, setReport] = useState<AdminProfitabilityReport | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
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
    void api.session().then(() => {
      if (!active) return;
      setSessionReady(true);
    }).catch(() => {
      if (!active) return;
      clearAdminSession(api);
      setSessionReady(false);
      setReport(null);
      setError('管理員登入已失效，請重新登入。');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!sessionReady) return;
    let active = true;
    setLoading(true);
    setError(null);
    void api.profitability(period).then((value) => {
      if (!active) return;
      setReport(value);
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      if (isAdminSessionError(cause)) {
        clearAdminSession(api);
        setSessionReady(false);
        setReport(null);
        setError('管理員登入已失效，請重新登入。');
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, period, sessionReady]);

  const metrics = useMemo(() => {
    if (!report) return [];
    const summary = report.summary;
    return [
      ['AI 請求數', summary.requests.toLocaleString()],
      ['實際操作使用者', summary.activeUsers.toLocaleString()],
      ['被扣點使用者', summary.chargedUsers.toLocaleString()],
      ['客戶承擔 AI 點數', Math.round(summary.customerPointsCharged).toLocaleString()],
      ['平台補貼 AI 點數', Math.round(summary.platformSubsidizedPoints).toLocaleString()],
      ['供應商成本（美元）', `$${money(summary.providerCostUsd, 6)}`],
      ['供應商成本（新台幣）', `NT$ ${money(summary.providerCostTwd, 4)}`],
      ['平均點數／請求', number(summary.averagePointsPerRequest, 2)],
      ['平均美元成本／請求', `$${money(summary.averageProviderCostUsdPerRequest, 6)}`],
      ['平均新台幣成本／請求', nullableTwd(summary.averageProviderCostTwdPerRequest)],
      ['平均點數／實際操作使用者', number(summary.averagePointsPerActiveUser, 2)],
      ['平均美元成本／實際操作使用者', `$${money(summary.averageProviderCostUsdPerActiveUser, 6)}`],
      ['平均新台幣成本／實際操作使用者', nullableTwd(summary.averageProviderCostTwdPerActiveUser)],
      ['平均點數／被扣點使用者', number(summary.averagePointsPerChargedUser, 2)],
    ] as const;
  }, [report]);

  return <main className="shell">
    <header className="topbar admin-hero">
      <div>
        <p className="eyebrow">AFTERTRACE ADMIN</p>
        <h1>AI 成本與點數報表</h1>
        <p className="muted">查看指定期間內的 AI 使用量、點數消耗與成本統計，協助掌握營運狀況與方案調整方向。</p>
      </div>
    </header>

    {error && <div className="banner error">{error}</div>}

    <section className="stack">
      <article className="card filter-card report-filter-card">
        <label>報表期間
          <select value={period} onChange={(event) => setPeriod(event.target.value as AdminProfitabilityPeriod)} disabled={loading || !sessionReady}>
            {PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {report && <p className="muted">{formatDate(report.summary.from)} ～ {formatDate(report.summary.to)}</p>}
      </article>

      {loading && <article className="card"><p className="muted">載入報表中…</p></article>}

      {report && <>
        <div className="metric-grid report-metric-grid">
          {metrics.map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </div>

        {(report.summary.missingProviderCostTwdRequests > 0 || report.summary.missingSubsidyCostTwdRequests > 0) &&
          <div className="banner error">
            新台幣成本資料不完整：{report.summary.missingProviderCostTwdRequests} 筆請求缺少供應商新台幣成本，
            {report.summary.missingSubsidyCostTwdRequests} 筆補貼請求缺少新台幣補貼成本。缺值期間的新台幣平均值會顯示為「資料不完整」。
          </div>}

        <article className="card report-section-card">
          <h2>營收與毛利</h2>
          <p className="muted">目前尚未接入正式付款成功資料，因此此區暫不顯示營收、成本占比與毛利；完成付款資料串接後會自動顯示。</p>
        </article>

        <Breakdown title="依模型統計" rows={report.byModel} />
        <Breakdown title="依 AI 操作統計" rows={report.byOperation} />
        <Breakdown title="依來源類型統計" rows={report.bySourceType} />

        <article className="card report-section-card">
          <h2>依方案來源統計的已扣點數</h2>
          <p className="muted">僅依實際發生的點數扣除紀錄統計，不會依目前方案狀態回補過去資料。</p>
          <table><thead><tr><th>方案</th><th>請求數</th><th>已扣點數</th></tr></thead><tbody>
            {report.byPlan.map((row) => <tr key={row.planCode}><td>{row.planCode}</td><td>{row.requests.toLocaleString()}</td><td>{row.pointsCharged.toLocaleString()}</td></tr>)}
          </tbody></table>
        </article>

        <article className="card report-section-card">
          <h2>依點數來源類型統計的已扣點數</h2>
          <p className="muted">依實際扣點來源分類，方便比較免費試用、訂閱週期與管理員發放等不同來源的使用量。</p>
          <table><thead><tr><th>點數來源</th><th>請求數</th><th>已扣點數</th></tr></thead><tbody>
            {report.byGrantType.map((row) => <tr key={row.grantType}><td>{grantTypeLabel(row.grantType)}</td><td>{row.requests.toLocaleString()}</td><td>{row.pointsCharged.toLocaleString()}</td></tr>)}
          </tbody></table>
        </article>

        <article className="card report-section-card">
          <h2>目前有效點數庫存</h2>
          <p className="muted">僅統計已生效、未到期且未撤銷的點數。已使用與保留中的點數會分開顯示，方便掌握實際可用餘額。</p>
          <table><thead><tr><th>點數來源</th><th>筆數</th><th>耗盡筆數</th><th>原始點數</th><th>已使用</th><th>保留中</th><th>可用餘額</th><th>使用率</th><th>耗盡率</th></tr></thead><tbody>
            {report.grantInventory.map((row) => <tr key={row.grantType}>
              <td>{grantTypeLabel(row.grantType)}</td><td>{row.grants.toLocaleString()}</td><td>{row.exhaustedGrants.toLocaleString()}</td>
              <td>{row.originalPoints.toLocaleString()}</td><td>{row.usedPoints.toLocaleString()}</td>
              <td>{row.reservedPoints.toLocaleString()}</td><td>{row.remainingPoints.toLocaleString()}</td>
              <td>{percent(row.utilizationPercent)}</td><td>{percent(row.exhaustionPercent)}</td>
            </tr>)}
          </tbody></table>
        </article>
      </>}
    </section>
  </main>;
}

function Breakdown({ title, rows }: { title: string; rows: AdminProfitabilityReport['byModel'] }) {
  return <article className="card report-section-card">
    <h2>{title}</h2>
    <table><thead><tr><th>項目</th><th>請求數</th><th>操作使用者</th><th>被扣點使用者</th><th>已扣點數</th><th>補貼點數</th><th>美元成本</th><th>新台幣成本</th><th>成本缺值</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.key}>
        <td>{row.key}</td><td>{row.requests.toLocaleString()}</td><td>{row.activeUsers.toLocaleString()}</td><td>{row.chargedUsers.toLocaleString()}</td>
        <td>{row.customerPointsCharged.toLocaleString()}</td><td>{row.platformSubsidizedPoints.toLocaleString()}</td>
        <td>${money(row.providerCostUsd, 6)}</td><td>NT$ {money(row.providerCostTwd, 4)}</td>
        <td>{row.missingProviderCostTwdRequests.toLocaleString()}</td>
      </tr>)}
    </tbody></table>
  </article>;
}

function grantTypeLabel(value: string): string {
  return value === 'FREE_INITIAL' ? '免費試用' : value === 'SUBSCRIPTION_PERIOD' ? '訂閱週期' : value === 'ADMIN' ? '管理員發放' : value;
}

function clearAdminSession(api: AdminApi) {
  sessionStorage.removeItem(SESSION_KEY);
  api.setSessionToken(null);
}

function isAdminSessionError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  return /ADMIN_SESSION_(?:REQUIRED|INVALID)/.test(text);
}

function money(value: string, digits: number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0';
}

function nullableTwd(value: string | null): string {
  return value === null ? '資料不完整' : `NT$ ${money(value, 4)}`;
}

function number(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '0';
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '0.0%';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}
