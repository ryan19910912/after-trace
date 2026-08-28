import { describe, expect, it } from 'vitest';
import { verifyLineSignature } from './signature';

describe('verifyLineSignature', () => {
  it('accepts a valid LINE HMAC-SHA256 signature', async () => {
    const result = await verifyLineSignature(
      '{"events":[]}',
      'Va12JSFB+Fs03rxzdvh7icVLk546dmNGSrPkkClJW/U=',
      'test-secret',
    );

    expect(result).toBe(true);
  });

  it('rejects an invalid or malformed signature', async () => {
    await expect(verifyLineSignature('{"events":[]}', 'invalid', 'test-secret')).resolves.toBe(false);
    await expect(verifyLineSignature('{"events":[]}', '', 'test-secret')).resolves.toBe(false);
  });
});
