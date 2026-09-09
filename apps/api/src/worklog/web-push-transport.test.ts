import { describe, expect, it } from 'vitest';
import { base64Url, buildWebPushRequest, WorkerWebPushTransport } from './web-push-transport';

describe('Worker Web Push transport', () => {
  it('builds an encrypted aes128gcm request with VAPID auth and bounded topic', async () => {
    const vapid = await vapidKeys();
    const subscription = await browserSubscription();
    const request = await buildWebPushRequest(
      { ...vapid, subject: 'mailto:support@example.com' },
      subscription,
      {
        notificationId: 123,
        title: 'AFTERTRACE 通知',
        body: '這是一則測試通知',
        deepLink: '/notifications?from=push',
      },
    );

    expect(request.endpoint).toBe(subscription.endpoint);
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(request.headers.Authorization).toMatch(/^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);
    expect(request.headers.Topic).toBe('aftertrace-123');
    expect(request.body.byteLength).toBeGreaterThan(100);
    expect(new TextDecoder().decode(request.body)).not.toContain('這是一則測試通知');
  });

  it('sends the encrypted request through fetch without Node http/crypto dependencies', async () => {
    const vapid = await vapidKeys();
    const subscription = await browserSubscription();
    let captured: RequestInit | undefined;
    const transport = new WorkerWebPushTransport(
      { ...vapid, subject: 'https://aftertrace.example/support' },
      async (_input, init) => {
        captured = init;
        return new Response(null, { status: 201 });
      },
    );

    const result = await transport.send(subscription, {
      notificationId: 7,
      title: '系統通知',
      body: '訂閱狀態已更新',
      deepLink: '/subscription',
    });

    expect(result).toEqual({ ok: true, status: 201 });
    expect(captured?.method).toBe('POST');
    expect(captured?.body).toBeInstanceOf(ArrayBuffer);
    expect((captured?.body as ArrayBuffer | undefined)?.byteLength ?? 0).toBeGreaterThan(100);
  });

  it('rejects malformed VAPID and browser subscription keys before network I/O', async () => {
    expect(() => new WorkerWebPushTransport({
      publicKey: 'bad',
      privateKey: 'bad',
      subject: 'mailto:support@example.com',
    })).toThrow('INVALID_WEB_PUSH_PUBLIC_KEY');

    const vapid = await vapidKeys();
    await expect(buildWebPushRequest(
      { ...vapid, subject: 'mailto:support@example.com' },
      { endpoint: 'https://push.example/sub', p256dh: 'bad', auth: 'bad' },
      { notificationId: 1, title: 'title', body: 'body', deepLink: null },
    )).rejects.toThrow('INVALID_PUSH_P256DH');
  });
});

async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!privateJwk.d) throw new Error('TEST_VAPID_PRIVATE_KEY_MISSING');
  return { publicKey: base64Url(rawPublic), privateKey: privateJwk.d };
}

async function browserSubscription() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const p256dh = base64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  return {
    endpoint: 'https://push.example.test/subscription/abc',
    p256dh,
    auth: base64Url(auth),
  };
}
