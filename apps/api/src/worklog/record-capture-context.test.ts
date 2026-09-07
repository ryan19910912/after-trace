import { describe, expect, it } from 'vitest';
import { parseRecordCaptureContext } from './record-capture-context';

const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;

describe('parseRecordCaptureContext', () => {
  it('accepts bounded explicit page metadata from a canonical Chrome extension origin', () => {
    expect(parseRecordCaptureContext({
      page: {
        title: '  AFTERTRACE   文件  ',
        url: 'https://example.test/docs?id=7#capture',
      },
    }, extensionOrigin)).toEqual({
      client: 'CHROME_EXTENSION',
      page: {
        title: 'AFTERTRACE 文件',
        url: 'https://example.test/docs?id=7#capture',
      },
    });
  });

  it('allows title-only context when the active browser page has no safe http(s) URL', () => {
    expect(parseRecordCaptureContext({ page: { title: 'Chrome settings', url: null } }, extensionOrigin)).toEqual({
      client: 'CHROME_EXTENSION',
      page: { title: 'Chrome settings', url: null },
    });
  });

  it('rejects arbitrary metadata keys or full-page content', () => {
    expect(parseRecordCaptureContext({
      page: { title: 'Example', url: 'https://example.test' },
      pageText: 'silently archived page content',
    }, extensionOrigin)).toBe('INVALID');
  });

  it('rejects capture metadata from a normal Web origin in this extension-only V1 path', () => {
    expect(parseRecordCaptureContext({
      page: { title: 'Example', url: 'https://example.test' },
    }, 'https://web.example.test')).toBe('INVALID');
  });

  it('rejects unsafe page URL schemes and credential-bearing URLs', () => {
    expect(parseRecordCaptureContext({ page: { title: null, url: 'chrome://settings' } }, extensionOrigin)).toBe('INVALID');
    expect(parseRecordCaptureContext({ page: { title: null, url: 'https://user:secret@example.test/' } }, extensionOrigin)).toBe('INVALID');
  });
});
