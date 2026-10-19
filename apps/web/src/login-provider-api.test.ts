import { describe, expect, it } from 'vitest';
import { WorklogApi } from './worklog-api';

describe('provider-neutral Web login entry', () => {
  const api = new WorklogApi('https://api.example.test/');

  it('routes existing customer login entry to the provider chooser', () => {
    expect(api.lineLoginUrl()).toBe('/login');
  });

  it('builds explicit Google and LINE provider OAuth start URLs', () => {
    expect(api.providerLoginUrl('google')).toBe('https://api.example.test/api/v1/auth/google/start');
    expect(api.providerLoginUrl('line')).toBe('https://api.example.test/api/v1/auth/line/start');
  });
});
