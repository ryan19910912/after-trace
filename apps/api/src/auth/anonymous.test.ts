import { describe, expect, it } from 'vitest';
import { parseBearerToken } from './anonymous';

describe('anonymous identity bearer parsing', () => {
  it('accepts a bearer token case-insensitively', () => {
    expect(parseBearerToken('bearer atr_anon_v1_example')).toBe('atr_anon_v1_example');
  });

  it('rejects missing or non-bearer credentials', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
  });
});
