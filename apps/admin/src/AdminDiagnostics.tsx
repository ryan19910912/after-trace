import { useMemo, useState } from 'react';
import type { Row } from './api';

type AnomalyProps = {
  rows: Row[];
  busy: boolean;
  onChange: (row: Row, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => Promise<void>;
};

type ModalState =
  | { kind: 'ANOMALY'; row: Row }
  | { kind: 'AUDIT'; row: Row }
  | null;

type DiffRow = { field: string; before: unknown; after: unknown; changed: boolean };

export function AnomalyEventTable({ rows, busy, onChange }: AnomalyProps) {
  const [modal, setModal] = useState<ModalState>(null);
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;
  return <>
    <div className="table-wrap"><table><thead><tr>
      {['編號','嚴重程度','狀態','分類','錯誤代碼','摘要','使用者編號','來源編號','LINE 訊息 ID','建立時間','操作'].map((title) => <th key={title}>{title}</th>)}
    </tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row.id ?? index)}-${index}`}>
      <td>{display(row.id)}</td><td>{display(row.severity)}</td><td>{display(row.status)}</td><td>{display(row.category)}</td>
      <td>{display(row.error_code)}</td><td>{short(row.summary)}</td><td>{display(row.user_id)}</td><td>{display(row.source_id)}</td>
      <td>{display(row.line_message_id)}</td><td>{display(row.created_at)}</td>
      <td><div className="row-actions diagnostic-actions">
        <button className="ghost" onClick={() => setModal({ kind: 'ANOMALY', row })}>詳細錯誤訊息</button>
        <button disabled={busy} onClick={() => void onChange(row, 'OPEN')}>待處理</button>
        <button disabled={busy} onClick={() => void onChange(row, 'RESOLVED')}>已解決</button>
        <button className="ghost" disabled={busy} onClick={() => void onChange(row, 'IGNORED')}>忽略</button>
      </div></td>
    </tr>)}</tbody></table></div>
    {modal?.kind === 'ANOMALY' && <AnomalyModal row={modal.row} onClose={() => setModal(null)} />}
  </>;
}

export function AuditLogTable({ rows }: { rows: Row[] }) {
  const [modal, setModal] = useState<ModalState>(null);
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;
  return <>
    <div className="table-wrap"><table><thead><tr>
      {['編號','操作管理員','操作使用者','工作區','操作','目標類型','目標編號','修改內容','建立時間'].map((title) => <th key={title}>{title}</th>)}
    </tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row.id ?? index)}-${index}`}>
      <td>{display(row.id)}</td><td>{display(row.actor_admin)}</td>
      <td>{display(row.actor_user_context ?? row.actor_user_id)}</td><td>{display(row.workspace_context ?? row.workspace_id)}</td>
      <td>{display(row.action)}</td><td>{display(row.target_type)}</td><td>{display(row.target_id)}</td>
      <td><button className="ghost" onClick={() => setModal({ kind: 'AUDIT', row })}>查看修改內容</button></td>
      <td>{display(row.created_at)}</td>
    </tr>)}</tbody></table></div>
    {modal?.kind === 'AUDIT' && <AuditDiffModal row={modal.row} onClose={() => setModal(null)} />}
  </>;
}

function AnomalyModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const detail = String(row.error_detail ?? row.summary ?? '沒有詳細錯誤內容');
  return <Modal title={`異常 #${display(row.id)} 詳細錯誤訊息`} onClose={onClose}>
    <div className="diagnostic-summary-grid">
      <div><strong>分類</strong><span>{display(row.category)}</span></div>
      <div><strong>錯誤代碼</strong><span>{display(row.error_code)}</span></div>
      <div><strong>使用者編號</strong><span>{display(row.user_id)}</span></div>
      <div><strong>來源編號</strong><span>{display(row.source_id)}</span></div>
      <div><strong>LINE 訊息 ID</strong><span>{display(row.line_message_id)}</span></div>
      <div><strong>Request Ref</strong><span>{display(row.request_ref)}</span></div>
    </div>
    <h3>完整錯誤內容</h3><pre className="error-detail">{detail}</pre>
    {isRecord(row.metadata) && Object.keys(row.metadata).length > 0 && <><h3>附加資訊</h3><DiagnosticObject value={row.metadata} /></>}
  </Modal>;
}

function AuditDiffModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const diff = useMemo(() => diffValues(row.before_value, row.after_value), [row]);
  return <Modal title={`操作 #${display(row.id)} 修改內容`} onClose={onClose}>
    <div className="diagnostic-summary-grid">
      <div><strong>操作</strong><span>{display(row.action)}</span></div>
      <div><strong>目標類型</strong><span>{display(row.target_type)}</span></div>
      <div><strong>目標編號</strong><span>{display(row.target_id)}</span></div>
      <div><strong>操作人員</strong><span>{display(row.actor_admin ?? row.actor_user_context)}</span></div>
    </div>
    <div className="diff-legend"><span className="diff-chip unchanged">綠色：未修改</span><span className="diff-chip changed">紅色：有修改</span></div>
    <div className="diff-list">{diff.map((item) => <div className={`diff-row ${item.changed ? 'changed' : 'unchanged'}`} key={item.field}>
      <strong>{fieldLabel(item.field)}</strong>
      <div><small>修改前</small><span>{valueText(item.before)}</span></div>
      <div><small>修改後</small><span>{valueText(item.after)}</span></div>
    </div>)}</div>
  </Modal>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
    <header className="modal-head"><h2>{title}</h2><button className="ghost" onClick={onClose}>關閉</button></header>{children}
  </section></div>;
}

function DiagnosticObject({ value }: { value: Record<string, unknown> }) {
  const rows = flatten(value);
  return <div className="diagnostic-object">{rows.map(([key, item]) => <div key={key}><strong>{fieldLabel(key)}</strong><span>{valueText(item)}</span></div>)}</div>;
}

export function diffValues(before: unknown, after: unknown): DiffRow[] {
  const left = flatten(isRecord(before) ? before : {});
  const right = flatten(isRecord(after) ? after : {});
  const leftMap = new Map(left);
  const rightMap = new Map(right);
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  if (keys.length === 0) return [{ field: '資料', before, after, changed: !same(before, after) }];
  return keys.map((field) => {
    const previous = leftMap.get(field);
    const next = rightMap.get(field);
    return { field, before: previous, after: next, changed: !same(previous, next) };
  });
}

function flatten(value: Record<string, unknown>, prefix = ''): Array<[string, unknown]> {
  const result: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(item)) result.push(...flatten(item, path));
    else result.push([path, item]);
  }
  return result;
}

const FIELD_LABELS: Record<string, string> = {
  id:'編號', code:'方案代碼', plan_type:'方案類型', display_name:'顯示名稱', price_twd:'價格', rank:'排序順位', enabled:'啟用',
  grant_points:'AI 點數', capabilities:'功能權限', model:'AI 模型', provider:'AI 供應商', input_usd_per_million:'一般輸入價格',
  output_usd_per_million:'輸出價格', audio_usd_per_million:'音訊輸入價格', image_usd_per_million:'圖片輸入價格', usd_twd_rate:'美元兌新台幣匯率',
  status:'狀態', updated_at:'更新時間', created_at:'建立時間', updated_by:'更新人員', user_id:'使用者編號', source_id:'來源編號',
};

function fieldLabel(path: string): string {
  return path.split('.').map((part) => FIELD_LABELS[part] ?? part.replaceAll('_', ' ')).join(' › ');
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function valueText(value: unknown): string { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'boolean') return value ? '是' : '否'; if (Array.isArray(value)) return value.map(valueText).join('、') || '—'; return String(value); }
function short(value: unknown): string { const text = valueText(value); return text.length > 160 ? `${text.slice(0, 157)}…` : text; }
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date);
  }
  return text;
}
