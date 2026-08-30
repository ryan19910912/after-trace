import { describe, expect, it } from 'vitest';
import { createPkceChallenge, createPkceVerifier } from './pkce';

describe('LINE Login PKCE', () => {
  it('creates a valid verifier and deterministic S256 challenge', async () => {
    const verifier = createPkceVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    const first = await createPkceChallenge(verifier);
    const second = await createPkceChallenge(verifier);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects an invalid verifier', async () => {
    await expect(createPkceChallenge('too-short')).rejects.toThrow('invalid PKCE verifier');
  });
});
