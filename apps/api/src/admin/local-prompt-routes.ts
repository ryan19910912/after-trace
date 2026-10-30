import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';
import { localPromptDefinitions, promptDefinition, validatePrompt } from '../worklog/local-prompt-config';

type Bindings = AdminAccessEnv & { DATABASE_URL: string; ADMIN_WEB_ORIGIN?: string; WEB_APP_ORIGIN?: string };
type Env = { Bindings: Bindings; Variables: { database: Database; actor: string } };
export function createLocalPromptRoutes(admin = false, dependencies: { databaseFactory?: typeof createDatabase; verifySession?: typeof verifyAdminSessionToken } = {}) {
  const app = new Hono<Env>(); const database = dependencies.databaseFactory ?? createDatabase;
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin'); const allowed = admin ? c.env.ADMIN_WEB_ORIGIN : c.env.WEB_APP_ORIGIN;
    if (origin && origin !== allowed) return c.json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
    if (origin && allowed) { c.header('Access-Control-Allow-Origin', allowed); c.header('Vary', 'Origin'); }
    c.header('Cache-Control', admin ? 'no-store' : 'no-cache'); await next();
  });
  app.options('*', (c) => { c.header('Access-Control-Allow-Methods', admin ? 'GET, PUT, POST, OPTIONS' : 'GET, OPTIONS'); c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match'); c.header('Access-Control-Expose-Headers', 'ETag'); c.header('Access-Control-Max-Age', '600'); return c.body(null, 204); });
  app.use('*', async (c, next) => {
    if (admin) {
      const token = bearerToken(c.req.header('authorization')); if (!token) return c.json({ error: 'ADMIN_SESSION_REQUIRED' }, 401);
      const identity = await (dependencies.verifySession ?? verifyAdminSessionToken)(token, c.env);
      if (!identity) return c.json({ error: 'ADMIN_SESSION_INVALID' }, 401);
      c.set('actor', identity.username);
    }
    c.set('database', database(c.env.DATABASE_URL)); await next();
  });
  app.use('*', bodyLimit({ maxSize: 16384, onError: (c) => c.json({ error: 'REQUEST_TOO_LARGE' }, 413) }));
  app.get('/', async (c) => {
    const result = await c.get('database').execute(admin ? sql`SELECT * FROM worklog_local_ai_prompts ORDER BY key` : sql`SELECT key, published_template, published_max_tokens, published_version FROM worklog_local_ai_prompts ORDER BY key`);
    if (result.rows.length !== localPromptDefinitions.length) return c.json({ error: 'PROMPTS_NOT_INITIALIZED' }, 503);
    const prompts = result.rows.map((row) => { const spec = promptDefinition(String(row.key))!; return admin ? { ...row, name: spec.name, description: spec.description, variables: spec.variables, outputFields: spec.outputFields } : { key: row.key, template: row.published_template, maxTokens: row.published_max_tokens, version: row.published_version }; });
    if (!admin) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(prompts)));
      const etag = '"' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') + '"';
      c.header('ETag', etag); c.header('Access-Control-Expose-Headers', 'ETag');
      if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    }
    return c.json({ prompts });
  });
  app.onError((error, c) => { console.error('LOCAL_PROMPT_CONFIG_FAILED', error); return c.json({ error: 'PROMPT_CONFIG_UNAVAILABLE' }, 503); });
  if (!admin) return app;
  app.get('/:key/history', async (c) => {
    const key = c.req.param('key'); if (!promptDefinition(key)) return c.json({ error: 'UNKNOWN_PROMPT' }, 404);
    const result = await c.get('database').execute(sql`SELECT id::text AS id, action, version, max_tokens, actor, created_at FROM worklog_local_ai_prompt_revisions AS revision WHERE prompt_key = ${key} ORDER BY revision.id DESC LIMIT 20`);
    return c.json({ revisions: result.rows });
  });
  app.get('/:key/history/:id', async (c) => {
    const key = c.req.param('key'), id = c.req.param('id');
    if (!promptDefinition(key) || !/^\d{1,15}$/.test(id)) return c.json({ error: 'INVALID_REVISION' }, 400);
    const result = await c.get('database').execute(sql`SELECT template FROM worklog_local_ai_prompt_revisions WHERE prompt_key = ${key} AND id = ${Number(id)} LIMIT 1`);
    return result.rows[0] ? c.json({ template: result.rows[0].template }) : c.json({ error: 'REVISION_NOT_FOUND' }, 404);
  });
  app.on(['PUT', 'POST'], ['/:key', '/:key/:operation'], async (c) => {
    const key = c.req.param('key')!; if (!promptDefinition(key)) return c.json({ error: 'UNKNOWN_PROMPT' }, 404);
    const operation = c.req.param('operation') ?? 'draft';
    if ((operation === 'draft' && c.req.method !== 'PUT') || (operation !== 'draft' && c.req.method !== 'POST') || !['draft','publish','restore'].includes(operation)) return c.json({ error: 'INVALID_OPERATION' }, 400);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return c.json({ error: 'EXPECTED_VERSION_REQUIRED' }, 400);
    const actor = c.get('actor'); const expected = Number(body.expectedVersion); const db = c.get('database');
    if (operation === 'draft') { const error = validatePrompt(key, body.template, body.maxTokens); if (error) return c.json({ error }, 400); }
    if (operation === 'restore' && (!/^\d{1,15}$/.test(String(body.revisionId ?? '')) || Number(body.revisionId) < 1)) return c.json({ error: 'INVALID_REVISION' }, 400);
    // One optimistic update plus its history insert commit in a single PostgreSQL statement.
    const result = await db.execute(operation === 'draft' ? sql`
      WITH changed AS (UPDATE worklog_local_ai_prompts SET draft_template = ${String(body.template)}, draft_max_tokens = ${Number(body.maxTokens)}, version = version + 1, updated_by = ${actor}, updated_at = NOW() WHERE key = ${key} AND version = ${expected} RETURNING *),
      audit AS (INSERT INTO worklog_local_ai_prompt_revisions(prompt_key,action,version,template,max_tokens,actor) SELECT key,'DRAFT_SAVED',version,draft_template,draft_max_tokens,${actor} FROM changed) SELECT * FROM changed
    ` : operation === 'publish' ? sql`
      WITH changed AS (UPDATE worklog_local_ai_prompts SET published_template = draft_template, published_max_tokens = draft_max_tokens, version = version + 1, published_version = version + 1, published_by = ${actor}, published_at = NOW(), updated_by = ${actor}, updated_at = NOW() WHERE key = ${key} AND version = ${expected} RETURNING *),
      audit AS (INSERT INTO worklog_local_ai_prompt_revisions(prompt_key,action,version,template,max_tokens,actor) SELECT key,'PUBLISHED',version,published_template,published_max_tokens,${actor} FROM changed) SELECT * FROM changed
    ` : sql`
      WITH selected AS (SELECT template,max_tokens FROM worklog_local_ai_prompt_revisions WHERE id = ${Number(body.revisionId)} AND prompt_key = ${key} AND action IN ('SEEDED','PUBLISHED','ROLLED_BACK')),
      changed AS (UPDATE worklog_local_ai_prompts AS p SET draft_template = selected.template, published_template = selected.template, draft_max_tokens = selected.max_tokens, published_max_tokens = selected.max_tokens, version = p.version + 1, published_version = p.version + 1, updated_by = ${actor}, published_by = ${actor}, updated_at = NOW(), published_at = NOW() FROM selected WHERE p.key = ${key} AND p.version = ${expected} RETURNING p.*),
      audit AS (INSERT INTO worklog_local_ai_prompt_revisions(prompt_key,action,version,template,max_tokens,actor) SELECT key,'ROLLED_BACK',version,published_template,published_max_tokens,${actor} FROM changed) SELECT * FROM changed
    `);
    if (!result.rows[0]) return c.json({ error: 'PROMPT_VERSION_CONFLICT_OR_REVISION_UNAVAILABLE' }, 409);
    const spec = promptDefinition(key)!;
    return c.json({ prompt: { ...result.rows[0], name: spec.name, description: spec.description, variables: spec.variables, outputFields: spec.outputFields } });
  });
  return app;
}
