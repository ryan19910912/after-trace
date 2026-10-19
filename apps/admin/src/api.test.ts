import { describe, expect, it } from 'vitest';
import { normalizeAdminApiTimestamps } from './api';

describe('normalizeAdminApiTimestamps', () => {
  it('normalizes PostgreSQL timestamptz text before the Admin display layer formats Taipei time', () => {
    expect(normalizeAdminApiTimestamps({
      created_at: '2026-09-05 13:35:17.936087+00',
      nested: [{ updated_at: '2026-09-05 13:35:17+0800' }],
    })).toEqual({
      created_at: '2026-09-05T13:35:17.936+00:00',
      nested: [{ updated_at: '2026-09-05T13:35:17+08:00' }],
    });
  });

  it('leaves ordinary strings and already-ISO timestamps unchanged', () => {
    expect(normalizeAdminApiTimestamps({
      summary: 'ADMIN_API returned HTTP 503',
      created_at: '2026-09-05T13:35:17.936Z',
    })).toEqual({
      summary: 'ADMIN_API returned HTTP 503',
      created_at: '2026-09-05T13:35:17.936Z',
    });
  });
});
