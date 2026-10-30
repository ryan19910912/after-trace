import { adminFetch } from './admin-fetch';
export type PromptRow = { key: string; name: string; description: string; variables: string[]; outputFields: string[]; draft_template: string; published_template: string; draft_max_tokens: number; published_max_tokens: number; version: number; published_version: number; updated_by: string; published_by: string; published_at: string };
export type PromptRevision = { id: string; action: string; version: number; template?: string; max_tokens: number; actor: string; created_at: string };
export class AdminPromptApi {
  constructor(private readonly baseUrl: string) {}
  private async request(path = '', init?: RequestInit) {
    const token = sessionStorage.getItem('aftertrace.admin.session');
    const response = await adminFetch(this.baseUrl.replace(/\/$/, '') + '/api/v1/admin/local-ai-prompts' + path, { ...init, headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(promptError(body.error ?? 'REQUEST_FAILED')); return body;
  }
  async list(): Promise<PromptRow[]> { return (await this.request()).prompts; }
  async history(key: string): Promise<PromptRevision[]> { return (await this.request('/' + encodeURIComponent(key) + '/history')).revisions; }
  async revision(key: string, id: string): Promise<string> { return (await this.request('/' + encodeURIComponent(key) + '/history/' + encodeURIComponent(id))).template; }
  async save(key: string, expectedVersion: number, template: string, maxTokens: number): Promise<PromptRow> { return (await this.request('/' + key, { method: 'PUT', body: JSON.stringify({ expectedVersion, template, maxTokens }) })).prompt; }
  async publish(key: string, expectedVersion: number): Promise<PromptRow> { return (await this.request('/' + key + '/publish', { method: 'POST', body: JSON.stringify({ expectedVersion }) })).prompt; }
  async restore(key: string, expectedVersion: number, revisionId: string): Promise<PromptRow> { return (await this.request('/' + key + '/restore', { method: 'POST', body: JSON.stringify({ expectedVersion, revisionId }) })).prompt; }
}
export function promptError(code: string): string {
  const labels: Record<string, string> = { ADMIN_SESSION_REQUIRED: '請先登入管理後台。', ADMIN_SESSION_INVALID: '登入已失效，請重新登入。', PROMPT_VERSION_CONFLICT_OR_REVISION_UNAVAILABLE: '設定已被其他管理員更新，或該歷史版本無法回復。你的文字仍保留，請重新載入最新版本後確認。', TEMPLATE_LENGTH_INVALID: '提示內容必須介於 1 到 4000 字。', MAX_TOKENS_INVALID: '輸出上限需為 64 到 768 的整數。', REQUIRED_VARIABLE_MISSING: '缺少必要變數，請保留上方列出的所有 {{變數}}。', UNKNOWN_VARIABLE: '包含未支援或格式錯誤的變數。', OUTPUT_FIELDS_MISSING: '請保留必要 JSON 輸出欄位及雙引號。', PROMPTS_NOT_INITIALIZED: '資料庫尚未初始化提示設定。', PROMPT_CONFIG_UNAVAILABLE: '設定服務暫時無法使用，請重試。' };
  return labels[code] ?? '操作失敗，請稍後重試。';
}
