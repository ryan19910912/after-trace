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
});
