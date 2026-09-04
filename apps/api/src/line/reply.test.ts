import { describe, expect, it } from 'vitest';
import { sentMessageIdsFromBody } from './reply';

describe('sentMessageIdsFromBody', () => {
  it('preserves numeric LINE message IDs beyond JavaScript safe integer precision', () => {
    expect(sentMessageIdsFromBody('{"sentMessages":[{"id":468789577898262530,"quoteToken":"q"}]}'))
      .toEqual(['468789577898262530']);
  });

  it('accepts string IDs and ignores unrelated id fields outside sentMessages', () => {
    expect(sentMessageIdsFromBody('{"request":{"id":"999"},"sentMessages":[{"id":"123456789012345678"}]}'))
      .toEqual(['123456789012345678']);
  });

  it('returns an empty mapping for a successful but unexpected response shape', () => {
    expect(sentMessageIdsFromBody('{}')).toEqual([]);
    expect(sentMessageIdsFromBody('')).toEqual([]);
  });
});
