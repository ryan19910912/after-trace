import { describe, expect, it } from 'vitest';
import { allowedProductClientOrigin } from './product-client-origin';

describe('authenticated product client origins', () => {
  const webOrigin = 'https://web.example.test';

  it('keeps Web on an exact origin', () => {
    expect(allowedProductClientOrigin(webOrigin, webOrigin)).toBe(webOrigin);
    expect(allowedProductClientOrigin('https://evil.example.test', webOrigin)).toBeNull();
  });

  it('accepts canonical Chrome extension origins for bearer-session product APIs', () => {
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    expect(allowedProductClientOrigin(extensionOrigin, webOrigin)).toBe(extensionOrigin);
  });

  it('rejects malformed or non-Chrome extension origins', () => {
    expect(allowedProductClientOrigin('chrome-extension://short', webOrigin)).toBeNull();
    expect(allowedProductClientOrigin(`moz-extension://${'a'.repeat(32)}`, webOrigin)).toBeNull();
    expect(allowedProductClientOrigin(`chrome-extension://${'z'.repeat(32)}`, webOrigin)).toBeNull();
  });
});
