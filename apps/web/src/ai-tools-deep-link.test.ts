import { describe, expect, it } from 'vitest';
import { aiToolsDeepLinkFromSearch, aiToolsDeepLinkUrl } from './ai-tools-deep-link';

describe('aiToolsDeepLink', () => {
  it('accepts only one positive source/record id and a known tool', () => {
    expect(aiToolsDeepLinkFromSearch('?sourceId=12&recordId=91&tool=rewrite')).toEqual({
      sourceId: 12,
      recordId: 91,
      tool: 'rewrite',
    });
    expect(aiToolsDeepLinkFromSearch('?recordId=91&tool=related&sourceId=12')).toEqual({
      sourceId: 12,
      recordId: 91,
      tool: 'related',
    });
  });

  it('rejects extra, duplicate, malformed or unsupported query state', () => {
    expect(aiToolsDeepLinkFromSearch('?sourceId=12&recordId=91&tool=related&next=https://evil.test')).toBeNull();
    expect(aiToolsDeepLinkFromSearch('?sourceId=12&sourceId=13&recordId=91&tool=related')).toBeNull();
    expect(aiToolsDeepLinkFromSearch('?sourceId=-1&recordId=91&tool=related')).toBeNull();
    expect(aiToolsDeepLinkFromSearch('?sourceId=12&recordId=1.5&tool=related')).toBeNull();
    expect(aiToolsDeepLinkFromSearch('?sourceId=12&recordId=91&tool=summary')).toBeNull();
  });

  it('builds same-app links without accepting arbitrary destinations', () => {
    expect(aiToolsDeepLinkUrl({ sourceId: 12, recordId: 91, tool: 'related' }))
      .toBe('/ai-tools?sourceId=12&recordId=91&tool=related');
    expect(() => aiToolsDeepLinkUrl({ sourceId: 12, recordId: 91, tool: 'other' as never }))
      .toThrow('INVALID_AI_TOOLS_DEEP_LINK');
  });
});
