import { describe, expect, it } from 'vitest';
import { safeLoginReturn } from './login-return';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const nonce = 'abcdefghijklmnop1234567890_-';

describe('bounded login return', () => {
  it('keeps existing fixed product return paths including AI surfaces', () => {
    expect(safeLoginReturn('/capture')).toBe('/capture');
    expect(safeLoginReturn('/ai-search')).toBe('/ai-search');
    expect(safeLoginReturn('/ai-tools')).toBe('/ai-tools');
    expect(safeLoginReturn('/ai-task')).toBe('/ai-task');
    expect(safeLoginReturn('/tasks')).toBe('/tasks');
  });

  it('preserves only canonical bounded task and AI deep links', () => {
    expect(safeLoginReturn('/tasks/123')).toBe('/tasks/123');
    expect(safeLoginReturn('/ai-tools?sourceId=12&recordId=91&tool=related')).toBe('/ai-tools?sourceId=12&recordId=91&tool=related');
    expect(safeLoginReturn('/ai-tools?sourceId=12&recordId=91&tool=rewrite')).toBe('/ai-tools?sourceId=12&recordId=91&tool=rewrite');
    expect(safeLoginReturn('/ai-task?sourceId=12&recordId=91')).toBe('/ai-task?sourceId=12&recordId=91');
    expect(safeLoginReturn('/ai-task?sourceId=12&recordId=91&next=https://evil.example.test')).toBeNull();
    expect(safeLoginReturn('/ai-tools?sourceId=12&recordId=91&tool=related&next=/')).toBeNull();
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