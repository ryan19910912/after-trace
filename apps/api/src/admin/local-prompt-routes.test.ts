import { describe, expect, it, vi } from 'vitest';
import { createLocalPromptRoutes } from './local-prompt-routes';
import { localPromptDefinitions } from '../worklog/local-prompt-config';
import type { Database } from '../db/client';
const env = { DATABASE_URL: 'not-used', ADMIN_WEB_ORIGIN: 'https://admin.test', WEB_APP_ORIGIN: 'https://web.test' };
describe('local prompt route boundaries', () => {
  it('blocks unauthenticated edits and cross origin reads before opening database', async () => {
    const factory = vi.fn(); const app = createLocalPromptRoutes(true, { databaseFactory: factory });
    expect((await app.request('/', {}, env)).status).toBe(401);
    expect((await app.request('/', { headers: { Origin: 'https://wrong.test' } }, env)).status).toBe(403); expect(factory).not.toHaveBeenCalled();
  });
  it('publishes no drafts or actor data and revalidates unchanged content with ETag', async () => {
    const execute = vi.fn(async () => ({ rows: localPromptDefinitions.map((p) => ({ key: p.key, published_template: p.template, published_max_tokens: p.maxTokens, published_version: 1, draft_template: 'private draft', updated_by: 'admin' })) }));
    const app = createLocalPromptRoutes(false, { databaseFactory: () => ({ execute }) as unknown as Database });
    const response = await app.request('/', { headers: { Origin: 'https://web.test' } }, env); expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain('private draft'); expect(text).not.toContain('updated_by');
    const etag = response.headers.get('ETag')!; expect(etag).toBeTruthy();
    expect((await app.request('/', { headers: { 'If-None-Match': etag } }, env)).status).toBe(304);
  });
  it('rejects invalid template and output budget before issuing a write', async () => {
    const execute = vi.fn(); const app = createLocalPromptRoutes(true, { databaseFactory: () => ({ execute }) as unknown as Database, verifySession: async () => ({ username: 'operator' }) });
    const response = await app.request('/capture', { method: 'PUT', headers: { Authorization: 'Bearer signed', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, template: 'missing variables', maxTokens: 128 }) }, env);
    expect(response.status).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
});
