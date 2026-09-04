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
  const [username, setUsername] = useState<string | null>(null);
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
    void api.session().then((session) => {
      if (!active) return;
      setUsername(session.username);
    }).catch(() => {
      if (!active) return;
      sessionStorage.removeItem(SESSION_KEY);
      api.setSessionToken(null);
      setError('管理員登入已失效，請重新登入。');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!username) return;
    let active = true;
    setLoading(true);
    setError(null);
    void api.profitability(period).then((value) => {
      if (!active) return;
      setReport(value);
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, period, username]);

  const metrics = useMemo(() => {
    if (!report) return [];
    const summary = report.summary;
    return [
      ['AI 請求', summary.requests.toLocaleString()],
      ['實際操作使用者', summary.activeUsers.toLocaleString()],
      ['被扣點使用者 / 額度負責人', summary.chargedUsers.toLocaleString()],
      ['客戶實扣 AI 點數', Math.round(summary.customerPointsCharged).toLocaleString()],
      ['平台補貼 AI 點數', Math.round(summary.platformSubsidizedPoints).toLocaleString()],
      ['Provider 成本 USD', `$${money(summary.providerCostUsd, 6)}`],
      ['Provider 成本 TWD', `NT$ ${money(summary.providerCostTwd, 4)}`],
      ['平均點數 / Request', number(summary.averagePointsPerRequest, 2)],
      ['平均 USD 成本 / Request', `$${money(summary.averageProviderCostUsdPerRequest, 6)}`],
      ['平均 TWD 成本 / Request', nullableTwd(summary.averageProviderCostTwdPerRequest)],
      ['平均點數 / 實際操作使用者', number(summary.averagePointsPerActiveUser, 2)],
      ['平均 USD 成本 / 實際操作使用者', `$${money(summary.averageProviderCostUsdPerActiveUser, 6)}`],
      ['平均 TWD 成本 / 實際操作使用者', nullableTwd(summary.averageProviderCostTwdPerActiveUser)],
      ['平均點數 / 被扣點使用者', number(summary.averagePointsPerChargedUser, 2)],
    ] as const;
  }, [report]);

  return <main className="shell">
    <header className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>AI 成本與點數報表</h1>
        <p className="muted">{username ? `${username} · ` : ''}只使用 durable usage / Grant accounting 事實</p>
      </div>
      <div className="header-actions"><a href="/">返回管理首頁</a></div>
    </header>

    {error && <div className="banner error">{error}</div>}

    <section className="stack">
      <article className="card filter-card">
        <label>報表期間
          <select value={period} onChange={(event) => setPeriod(event.target.value as AdminProfitabilityPeriod)} disabled={loading}>
            {PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {report && <p className="muted">{formatDate(report.summary.from)} ～ {formatDate(report.summary.to)}</p>}
      </article>

      {loading && <article className="card"><p className="muted">載入報表中…</p></article>}

      {report && <>
        <div className="metric-grid">
          {metrics.map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </div>

        {(report.summary.missingProviderCostTwdRequests > 0 || report.summary.missingSubsidyCostTwdRequests > 0) &&
          <div className="banner error">
            TWD 成本資料不完整：{report.summary.missingProviderCostTwdRequests} 筆 request 缺 provider TWD 成本；
            {report.summary.missingSubsidyCostTwdRequests} 筆補貼 request 缺 TWD 補貼成本。
            缺值期間的 TWD 平均值顯示為「資料不完整」，USD 成本仍是完整主要事實。
          </div>}

        <article className="card">
          <h2>營收 / 毛利</h2>
          <p className="muted">
            目前沒有 durable 成功付款 revenue ledger，因此不以方案牌價或 checkout intent 推算營收。
            `revenueTwd`、AI cost ratio 與 realized gross margin 會維持空值，直到付款成功事實正式接入。
          </p>
        </article>

        <Breakdown title="依模型" rows={report.byModel} />
        <Breakdown title="依 AI 操作" rows={report.byOperation} />
        <Breakdown title="PRIVATE / GROUP" rows={report.bySourceType} />

        <article className="card">
          <h2>依方案來源的實扣點數</h2>
          <p className="muted">只依實際扣到的 Grant 歷史 metadata 歸屬；不拿目前 subscription 狀態回填過去。</p>
          <table><thead><tr><th>方案</th><th>Requests</th><th>實扣點數</th></tr></thead><tbody>
            {report.byPlan.map((row) => <tr key={row.planCode}><td>{row.planCode}</td><td>{row.requests.toLocaleString()}</td><td>{row.pointsCharged.toLocaleString()}</td></tr>)}
          </tbody></table>
        </article>

        <article className="card">
          <h2>依 Grant 類型的實扣點數</h2>
          <table><thead><tr><th>Grant</th><th>Requests</th><th>實扣點數</th></tr></thead><tbody>
            {report.byGrantType.map((row) => <tr key={row.grantType}><td>{row.grantType}</td><td>{row.requests.toLocaleString()}</td><td>{row.pointsCharged.toLocaleString()}</td></tr>)}
          </tbody></table>
        </article>

        <article className="card">
          <h2>目前有效 Grant Inventory</h2>
          <p className="muted">
            只統計已生效、尚未到期且未撤銷的 Grant。使用率只計已 commit 的 used points；
            reserved points 是進行中 request 的暫時 hold，不會混入已使用比例。
          </p>
          <table><thead><tr><th>Grant</th><th>筆數</th><th>耗盡</th><th>原始點數</th><th>已使用</th><th>保留中</th><th>可用餘額</th><th>使用率</th><th>耗盡率</th></tr></thead><tbody>
            {report.grantInventory.map((row) => <tr key={row.grantType}>
              <td>{row.grantType}</td><td>{row.grants.toLocaleString()}</td><td>{row.exhaustedGrants.toLocaleString()}</td>
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
  return <article className="card">
    <h2>{title}</h2>
    <table><thead><tr><th>項目</th><th>Requests</th><th>操作使用者</th><th>被扣點使用者</th><th>實扣點數</th><th>補貼點數</th><th>USD 成本</th><th>TWD 成本</th><th>TWD 缺值</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.key}>
        <td>{row.key}</td><td>{row.requests.toLocaleString()}</td><td>{row.activeUsers.toLocaleString()}</td><td>{row.chargedUsers.toLocaleString()}</td>
        <td>{row.customerPointsCharged.toLocaleString()}</td><td>{row.platformSubsidizedPoints.toLocaleString()}</td>
        <td>${money(row.providerCostUsd, 6)}</td><td>NT$ {money(row.providerCostTwd, 4)}</td>
        <td>{row.missingProviderCostTwdRequests.toLocaleString()}</td>
      </tr>)}
    </tbody></table>
  </article>;
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
