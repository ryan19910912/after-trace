import { describe, expect, it } from 'vitest';
import { safeLoginReturn } from './login-return';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const nonce = 'abcdefghijklmnop1234567890_-';

describe('bounded login return', () => {
  it('keeps existing fixed product return paths including AI search', () => {
    expect(safeLoginReturn('/capture')).toBe('/capture');
    expect(safeLoginReturn('/ai-search')).toBe('/ai-search');
    expect(safeLoginReturn('/tasks')).toBe('/tasks');
  });

  it('accepts only a canonical extension connect request', () => {
    expect(safeLoginReturn(`/extension/connect?extensionId=${extensionId}&nonce=${nonce}`)).toBe(
      `/extension/connect?extensionId=${extensionId}&nonce=${nonce}`,
    );
  });

  it('rejects arbitrary redirects and malformed extension targets', () => {
    expect(safeLoginReturn('https://evil.example.test/')).toBeNull();
    expect(safeLoginReturn('/extension/connect?extensionId=bad&nonce=abcdefghijklmnop')).toBeNull();
    expect(safeLoginReturn(`/extension/connect?extensionId=${extensionId}&nonce=${nonce}&next=https://evil.example.test`)).toBeNull();
  });
});
