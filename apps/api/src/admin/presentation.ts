import { ADMIN_CAPABILITY_DEFINITIONS } from './capabilities';

type AdminRecord = Record<string, unknown>;

const VALUE_LABELS: Record<string, string> = {
  ACTIVE: '啟用', INACTIVE: '停用', OPEN: '待處理', RESOLVED: '已解決', IGNORED: '已忽略',
  INDIVIDUAL: '一般使用者', GROUP_ENABLED: 'AI 額度負責人', AI_RESPONSIBLE: 'AI 額度負責人',
  USER: '使用者', GROUP: '群組', ENABLED: '啟用', DISABLED: '停用', FAILED: '失敗', PENDING: '處理中',
  COMPLETED: '完成', SUCCESS: '成功', SAFE_RETRY: '可安全重試', RESEND_REQUIRED: '需請使用者重傳',
  MANUAL_REVIEW: '人工檢查', NO_SUBSCRIPTION: '沒有訂閱方案', SUBSCRIPTION_INACTIVE: '訂閱未啟用',
  PLAN_DISABLED: '方案已停用', NOT_YET_EFFECTIVE: '尚未生效', PERIOD_NOT_STARTED: '週期尚未開始',
  PERIOD_EXPIRED: '週期已結束', TEXT: '文字', AUDIO: '語音', IMAGE: '圖片', FILE: '檔案', INFO: '資訊',
  WARNING: '警告', ERROR: '錯誤', CRITICAL: '嚴重', PRIVATE: '私人', LINE: 'LINE', ADMIN: '管理後台', MEMBER: '成員',
  PLAN: '方案', SUBSCRIPTION_PLAN: '訂閱方案', AI_RUNTIME_CONFIG: 'AI 執行設定', ANOMALY: '異常事件', WORKSPACE: '工作區',
};

const CATEGORY_LABELS: Record<string, string> = {
  LINE_GROUP_WEBHOOK: 'LINE 群組訊息處理', LINE_GROUP_LIFECYCLE: 'LINE 群組生命週期', LINE_GROUP_REPLY: 'LINE 群組回覆',
  LINE_GROUP_PROFILE_REFRESH: 'LINE 群組資料同步', LINE_GROUP_QUERY_READ: 'LINE 群組紀錄查詢',
  LINE_GROUP_QUERY_ENTRY: 'LINE 群組紀錄入口', LINE_GROUP_RESPONSIBILITY_MENTION: 'LINE 群組 AI 負責人標記',
  LINE_OA_WEBHOOK: 'LINE 官方帳號訊息處理', LINE_OA_LIFECYCLE: 'LINE 官方帳號生命週期', LINE_OA_REPLY: 'LINE 官方帳號回覆',
  LINE_OA_QUERY_READ: 'LINE 官方帳號紀錄查詢', LINE_OA_QUERY_ENTRY: 'LINE 官方帳號紀錄入口', ADMIN_API: '管理後台 API',
};

const ERROR_CODE_LABELS: Record<string, string> = {
  GROUP_MESSAGE_FAILED: '群組訊息處理失敗', OA_MESSAGE_FAILED: '官方帳號訊息處理失敗',
  GROUP_PROFILE_REFRESH_FAILED: '群組資料同步失敗', LINE_REPLY_FAILED: 'LINE 回覆失敗',
  GROUP_RESPONSIBILITY_MENTION_FAILED: '群組 AI 負責人標記失敗', GROUP_QUERY_READ_FAILED: '群組紀錄查詢失敗',
  GROUP_QUERY_ENTRY_FAILED: '群組紀錄入口建立失敗', OA_QUERY_READ_FAILED: '官方帳號紀錄查詢失敗',
  OA_QUERY_ENTRY_FAILED: '官方帳號紀錄入口建立失敗', HTTP_500: '伺服器內部錯誤',
  ADMIN_USERS_QUERY_FAILED: '管理後台使用者查詢失敗', ADMIN_GROUPS_QUERY_FAILED: '管理後台群組查詢失敗',
};

const ACTION_LABELS: Record<string, string> = {
  PLAN_UPSERTED: '方案新增／更新', PLAN_DELETED: '方案刪除', AI_RUNTIME_CONFIG_UPDATED: 'AI 執行設定更新',
  ANOMALY_STATUS_UPDATED: '異常狀態更新', USER_SUBSCRIPTION_UPDATED: '使用者方案更新', SUBSCRIPTION_UPDATED: '使用者方案更新',
};

const LABELED_FIELDS = new Set([
  'status','user_type','subscription_status','subscription_effective_state','severity','channel','input_type','category',
  'billing_relation','source','action','target_type','retry_disposition','error_code','last_error_code',
]);

export function presentAdminPayload<T>(value: T): T { return present(value) as T; }

function present(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(present);
  if (!isRecord(value)) return value;
  const source = withRetryDisposition(value);
  const result: AdminRecord = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = present(item);
    if (LABELED_FIELDS.has(key) && typeof item === 'string') result[`${key}_label`] = labelForField(key, item);
  }
  if ('capabilities' in source) result.capability_definitions = ADMIN_CAPABILITY_DEFINITIONS;
  return result;
}

function withRetryDisposition(row: AdminRecord): AdminRecord {
  if (!('last_error_code' in row) || !('command_line_message_id' in row)) return row;
  const code = String(row.last_error_code ?? '').trim().toUpperCase();
  const safe = new Set(['AI_RUNTIME_CONFIG_MISSING','AI_QUOTA_EXHAUSTED','AI_POINTS_EXHAUSTED','NO_ELIGIBLE_AI_GRANT']);
  const resend = new Set(['LINE_CONTENT_EXPIRED','LINE_CONTENT_EMPTY','LINE_CONTENT_TOO_LARGE','ATTACHMENT_UNSUPPORTED']);
  if (safe.has(code)) return { ...row, retry_disposition: 'SAFE_RETRY', retry_guidance: '可安全重新嘗試；請先確認該 Source 有可用 AI 點數，且原始 LINE 內容仍可取得。' };
  if (resend.has(code)) return { ...row, retry_disposition: 'RESEND_REQUIRED', retry_guidance: '請使用者重新傳送附件，不要重送舊的 AI 請求。' };
  return { ...row, retry_disposition: 'MANUAL_REVIEW', retry_guidance: '需人工檢查，禁止自動重送 AI 請求。' };
}

function labelForField(field: string, value: string): string {
  const normalized = value.trim().toUpperCase();
  if (field === 'category') return CATEGORY_LABELS[normalized] ?? value;
  if (field === 'error_code' || field === 'last_error_code') return ERROR_CODE_LABELS[normalized] ?? value;
  if (field === 'action') return ACTION_LABELS[normalized] ?? VALUE_LABELS[normalized] ?? value;
  if (field === 'target_type') return VALUE_LABELS[normalized] ?? value;
  return VALUE_LABELS[normalized] ?? value;
}

function isRecord(value: unknown): value is AdminRecord { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
