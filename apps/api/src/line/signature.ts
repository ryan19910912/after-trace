const encoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;

  const signatureBytes = decodeBase64(signature);
  if (!signatureBytes) return false;

  const keyData = new Uint8Array(encoder.encode(channelSecret));
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new Uint8Array(encoder.encode(rawBody)),
  );
}
