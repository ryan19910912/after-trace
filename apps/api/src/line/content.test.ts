import { describe, expect, it, vi } from 'vitest';
import { LineMessageContentResolver } from './content';

describe('LineMessageContentResolver', () => {
  it('treats LINE 202 as content-not-ready instead of binary attachment data', async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"processing"}', {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }));
    const resolver = new LineMessageContentResolver('token', fetcher as typeof fetch);

    await expect(resolver.content('message-1')).rejects.toMatchObject({
      message: 'LINE_CONTENT_NOT_READY',
      code: 'LINE_CONTENT_NOT_READY',
    });
  });

  it('classifies LINE 400 as not retrievable so past text is never parsed as a file', async () => {
    const fetcher = vi.fn(async () => new Response('{"message":"Bad Request"}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    const resolver = new LineMessageContentResolver('token', fetcher as typeof fetch);

    await expect(resolver.content('quoted-text-id')).rejects.toMatchObject({
      message: 'LINE_CONTENT_NOT_RETRIEVABLE',
      code: 'LINE_CONTENT_NOT_RETRIEVABLE',
    });
  });

  it('keeps unavailable/expired status information for 404/410', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 410 }));
    const resolver = new LineMessageContentResolver('token', fetcher as typeof fetch);

    await expect(resolver.content('expired-id')).rejects.toMatchObject({
      message: 'LINE_CONTENT_UNAVAILABLE_410',
      code: 'LINE_CONTENT_UNAVAILABLE_410',
      status: 410,
    });
  });

  it('stops a chunked body as soon as it exceeds the configured byte limit without Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.enqueue(new Uint8Array([7, 8, 9]));
      },
      cancel() { cancelled = true; },
    });
    const fetcher = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }));
    const resolver = new LineMessageContentResolver('token', fetcher as typeof fetch, 10, 5);

    await expect(resolver.content('chunked-id')).rejects.toMatchObject({
      message: 'LINE_CONTENT_TOO_LARGE',
      code: 'LINE_CONTENT_TOO_LARGE',
    });
    expect(cancelled).toBe(true);
  });
});
