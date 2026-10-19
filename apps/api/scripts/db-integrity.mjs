import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const localEnvPath = resolve(root, '.env.local');
const fallbackEnvPath = resolve(root, '.env');

if (!process.env.DATABASE_URL) {
  if (existsSync(localEnvPath)) loadEnvFile(localEnvPath);
  else if (existsSync(fallbackEnvPath)) loadEnvFile(fallbackEnvPath);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required for integrity validation.');
  process.exit(2);
}

const db = drizzle(neon(databaseUrl));
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
const ids = {};
const cleanup = [];
let failed = false;

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function execute(statement) {
  return db.execute(drizzleSql.raw(statement));
}

async function scalar(statement, column = 'id') {
  const result = await execute(statement);
  return Number(result.rows[0]?.[column]);
}

async function expectRejected(label, statement) {
  try {
    await execute(statement);
    console.error(`[FAIL] ${label}: database accepted an invalid write`);
    failed = true;
  } catch {
    console.log(`[PASS] ${label}`);
  }
}

async function expectAccepted(label, statement) {
  try {
    await execute(statement);
    console.log(`[PASS] ${label}`);
  } catch (error) {
    console.error(`[FAIL] ${label}`);
    console.error(error);
    failed = true;
  }
}

async function setup() {
  ids.user1 = await scalar(`INSERT INTO worklog_users (display_name) VALUES ('Integrity U1') RETURNING id`);
  ids.user2 = await scalar(`INSERT INTO worklog_users (display_name) VALUES ('Integrity U2') RETURNING id`);
  cleanup.push(`DELETE FROM worklog_users WHERE id IN (${ids.user1}, ${ids.user2})`);

  ids.workspace1 = await scalar(`INSERT INTO worklog_workspaces (owner_user_id, name) VALUES (${ids.user1}, ${quote(`Integrity W1 ${suffix}`)}) RETURNING id`);
  ids.workspace2 = await scalar(`INSERT INTO worklog_workspaces (owner_user_id, name) VALUES (${ids.user2}, ${quote(`Integrity W2 ${suffix}`)}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_workspaces WHERE id IN (${ids.workspace1}, ${ids.workspace2})`);

  ids.private1 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, private_user_id, created_by_user_id) VALUES (${ids.workspace1}, 'PRIVATE', ${ids.user1}, ${ids.user1}) RETURNING id`);
  ids.private2 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, private_user_id, created_by_user_id) VALUES (${ids.workspace2}, 'PRIVATE', ${ids.user2}, ${ids.user2}) RETURNING id`);
  ids.group1 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, name, created_by_user_id) VALUES (${ids.workspace1}, 'GROUP', ${quote(`Integrity Group ${suffix}`)}, ${ids.user1}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_sources WHERE id IN (${ids.private1}, ${ids.private2}, ${ids.group1})`);

  await execute(`INSERT INTO worklog_source_members (source_id, user_id, role, is_active) VALUES (${ids.group1}, ${ids.user1}, 'OWNER', TRUE)`);
  cleanup.unshift(`DELETE FROM worklog_source_members WHERE source_id = ${ids.group1}`);

  ids.record1 = await scalar(`INSERT INTO worklog_records (source_id, author_user_id, input_type, raw_text, occurred_at) VALUES (${ids.private1}, ${ids.user1}, 'TEXT', 'integrity record 1', NULL) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_records WHERE id = ${ids.record1}`);
}

async function probes() {
  await expectRejected(
    'PRIVATE Source requires its private user',
    `INSERT INTO worklog_sources (workspace_id, type, name, created_by_user_id) VALUES (${ids.workspace1}, 'PRIVATE', 'invalid private', ${ids.user1})`,
  );

  await expectRejected(
    'GROUP Source cannot carry a private user',
    `INSERT INTO worklog_sources (workspace_id, type, private_user_id, name, created_by_user_id) VALUES (${ids.workspace1}, 'GROUP', ${ids.user1}, 'invalid group', ${ids.user1})`,
  );

  await expectRejected(
    'GROUP Source requires a non-empty name',
    `INSERT INTO worklog_sources (workspace_id, type, name, created_by_user_id) VALUES (${ids.workspace1}, 'GROUP', '   ', ${ids.user1})`,
  );

  await expectRejected(
    'one user cannot have two PRIVATE Sources',
    `INSERT INTO worklog_sources (workspace_id, type, private_user_id, created_by_user_id) VALUES (${ids.workspace1}, 'PRIVATE', ${ids.user1}, ${ids.user1})`,
  );

  await expectAccepted(
    'manual Record accepts nullable occurred_at and no AI metadata',
    `INSERT INTO worklog_records (source_id, author_user_id, input_type, raw_text, occurred_at) VALUES (${ids.private2}, ${ids.user2}, 'TEXT', 'manual record without AI metadata', NULL)`,
  );
  cleanup.unshift(`DELETE FROM worklog_records WHERE source_id = ${ids.private2} AND raw_text = 'manual record without AI metadata'`);

  await expectRejected(
    'retired TOP_UP grant type is unavailable',
    `INSERT INTO worklog_ai_grants (owner_user_id, type, original_points, remaining_points, origin_key) VALUES (${ids.user1}, 'TOP_UP', 10, 10, ${quote(`retired-top-up-${suffix}`)})`,
  );

  await expectRejected(
    'retired ONE_TIME plan type is unavailable',
    `INSERT INTO worklog_subscription_plans (code, plan_type, display_name, price_twd) VALUES (${quote(`RETIRED_${suffix}`)}, 'ONE_TIME', 'retired', 1)`,
  );
}

async function cleanupAll() {
  for (const statement of cleanup) {
    try {
      await execute(statement);
    } catch (error) {
      console.error('[WARN] cleanup failed:', statement);
      console.error(error);
    }
  }
}

try {
  await setup();
  await probes();
} catch (error) {
  failed = true;
  console.error('[FAIL] integrity probe aborted unexpectedly');
  console.error(error);
} finally {
  await cleanupAll();
}

if (failed) process.exit(1);
console.log('AFTERTRACE target PostgreSQL integrity probes passed.');
