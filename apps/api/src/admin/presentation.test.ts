import { describe, expect, it } from 'vitest';
import { presentAdminPayload } from './presentation';

describe('presentAdminPayload observability labels', () => {
  it('maps anomaly category and error code to Chinese while retaining raw codes', () => {
    const result = presentAdminPayload({ category: 'LINE_GROUP_WEBHOOK', error_code: 'GROUP_MESSAGE_FAILED' }) as Record<string, unknown>;
    expect(result.category).toBe('LINE_GROUP_WEBHOOK');
    expect(result.category_label).toBe('LINE 群組訊息處理');
    expect(result.error_code).toBe('GROUP_MESSAGE_FAILED');
    expect(result.error_code_label).toBe('群組訊息處理失敗');
  });

  it('maps audit action and target type to Chinese', () => {
    const result = presentAdminPayload({ action: 'AI_RUNTIME_CONFIG_UPDATED', target_type: 'AI_RUNTIME_CONFIG' }) as Record<string, unknown>;
    expect(result.action_label).toBe('AI 執行設定更新');
    expect(result.target_type_label).toBe('AI 執行設定');
  });
});
