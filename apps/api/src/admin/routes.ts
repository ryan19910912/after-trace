import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import {
  adminAuthConfigured,
  authenticateAdminCredentials,
  bearerToken,
  issueAdminSessionToken,
  verifyAdminSessionToken,
  type AdminAccessEnv,
} from './auth';

export type AdminBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type AdminEnv = {
  Bindings: AdminBindings;
  Variables: { adminUsername: string };
};

const SUPPORTED_AI_PROVIDER = 'GOOGLE';

export function createAdminRoutes() {
  const app = new Hono<AdminEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && !allowed) return c.json({ ok: false, error: 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    if (origin && origin !== allowed) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && origin === allowed) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowed || origin !== allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.post('/login', async (c) => {
    if (!adminAuthConfigured(c.env)) return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    let identity;
    try { identity = await authenticateAdminCredentials(username, password, c.env); }
    catch { return c.json({ ok: false, error: 'ADMIN_LOGIN_INVALID' }, 401); }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_LOGIN_INVALID' }, 401);
    return c.json({
      ok: true,
      sessionToken: await issueAdminSessionToken({ username: identity.username, env: c.env }),
      username: identity.username,
    });
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try { identity = await verifyAdminSessionToken(token, c.env); }
    catch { return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503); }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username);
    await next();
  });

  app.get('/session', (c) => c.json({ ok: true, username: c.get('adminUsername') }));

  app.get('/ai-runtime', async (c) => {
    const result = await createDatabase(c.env.DATABASE_URL).execute(sql`
      SELECT id, provider, model,
             input_usd_per_million::text AS input_usd_per_million,
             output_usd_per_million::text AS output_usd_per_million,
             audio_usd_per_million::text AS audio_usd_per_million,
             image_usd_per_million::text AS image_usd_per_million,
             usd_twd_rate::text AS usd_twd_rate,
             updated_by, created_at, updated_at
      FROM worklog_ai_runtime_config
      WHERE id = 1
      LIMIT 1
    `);
    return c.json({ ok: true, config: result.rows[0] ?? null });
  });

  app.put('/ai-runtime', async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    let input: AiRuntimeInput;
    try { input = aiRuntimeInput(body); }
    catch (error) { return c.json({ ok: false, error: safeError(error, 'INVALID_AI_RUNTIME_CONFIG') }, 400); }

    const database = createDatabase(c.env.DATABASE_URL);
    const result = await database.execute(sql`
      WITH previous AS MATERIALIZED (
        SELECT to_jsonb(runtime_row) AS value
        FROM worklog_ai_runtime_config AS runtime_row
        WHERE runtime_row.id = 1
      ), changed AS MATERIALIZED (
        INSERT INTO worklog_ai_runtime_config (
          id, provider, model, input_usd_per_million, output_usd_per_million,
          audio_usd_per_million, image_usd_per_million, usd_twd_rate,
          updated_by, created_at, updated_at
        ) VALUES (
          1, ${input.provider}, ${input.model}, ${input.inputUsdPerMillion}, ${input.outputUsdPerMillion},
          ${input.audioUsdPerMillion}, ${input.imageUsdPerMillion}, ${input.usdTwdRate},
          ${c.get('adminUsername')}, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET provider = EXCLUDED.provider,
            model = EXCLUDED.model,
            input_usd_per_million = EXCLUDED.input_usd_per_million,
            output_usd_per_million = EXCLUDED.output_usd_per_million,
            audio_usd_per_million = EXCLUDED.audio_usd_per_million,
            image_usd_per_million = EXCLUDED.image_usd_per_million,
            usd_twd_rate = EXCLUDED.usd_twd_rate,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (
          actor_admin, action, target_type, target_id, before_value, after_value, created_at
        )
        SELECT ${c.get('adminUsername')}, 'AI_RUNTIME_UPDATED', 'AI_RUNTIME', '1',
               (SELECT value FROM previous), to_jsonb(changed), NOW()
        FROM changed
        RETURNING id
      )
      SELECT changed.id, changed.provider, changed.model,
             changed.input_usd_per_million::text AS input_usd_per_million,
             changed.output_usd_per_million::text AS output_usd_per_million,
             changed.audio_usd_per_million::text AS audio_usd_per_million,
             changed.image_usd_per_million::text AS image_usd_per_million,
             changed.usd_twd_rate::text AS usd_twd_rate,
             changed.updated_by, changed.created_at, changed.updated_at
      FROM changed
      WHERE EXISTS (SELECT 1 FROM audit)
    `);
    const config = result.rows[0];
    return config
      ? c.json({ ok: true, config })
      : c.json({ ok: false, error: 'AI_RUNTIME_UPDATE_FAILED' }, 500);
  });

  return app;
}

type AiRuntimeInput = {
  provider: string;
  model: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  audioUsdPerMillion: string | null;
  imageUsdPerMillion: string | null;
  usdTwdRate: string | null;
};

function aiRuntimeInput(body: Record<string, unknown>): AiRuntimeInput {
  const provider = requiredText(body.provider, 'INVALID_AI_PROVIDER', 128).toUpperCase();
  if (provider !== SUPPORTED_AI_PROVIDER) throw new Error('AI_PROVIDER_NOT_SUPPORTED');
  const outputUsdPerMillion = decimal(body.outputUsdPerMillion, 'INVALID_AI_OUTPUT_PRICE');
  if (Number(outputUsdPerMillion) <= 0) throw new Error('AI_OUTPUT_PRICE_MUST_BE_POSITIVE');
  return {
    provider,
    model: requiredText(body.model, 'INVALID_AI_MODEL', 255),
    inputUsdPerMillion: decimal(body.inputUsdPerMillion, 'INVALID_AI_INPUT_PRICE'),
    outputUsdPerMillion,
    audioUsdPerMillion: nullableDecimal(body.audioUsdPerMillion, 'INVALID_AI_AUDIO_PRICE'),
    imageUsdPerMillion: nullableDecimal(body.imageUsdPerMillion, 'INVALID_AI_IMAGE_PRICE'),
    usdTwdRate: nullableDecimal(body.usdTwdRate, 'INVALID_USD_TWD_RATE'),
  };
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function requiredText(value: unknown, error: string, max: number): string {
  if (typeof value !== 'string') throw new Error(error);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function decimal(value: unknown, error: string): string {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error(error);
  return raw;
}

function nullableDecimal(value: unknown, error: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return decimal(value, error);
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.slice(0, 160) || fallback : fallback;
}
