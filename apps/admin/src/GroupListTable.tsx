import type { Row } from './api';
import { formatAdminDateTime } from './time-display';

type Props = {
  rows: Row[];
  onRow: (row: Row) => void;
};

export function GroupListTable({ rows, onRow }: Props) {
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;

  return <div className="table-wrap"><table className="group-list-table"><thead><tr>
    <th>編號</th>
    <th>LINE 群組</th>
    <th>狀態</th>
    <th>AI 額度負責人</th>
    <th>目前可用點數</th>
    <th>執行中保留點數</th>
    <th>歷史實扣點數</th>
    <th>平台吸收點數</th>
    <th>平台實際 AI 成本</th>
    <th>啟用成員數</th>
    <th>紀錄數</th>
    <th>更新時間</th>
  </tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row.id ?? index)}-${index}`} className="clickable" onClick={() => onRow(row)}>
    <td>{display(row.id)}</td>
    <td><StackedValue primary={row.line_group_name} secondary={row.line_group_id} primaryFallback="尚未同步群組名稱" /></td>
    <td>{display(row.status)}</td>
    <td><StackedValue primary={row.ai_responsible_display_name} secondary={row.ai_responsible_user_id} primaryFallback="尚未設定" secondaryPrefix="編號 #" /></td>
    <td>{display(row.ai_available_points)}</td>
    <td>{display(row.ai_reserved_points)}</td>
    <td>{display(row.group_ai_used_points)}</td>
    <td>{display(row.platform_subsidized_points)}</td>
    <td>{money(row.group_ai_cost_twd)}</td>
    <td>{display(row.active_members)}</td>
    <td>{display(row.record_count)}</td>
    <td>{formatAdminDateTime(row.updated_at)}</td>
  </tr>)}</tbody></table></div>;
}

function StackedValue({ primary, secondary, primaryFallback, secondaryPrefix = '' }: { primary: unknown; secondary: unknown; primaryFallback: string; secondaryPrefix?: string }) {
  const top = text(primary) || primaryFallback;
  const bottom = text(secondary);
  return <div className="stacked-cell"><strong>{top}</strong><span>{bottom ? `${secondaryPrefix}${bottom}` : '—'}</span></div>;
}

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value).trim(); }
function display(value: unknown): string { const valueText = text(value); return valueText || '—'; }
function money(value: unknown): string { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? `NT$ ${parsed.toFixed(4)}` : '—'; }
