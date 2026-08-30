export type InlineMemoryMedia = {
  lineMessageId: string;
  mimeType: string;
  dataBase64: string;
};

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class LineMessageContentResolver {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  ) {}

  async image(lineMessageId: string): Promise<InlineMemoryMedia> {
    const id = lineMessageId.trim();
    if (!id) throw new Error('LINE_CONTENT_MESSAGE_ID_REQUIRED');
    const token = this.channelAccessToken.trim();
    if (!token) throw new Error('LINE_CONTENT_ACCESS_TOKEN_REQUIRED');

    const response = await this.fetcher(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(id)}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new Error(`LINE_IMAGE_CONTENT_UNAVAILABLE_${response.status}`);
    }

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!mimeType.startsWith('image/')) throw new Error('LINE_CONTENT_NOT_IMAGE');

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > this.maxImageBytes) {
      throw new Error('LINE_IMAGE_TOO_LARGE');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error('LINE_IMAGE_EMPTY');
    if (bytes.byteLength > this.maxImageBytes) throw new Error('LINE_IMAGE_TOO_LARGE');

    return {
      lineMessageId: id,
      mimeType,
      dataBase64: bytesToBase64(bytes),
    };
  }
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
