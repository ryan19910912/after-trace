export type AdminCapabilityDefinition = {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string';
  defaultValue: boolean | number | string;
  min?: number;
  max?: number;
  description?: string;
  shipped?: boolean;
};

export const ADMIN_CAPABILITY_DEFINITIONS: AdminCapabilityDefinition[] = [
  {
    key: 'privateOaRecording',
    label: 'LINE 私人聊天記錄',
    type: 'boolean',
    defaultValue: true,
    shipped: true,
    description: '允許從 LINE 官方帳號私人聊天室使用 AI 建立工作紀錄。PWA 手動紀錄不受此方案能力限制。',
  },
  {
    key: 'aiTextRecording',
    label: 'AI 文字紀錄',
    type: 'boolean',
    defaultValue: true,
    shipped: true,
    description: '允許使用 AI 解析文字紀錄；實際執行仍需有可用 AI 點數。',
  },
  {
    key: 'aiMediaIngestion',
    label: 'AI 語音／圖片／檔案處理',
    type: 'boolean',
    defaultValue: true,
    shipped: true,
    description: '允許 AI 處理語音、圖片與檔案附件；實際執行仍需有可用 AI 點數。',
  },
  {
    key: 'export',
    label: '匯出功能（尚未上線）',
    type: 'boolean',
    defaultValue: false,
    shipped: false,
    description: '產品規格仍保留付費匯出 MVP；在實際匯出 API/UI 與授權測試完成前不可對客戶啟用。',
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
      if (definition.shipped === false && item === true) throw new Error(`CAPABILITY_NOT_SHIPPED_${definition.key}`);
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
