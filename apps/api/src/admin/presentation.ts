type AdminRecord = Record<string, unknown>;

const VALUE_LABELS: Record<string, string> = {
  ACTIVE: '啟用',
  INACTIVE: '停用',
  OPEN: '待處理',
  RESOLVED: '已解決',
  IGNORED: '已忽略',
  INDIVIDUAL: '個人使用者',
  GROUP_ENABLED: '群組擁有者',
  USER: '使用者',
  GROUP: '群組',
  ENABLED: '啟用',
  DISABLED: '停用',
  FAILED: '失敗',
  PENDING: '處理中',
  COMPLETED: '完成',
  SUCCESS: '成功',
  SAFE_RETRY: '可安全重試',
  RESEND_REQUIRED: '需請使用者重傳',
  MANUAL_REVIEW: '人工檢查',
  NO_SUBSCRIPTION: '沒有訂閱方案',
  SUBSCRIPTION_INACTIVE: '訂閱未啟用',
  PLAN_DISABLED: '方案已停用',
  NOT_YET_EFFECTIVE: '尚未生效',
  PERIOD_NOT_STARTED: '週期尚未開始',
  PERIOD_EXPIRED: '週期已結束',
  TEXT: '文字',
  AUDIO: '語音',
  IMAGE: '圖片',
  FILE: '檔案',
  INFO: '資訊',
  WARNING: '警告',
  ERROR: '錯誤',
  CRITICAL: '嚴重',
  PRIVATE: '私人',
  LINE: 'LINE',
  ADMIN: '管理後台',
  OWNER: '擁有者',
  MEMBER: '成員',
};

const LABELED_FIELDS = new Set([
  'status',
  'user_type',
  'subscription_status',
  'subscription_effective_state',
  'severity',
  'channel',
  'input_type',
  'category',
  'billing_relation',
  'owner_binding_method',
  'source',
  'action',
  'target_type',
  'retry_disposition',
]);

export function presentAdminPayload<T>(value: T): T {
  return present(value) as T;
}

function present(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(present);
  if (!isRecord(value)) return value;

  const source = withRetryDisposition(value);
  const result: AdminRecord = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = present(item);
    if (LABELED_FIELDS.has(key) && typeof item === 'string') {
      result[`${key}_label`] = label(item);
    }
  }
  return result;
}

function withRetryDisposition(row: AdminRecord): AdminRecord {
  if (!('last_error_code' in row) || !('command_line_message_id' in row)) return row;
  const code = String(row.last_error_code ?? '').trim().toUpperCase();
  const safe = new Set([
    'AI_RUNTIME_CONFIG_MISSING',
    'AI_QUOTA_EXHAUSTED',
    'NO_SUBSCRIPTION',
    'SUBSCRIPTION_INACTIVE',
    'PLAN_DISABLED',
    'NOT_YET_EFFECTIVE',
    'PERIOD_NOT_STARTED',
    'PERIOD_EXPIRED',
  ]);
  const resend = new Set([
    'LINE_CONTENT_EXPIRED',
    'LINE_CONTENT_EMPTY',
    'LINE_CONTENT_TOO_LARGE',
    'ATTACHMENT_UNSUPPORTED',
  ]);
  if (safe.has(code)) {
    return {
      ...row,
      retry_disposition: 'SAFE_RETRY',
      retry_guidance: '可安全重新嘗試；請先確認原始 LINE 內容仍可取得。',
    };
  }
  if (resend.has(code)) {
    return {
      ...row,
      retry_disposition: 'RESEND_REQUIRED',
      retry_guidance: '請使用者重新傳送附件，不要重送舊的 AI 請求。',
    };
  }
  return {
    ...row,
    retry_disposition: 'MANUAL_REVIEW',
    retry_guidance: '需人工檢查，禁止自動重送 AI 請求。',
  };
}

function label(value: string): string {
  const normalized = value.trim().toUpperCase();
  return VALUE_LABELS[normalized] ?? value;
}

function isRecord(value: unknown): value is AdminRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
