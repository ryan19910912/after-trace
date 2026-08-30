function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function createPkceVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(48)));
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('invalid PKCE verifier');
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', asArrayBuffer(new TextEncoder().encode(verifier))),
  );
  return base64UrlEncode(digest);
}
