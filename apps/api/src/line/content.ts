export type InlineMemoryMedia = {
  lineMessageId: string;
  mimeType: string;
  dataBase64: string;
};

export type LineMessageContent = {
  lineMessageId: string;
  mimeType: string;
  byteLength: number;
  dataBase64: string;
};

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_CONTENT_BYTES = 20 * 1024 * 1024;

export class LineMessageContentResolver {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
    private readonly maxContentBytes = DEFAULT_MAX_CONTENT_BYTES,
  ) {}

  async content(lineMessageId: string, maxBytes = this.maxContentBytes): Promise<LineMessageContent> {
    const id = lineMessageId.trim();
    if (!id) throw new Error('LINE_CONTENT_MESSAGE_ID_REQUIRED');
    const token = this.channelAccessToken.trim();
    if (!token) throw new Error('LINE_CONTENT_ACCESS_TOKEN_REQUIRED');
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('LINE_CONTENT_MAX_BYTES_INVALID');

    const response = await this.fetcher(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(id)}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      const error = new Error(`LINE_CONTENT_UNAVAILABLE_${response.status}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('LINE_CONTENT_TOO_LARGE');

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error('LINE_CONTENT_EMPTY');
    if (bytes.byteLength > maxBytes) throw new Error('LINE_CONTENT_TOO_LARGE');

    return {
      lineMessageId: id,
      mimeType,
      byteLength: bytes.byteLength,
      dataBase64: bytesToBase64(bytes),
    };
  }

  async image(lineMessageId: string): Promise<InlineMemoryMedia> {
    const content = await this.content(lineMessageId, this.maxImageBytes);
    if (!content.mimeType.startsWith('image/')) throw new Error('LINE_CONTENT_NOT_IMAGE');
    return {
      lineMessageId: content.lineMessageId,
      mimeType: content.mimeType,
      dataBase64: content.dataBase64,
    };
  }
}

export function base64ToUtf8(dataBase64: string): string {
  const binary = atob(dataBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
