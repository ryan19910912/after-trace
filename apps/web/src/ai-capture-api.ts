export type AiEntitlementSource = 'FREE_TRIAL' | 'AI_PRO' | 'BLOCKED';

export type AiEntitlementDecision = {
  source: AiEntitlementSource;
  allowed: boolean;
  reason: string;
  remainingPoints: number | null;
  periodEndsAt: string | null;
  perRequestAiPointCap?: number | null;
};

export type AiCapturedRecord = {
  id: number;
  sourceId: number;
  authorUserId: number;
  rawText: string;
  title: string | null;
  searchTerms: string[];
  occurredAt: string | null;
  createdAt: string;
};

export type AiTextCaptureResponse = {
  entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
  record: AiCapturedRecord;
};

export type AiMediaCaptureResponse = {
  entitlementSource: 'AI_PRO';
  record: AiCapturedRecord;
};

export class AiCaptureApi {
  constructor(private readonly baseUrl: string) {}

  async entitlement(sessionToken: string, sourceId: number): Promise<AiEntitlementDecision> {
    const response = await this.request(
      sessionToken,
      `/api/v1/ai/entitlement?sourceId=${encodeURIComponent(String(sourceId))}`,
    );
    const body = await json<{ entitlement: AiEntitlementDecision }>(response, 'AI 使用狀態載入失敗');
    return body.entitlement;
  }

  async captureText(sessionToken: string, sourceId: number, text: string): Promise<AiTextCaptureResponse> {
    const response = await this.request(sessionToken, '/api/v1/ai/capture/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, text }),
    });
    return mapCaptureResponse(await json<{ entitlementSource: 'FREE_TRIAL' | 'AI_PRO'; record: Record<string, unknown> }>(response, 'AI 紀錄失敗'));
  }

  async captureImage(sessionToken: string, sourceId: number, file: File, instruction?: string): Promise<AiMediaCaptureResponse> {
    return this.captureMedia(sessionToken, sourceId, '/api/v1/ai/capture/image', 'image', file, instruction);
  }

  async captureAudio(sessionToken: string, sourceId: number, file: File, instruction?: string, durationSeconds?: number | null): Promise<AiMediaCaptureResponse> {
    return this.captureMedia(sessionToken, sourceId, '/api/v1/ai/capture/audio', 'audio', file, instruction, durationSeconds);
  }

  async captureFile(sessionToken: string, sourceId: number, file: File, instruction?: string): Promise<AiMediaCaptureResponse> {
    return this.captureMedia(sessionToken, sourceId, '/api/v1/ai/capture/file', 'file', file, instruction);
  }

  private async captureMedia(
    sessionToken: string,
    sourceId: number,
    path: string,
    field: 'image' | 'audio' | 'file',
    file: File,
    instruction?: string,
    durationSeconds?: number | null,
  ): Promise<AiMediaCaptureResponse> {
    const dataBase64 = await fileBase64(file);
    const payload: Record<string, unknown> = {
      sourceId,
      [field]: { mimeType: file.type || fallbackMimeType(field), byteLength: file.size, dataBase64 },
    };
    if (instruction?.trim()) payload.instruction = instruction.trim();
    if (field === 'audio' && durationSeconds && Number.isFinite(durationSeconds)) payload.durationSeconds = durationSeconds;
    const response = await this.request(sessionToken, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await json<{ entitlementSource: 'AI_PRO'; record: Record<string, unknown> }>(response, 'AI 檔案處理失敗');
    return { entitlementSource: 'AI_PRO', record: mapRecord(body.record) };
  }

  private request(sessionToken: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers });
  }
}

async function json<T>(response: Response, fallback: string): Promise<T & { error?: string }> {
  const text = await response.text();
  let body: T & { error?: string };
  try { body = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string }; }
  catch { throw new Error(`${fallback} (${response.status})`); }
  if (!response.ok) throw new Error(body.error || `${fallback} (${response.status})`);
  return body;
}

function mapCaptureResponse(body: { entitlementSource: 'FREE_TRIAL' | 'AI_PRO'; record: Record<string, unknown> }): AiTextCaptureResponse {
  return { entitlementSource: body.entitlementSource, record: mapRecord(body.record) };
}

function mapRecord(raw: Record<string, unknown>): AiCapturedRecord {
  const rawTerms = raw.searchTerms ?? raw.search_terms;
  const searchTerms = Array.isArray(rawTerms)
    ? rawTerms.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    id: positiveNumber(raw.id, 'record id'),
    sourceId: positiveNumber(raw.sourceId ?? raw.source_id, 'source id'),
    authorUserId: positiveNumber(raw.authorUserId ?? raw.author_user_id, 'author user id'),
    rawText: String(raw.rawText ?? raw.raw_text ?? ''),
    title: nullableString(raw.title),
    searchTerms,
    occurredAt: nullableString(raw.occurredAt ?? raw.occurred_at),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
  };
}

async function fileBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fallbackMimeType(field: 'image' | 'audio' | 'file'): string {
  return field === 'image' ? 'image/png' : field === 'audio' ? 'audio/webm' : 'application/octet-stream';
}
function positiveNumber(value: unknown, label: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`INVALID_${label.toUpperCase().replaceAll(' ', '_')}`); return parsed; }
function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }
