export type AdminCapabilityDefinition = {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string';
  defaultValue: boolean | number | string;
  min?: number;
  max?: number;
  description?: string;
};

export const ADMIN_CAPABILITY_DEFINITIONS: AdminCapabilityDefinition[] = [
  {
    key: 'privateOaRecording',
    label: '私人 OA 記錄',
    type: 'boolean',
    defaultValue: true,
    description: '允許從 LINE 官方帳號私人聊天室建立工作紀錄。',
  },
  {
    key: 'groupCollaboration',
    label: '群組協作',
    type: 'boolean',
    defaultValue: false,
    description: '允許在 LINE 群組中共同建立與管理工作紀錄。',
  },
  {
    key: 'maxGroupCount',
    label: '最大群組數',
    type: 'number',
    defaultValue: 0,
    min: 0,
    max: 100000,
    description: '此方案可啟用的群組數量上限；0 代表不可啟用群組。',
  },
  {
    key: 'aiTextRecording',
    label: 'AI 文字整理',
    type: 'boolean',
    defaultValue: true,
    description: '允許使用 AI 整理文字工作紀錄。',
  },
  {
    key: 'aiMediaIngestion',
    label: 'AI 媒體處理',
    type: 'boolean',
    defaultValue: true,
    description: '允許 AI 處理語音、圖片與檔案附件。',
  },
  {
    key: 'pwaEditing',
    label: '網頁編輯',
    type: 'boolean',
    defaultValue: true,
    description: '允許使用者在 Web/PWA 編輯工作紀錄。',
  },
  {
    key: 'export',
    label: '匯出功能',
    type: 'boolean',
    defaultValue: false,
    description: '允許使用者匯出工作紀錄資料。',
  },
];

export function defaultAdminCapabilities(): Record<string, boolean | number | string> {
  return Object.fromEntries(ADMIN_CAPABILITY_DEFINITIONS.map((definition) => [definition.key, definition.defaultValue]));
}

export function validateAdminCapabilities(value: unknown): Record<string, boolean | number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PLAN_CAPABILITIES');
  const input = value as Record<string, unknown>;
  const result = defaultAdminCapabilities();

  for (const definition of ADMIN_CAPABILITY_DEFINITIONS) {
    if (!(definition.key in input)) continue;
    const item = input[definition.key];
    if (definition.type === 'boolean') {
      if (typeof item !== 'boolean') throw new Error(`INVALID_CAPABILITY_${definition.key}`);
      result[definition.key] = item;
      continue;
    }
    if (definition.type === 'number') {
      if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`INVALID_CAPABILITY_${definition.key}`);
      if (definition.min !== undefined && item < definition.min) throw new Error(`INVALID_CAPABILITY_${definition.key}`);
      if (definition.max !== undefined && item > definition.max) throw new Error(`INVALID_CAPABILITY_${definition.key}`);
      result[definition.key] = item;
      continue;
    }
    if (typeof item !== 'string') throw new Error(`INVALID_CAPABILITY_${definition.key}`);
    result[definition.key] = item;
  }

  return result;
}
