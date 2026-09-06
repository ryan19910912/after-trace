import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Row } from './api';
import { formatAdminDateTime, formatAdminValueDateTime } from './time-display';

type AnomalyProps = { rows: Row[]; busy: boolean; onChange: (row: Row, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => Promise<void> };
type ModalState = { kind: 'ANOMALY'; row: Row } | { kind: 'AUDIT'; row: Row } | null;
type DiffRow = { field: string; before: unknown; after: unknown; changed: boolean };

export function AnomalyEventTable({ rows, busy, onChange }: AnomalyProps) {
  const [modal, setModal] = useState<ModalState>(null);
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;
  return <>
    <div className="table-wrap"><table><thead><tr>{['編號','嚴重程度','狀態','分類','錯誤代碼','摘要','使用者編號','來源編號','LINE 訊息 ID','建立時間','操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
      <tbody>{rows.map((row,index) => <tr key={`${String(row.id ?? index)}-${index}`}>
        <td>{display(row.id)}</td><td>{display(row.severity)}</td><td>{display(row.status)}</td><td>{display(row.category)}</td><td>{display(row.error_code)}</td>
        <td>{short(row.summary)}</td><td>{display(row.user_id)}</td><td>{display(row.source_id)}</td><td>{display(row.line_message_id)}</td><td>{formatAdminDateTime(row.created_at)}</td>
        <td><div className="row-actions" style={{ minWidth: 320, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => setModal({ kind:'ANOMALY', row })}>詳細錯誤訊息</button>
          <button disabled={busy} onClick={() => void onChange(row,'OPEN')}>待處理</button>
          <button disabled={busy} onClick={() => void onChange(row,'RESOLVED')}>已解決</button>
          <button className="ghost" disabled={busy} onClick={() => void onChange(row,'IGNORED')}>忽略</button>
        </div></td>
      </tr>)}</tbody></table></div>
    {modal?.kind === 'ANOMALY' && <AnomalyModal row={modal.row} onClose={() => setModal(null)} />}
  </>;
}

export function AuditLogTable({ rows }: { rows: Row[] }) {
  const [modal,setModal] = useState<ModalState>(null);
  if (rows.length === 0) return <p className="empty">沒有資料。</p>;
  return <>
    <div className="table-wrap"><table><thead><tr>{['編號','操作管理員','操作使用者','工作區','操作','目標類型','目標編號','修改內容','建立時間'].map((title)=><th key={title}>{title}</th>)}</tr></thead>
      <tbody>{rows.map((row,index)=><tr key={`${String(row.id ?? index)}-${index}`}>
        <td>{display(row.id)}</td><td>{display(row.actor_admin)}</td><td>{display(row.actor_user_context ?? row.actor_user_id)}</td><td>{display(row.workspace_context ?? row.workspace_id)}</td>
        <td>{display(row.action)}</td><td>{display(row.target_type)}</td><td>{display(row.target_id)}</td><td><button className="ghost" onClick={()=>setModal({kind:'AUDIT',row})}>查看修改內容</button></td><td>{formatAdminDateTime(row.created_at)}</td>
      </tr>)}</tbody></table></div>
    {modal?.kind === 'AUDIT' && <AuditDiffModal row={modal.row} onClose={()=>setModal(null)} />}
  </>;
}

function AnomalyModal({ row,onClose }:{row:Row;onClose:()=>void}) {
  const detail=String(row.error_detail ?? row.summary ?? '沒有詳細錯誤內容');
  return <Modal title={`異常 #${display(row.id)} 詳細錯誤訊息`} onClose={onClose}>
    <div style={summaryGridStyle}>
      <Summary label="分類" value={row.category}/><Summary label="錯誤代碼" value={row.error_code}/><Summary label="使用者編號" value={row.user_id}/><Summary label="來源編號" value={row.source_id}/><Summary label="LINE 訊息 ID" value={row.line_message_id}/><Summary label="Request Ref" value={row.request_ref}/>
    </div>
    <h3>完整錯誤內容</h3><pre style={errorDetailStyle}>{detail}</pre>
    {isRecord(row.metadata) && Object.keys(row.metadata).length>0 && <><h3>附加資訊</h3><DiagnosticObject value={row.metadata}/></>}
  </Modal>;
}

function AuditDiffModal({ row,onClose }:{row:Row;onClose:()=>void}) {
  const diff=useMemo(()=>diffValues(row.before_value,row.after_value),[row]);
  return <Modal title={`操作 #${display(row.id)} 修改內容`} onClose={onClose}>
    <div style={summaryGridStyle}><Summary label="操作" value={row.action}/><Summary label="目標類型" value={row.target_type}/><Summary label="目標編號" value={row.target_id}/><Summary label="操作人員" value={row.actor_admin ?? row.actor_user_context}/></div>
    <div style={{display:'flex',gap:8,margin:'16px 0'}}><span style={greenChipStyle}>綠色：未修改</span><span style={redChipStyle}>紅色：有修改</span></div>
    <div style={{display:'grid',gap:8}}>{diff.map((item)=><div key={item.field} style={{...diffRowStyle,...(item.changed?redDiffStyle:greenDiffStyle)}}>
      <strong>{fieldLabel(item.field)}</strong><div><small style={smallStyle}>修改前</small><span style={valueStyle}>{valueText(item.before)}</span></div><div><small style={smallStyle}>修改後</small><span style={valueStyle}>{valueText(item.after)}</span></div>
    </div>)}</div>
  </Modal>;
}

function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}) { return <div style={backdropStyle} onMouseDown={onClose}><section style={modalStyle} onMouseDown={(event)=>event.stopPropagation()}><header style={modalHeadStyle}><h2 style={{margin:0}}>{title}</h2><button className="ghost" onClick={onClose}>關閉</button></header>{children}</section></div>; }
function Summary({label,value}:{label:string;value:unknown}) { return <div style={summaryItemStyle}><strong style={smallStyle}>{label}</strong><span style={valueStyle}>{display(value)}</span></div>; }
function DiagnosticObject({value}:{value:Record<string,unknown>}) { return <div style={{display:'grid',gap:7}}>{flatten(value).map(([key,item])=><div key={key} style={summaryItemStyle}><strong style={smallStyle}>{fieldLabel(key)}</strong><span style={valueStyle}>{valueText(item)}</span></div>)}</div>; }

export function diffValues(before:unknown,after:unknown):DiffRow[] {
  const left=flattenValue(before), right=flattenValue(after), leftMap=new Map(left), rightMap=new Map(right), keys=[...new Set([...leftMap.keys(),...rightMap.keys()])].sort();
  if(keys.length===0)return[{field:'資料',before,after,changed:!same(before,after)}];
  return keys.map((field)=>{const previous=leftMap.get(field),next=rightMap.get(field);return{field,before:previous,after:next,changed:!same(previous,next)}});
}
function flatten(value:Record<string,unknown>,prefix=''):Array<[string,unknown]>{return flattenValue(value,prefix);}
function flattenValue(value:unknown,prefix=''):Array<[string,unknown]>{
  if(isRecord(value)){
    const result:Array<[string,unknown]>=[];
    for(const[key,item]of Object.entries(value)){const path=prefix?`${prefix}.${key}`:key;result.push(...flattenValue(item,path));}
    return result;
  }
  if(Array.isArray(value)){
    if(value.length===0)return [[prefix||'資料',[]]];
    const result:Array<[string,unknown]>=[];
    value.forEach((item,index)=>result.push(...flattenValue(item,prefix?`${prefix}.${index}`:String(index))));
    return result;
  }
  return [[prefix||'資料',value]];
}
const FIELD_LABELS:Record<string,string>={id:'編號',code:'方案代碼',plan_type:'方案類型',display_name:'顯示名稱',price_twd:'價格',rank:'排序順位',enabled:'啟用',grant_points:'AI 點數',capabilities:'功能權限',capability_definitions:'功能權限定義',model:'AI 模型',provider:'AI 供應商',input_usd_per_million:'一般輸入價格',output_usd_per_million:'輸出價格',audio_usd_per_million:'音訊輸入價格',image_usd_per_million:'圖片輸入價格',usd_twd_rate:'美元兌新台幣匯率',status:'狀態',updated_at:'更新時間',created_at:'建立時間',updated_by:'更新人員',user_id:'使用者編號',source_id:'來源編號'};
function fieldLabel(path:string):string{return path.split('.').map((part)=>FIELD_LABELS[part]??(/^\d+$/.test(part)?`第 ${Number(part)+1} 項`:part.replaceAll('_',' '))).join(' › ');}
function same(left:unknown,right:unknown):boolean{return JSON.stringify(left??null)===JSON.stringify(right??null);}
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value));}
function valueText(value:unknown):string{const time=formatAdminValueDateTime(value);if(time)return time;if(value===null||value===undefined||value==='')return '—';if(typeof value==='boolean')return value?'是':'否';if(Array.isArray(value))return value.map(valueText).join('、')||'—';if(isRecord(value))return JSON.stringify(value);return String(value);}
function short(value:unknown):string{const text=valueText(value);return text.length>160?`${text.slice(0,157)}…`:text;}
function display(value:unknown):string{const time=formatAdminValueDateTime(value);if(time)return time;if(value===null||value===undefined||value==='')return '—';return String(value);}

const backdropStyle:CSSProperties={position:'fixed',inset:0,zIndex:50,background:'rgba(0,0,0,.76)',display:'grid',placeItems:'center',padding:20};
const modalStyle:CSSProperties={width:'min(1050px,96vw)',maxHeight:'88vh',overflow:'auto',background:'#171a1f',border:'1px solid #343a43',borderRadius:16,padding:20,boxShadow:'0 24px 80px rgba(0,0,0,.55)'};
const modalHeadStyle:CSSProperties={display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,marginBottom:18,position:'sticky',top:-20,background:'#171a1f',padding:'14px 0',zIndex:2};
const summaryGridStyle:CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10,marginBottom:16};
const summaryItemStyle:CSSProperties={display:'grid',gap:5,padding:10,border:'1px solid #343a43',borderRadius:10,background:'#111419'};
const errorDetailStyle:CSSProperties={whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:14,border:'1px solid #3a404a',borderRadius:10,background:'#0d0f12',color:'#f5f7fa',fontSize:13,lineHeight:1.55,maxHeight:'45vh',overflow:'auto'};
const diffRowStyle:CSSProperties={display:'grid',gridTemplateColumns:'minmax(150px,.7fr) minmax(220px,1fr) minmax(220px,1fr)',gap:12,padding:12,borderRadius:10,border:'1px solid'};
const greenDiffStyle:CSSProperties={background:'#13251a',borderColor:'#2f6b42'}; const redDiffStyle:CSSProperties={background:'#2a1719',borderColor:'#82414a'};
const greenChipStyle:CSSProperties={padding:'5px 9px',borderRadius:999,background:'#193322',color:'#baf2c8',border:'1px solid #34754a',fontSize:12};
const redChipStyle:CSSProperties={padding:'5px 9px',borderRadius:999,background:'#351a1d',color:'#ffc5ca',border:'1px solid #87454d',fontSize:12};
const smallStyle:CSSProperties={fontSize:12,color:'#9fa7b3'}; const valueStyle:CSSProperties={display:'block',overflowWrap:'anywhere',color:'#edf0f4',marginTop:3};
