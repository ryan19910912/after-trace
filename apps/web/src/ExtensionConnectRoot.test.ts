import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionConnectTarget, issueExtensionSession } from './ExtensionConnectRoot';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExtensionConnectRoot handoff', () => {
  it('accepts only bounded Chrome extension id + nonce return targets', () => {
    expect(extensionConnectTarget({
      pathname: '/extension/connect',
      search: '?extensionId=abcdefghijklmnopabcdefghijklmnop&nonce=abcdefghijklmnop',
    } as Location)).toEqual({
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      nonce: 'abcdefghijklmnop',
    });
    expect(extensionConnectTarget({
      pathname: '/extension/connect',
      search: '?extensionId=bad&nonce=abcdefghijklmnop',
    } as Location)).toBeNull();
    expect(extensionConnectTarget({
      pathname: '/extension/connect',
      search: '?extensionId=abcdefghijklmnopabcdefghijklmnop&nonce=abcdefghijklmnop&next=https://evil.example',
    } as Location)).toBeNull();
  });

  it('exchanges the current Web session for a bounded seven-day extension session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      sessionToken: 'bounded-extension-session',
      expiresInSeconds: 60 * 60 * 24 * 7,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(issueExtensionSession('https://api.example.test/', 'current-web-session')).resolves.toEqual({
      sessionToken: 'bounded-extension-session',
      expiresInSeconds: 60 * 60 * 24 * 7,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/v1/account/extension-session', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer current-web-session',
        Accept: 'application/json',
      },
    });
  });

  it('rejects a server response that tries to issue an extension session longer than seven days', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      sessionToken: 'too-long-session',
      expiresInSeconds: 60 * 60 * 24 * 8,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(issueExtensionSession('https://api.example.test', 'web-session'))
      .rejects.toThrow('擴充功能工作階段回應無效');
  });
});
