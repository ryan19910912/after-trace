import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';
import { createDatabase, type Database } from '../db/client';

export type AdminFeedbackBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type Env = { Bindings: AdminFeedbackBindings; Variables: { adminUsername: string; database: Database } };
type FeedbackCategory = 'BUG' | 'FEATURE' | 'UX' | 'OTHER';
type FeedbackStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'IGNORED';

export function createAdminFeedbackManagementRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) {
      return c.json({ ok: false, error: allowed ? 'ORIGIN_NOT_ALLOWED' : 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, allowed ? 403 : 503);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowed === origin) { c.header('Access-Control-Allow-Origin', origin); c.header('Vary', 'Origin'); }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowed || origin !== allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try { identity = await verifyAdminSessionToken(token, c.env); }
    catch { return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503); }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username);
    c.set('database', createDatabase(c.env.DATABASE_URL));
    await next();
  });

  app.get('/', async (c) => {
    const status = optionalStatus(c.req.query('status'));
    const category = optionalCategory(c.req.query('category'));
    const limit = boundedLimit(c.req.query('limit'));
    const result = await c.get('database').execute(sql`
      SELECT
        feedback.id::text AS id,
        feedback.user_id::text AS user_id,
        COALESCE(public_id.public_account_id, '') AS public_account_id,
        COALESCE(feedback.display_name_snapshot, profile.display_name) AS display_name,
        feedback.channel,
        feedback.text,
        feedback.context,
        COALESCE(management.category, 'OTHER') AS category,
        COALESCE(management.status, 'OPEN') AS status,
        management.updated_by,
        COALESCE(management.updated_at, feedback.created_at) AS updated_at,
        feedback.created_at
      FROM worklog_feedback AS feedback
      LEFT JOIN worklog_users AS profile ON profile.id = feedback.user_id
      LEFT JOIN worklog_public_account_ids AS public_id ON public_id.user_id = feedback.user_id
      LEFT JOIN worklog_feedback_management AS management ON management.feedback_id = feedback.id
      WHERE (${status}::text IS NULL OR COALESCE(management.status, 'OPEN') = ${status})
        AND (${category}::text IS NULL OR COALESCE(management.category, 'OTHER') = ${category})
      ORDER BY CASE COALESCE(management.status, 'OPEN') WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
               feedback.created_at DESC, feedback.id DESC
      LIMIT ${limit}
    `);
    return c.json({ ok: true, feedback: result.rows });
  });

  app.patch('/:id', async (c) => {
    const feedbackId = positiveId(c.req.param('id'));
    if (!feedbackId) return c.json({ ok: false, error: 'INVALID_FEEDBACK_ID' }, 400);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const category = categoryValue(body.category);
    const status = statusValue(body.status);
    if (!category || !status) return c.json({ ok: false, error: 'INVALID_FEEDBACK_WORKFLOW' }, 400);

    const db = c.get('database');
    const exists = await db.execute(sql`SELECT id FROM worklog_feedback WHERE id = ${feedbackId} LIMIT 1`);
    if (!exists.rows[0]) return c.json({ ok: false, error: 'FEEDBACK_NOT_FOUND' }, 404);
    const before = await db.execute(sql`
      SELECT COALESCE(management.category, 'OTHER') AS category,
             COALESCE(management.status, 'OPEN') AS status,
             management.updated_by, management.updated_at
      FROM worklog_feedback AS feedback
      LEFT JOIN worklog_feedback_management AS management ON management.feedback_id = feedback.id
      WHERE feedback.id = ${feedbackId}
      LIMIT 1
    `);
    const result = await db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_feedback_management (feedback_id, category, status, updated_by, updated_at)
        VALUES (${feedbackId}, ${category}, ${status}, ${c.get('adminUsername')}, NOW())
        ON CONFLICT (feedback_id) DO UPDATE
        SET category = EXCLUDED.category,
            status = EXCLUDED.status,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (actor_admin, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${c.get('adminUsername')}, 'FEEDBACK_WORKFLOW_UPDATED', 'FEEDBACK', changed.feedback_id::text,
               ${JSON.stringify(before.rows[0] ?? null)}::jsonb, to_jsonb(changed), NOW()
        FROM changed
        RETURNING id
      )
      SELECT changed.feedback_id::text AS feedback_id, changed.category, changed.status,
             changed.updated_by, changed.updated_at
      FROM changed
      WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return c.json({ ok: true, feedback: result.rows[0] });
  });

  return app;
}

function optionalStatus(value: string | undefined): FeedbackStatus | null { return value ? statusValue(value) : null; }
function optionalCategory(value: string | undefined): FeedbackCategory | null { return value ? categoryValue(value) : null; }
function statusValue(value: unknown): FeedbackStatus | null { const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''; return ['OPEN','IN_PROGRESS','RESOLVED','IGNORED'].includes(normalized) ? normalized as FeedbackStatus : null; }
function categoryValue(value: unknown): FeedbackCategory | null { const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''; return ['BUG','FEATURE','UX','OTHER'].includes(normalized) ? normalized as FeedbackCategory : null; }
function boundedLimit(value: string | undefined) { const parsed = Number(value ?? 100); return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 100; }
function positiveId(value: string) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
async function jsonBody(c: { req: { json(): Promise<unknown> } }) { try { const value = await c.req.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } }
