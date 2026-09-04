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
  ids.user1 = await scalar(`INSERT INTO worklog_users (line_user_id, display_name) VALUES (${quote(`integrity-u1-${suffix}`)}, 'Integrity U1') RETURNING id`);
  ids.user2 = await scalar(`INSERT INTO worklog_users (line_user_id, display_name) VALUES (${quote(`integrity-u2-${suffix}`)}, 'Integrity U2') RETURNING id`);
  cleanup.push(`DELETE FROM worklog_users WHERE id IN (${ids.user1}, ${ids.user2})`);

  ids.workspace1 = await scalar(`INSERT INTO worklog_workspaces (owner_user_id, name) VALUES (${ids.user1}, ${quote(`Integrity W1 ${suffix}`)}) RETURNING id`);
  ids.workspace2 = await scalar(`INSERT INTO worklog_workspaces (owner_user_id, name) VALUES (${ids.user2}, ${quote(`Integrity W2 ${suffix}`)}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_workspaces WHERE id IN (${ids.workspace1}, ${ids.workspace2})`);

  ids.private1 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, private_user_id) VALUES (${ids.workspace1}, 'PRIVATE', ${ids.user1}) RETURNING id`);
  ids.private2 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, private_user_id) VALUES (${ids.workspace2}, 'PRIVATE', ${ids.user2}) RETURNING id`);
  ids.group1 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, line_group_id) VALUES (${ids.workspace1}, 'GROUP', ${quote(`integrity-g1-${suffix}`)}) RETURNING id`);
  ids.group2 = await scalar(`INSERT INTO worklog_sources (workspace_id, type, line_group_id) VALUES (${ids.workspace2}, 'GROUP', ${quote(`integrity-g2-${suffix}`)}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_sources WHERE id IN (${ids.private1}, ${ids.private2}, ${ids.group1}, ${ids.group2})`);

  ids.entity1 = await scalar(`INSERT INTO worklog_entities (source_id, name) VALUES (${ids.private1}, ${quote(`Entity A ${suffix}`)}) RETURNING id`);
  ids.entity2 = await scalar(`INSERT INTO worklog_entities (source_id, name) VALUES (${ids.private2}, ${quote(`Entity B ${suffix}`)}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_entities WHERE id IN (${ids.entity1}, ${ids.entity2})`);

  ids.record1 = await scalar(`INSERT INTO worklog_records (source_id, entity_id, author_user_id, input_type, raw_text) VALUES (${ids.private1}, ${ids.entity1}, ${ids.user1}, 'TEXT', 'integrity record 1') RETURNING id`);
  ids.record2 = await scalar(`INSERT INTO worklog_records (source_id, entity_id, author_user_id, input_type, raw_text) VALUES (${ids.private2}, ${ids.entity2}, ${ids.user2}, 'TEXT', 'integrity record 2') RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_records WHERE id IN (${ids.record1}, ${ids.record2})`);

  ids.grant1 = await scalar(`INSERT INTO worklog_ai_grants (owner_user_id, type, original_points, remaining_points, origin_key) VALUES (${ids.user1}, 'ADMIN', 1000, 1000, ${quote(`integrity-grant-1-${suffix}`)}) RETURNING id`);
  ids.grant2 = await scalar(`INSERT INTO worklog_ai_grants (owner_user_id, type, original_points, remaining_points, origin_key) VALUES (${ids.user2}, 'ADMIN', 1000, 1000, ${quote(`integrity-grant-2-${suffix}`)}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_ai_grants WHERE id IN (${ids.grant1}, ${ids.grant2})`);

  ids.scope1 = await scalar(`INSERT INTO worklog_ai_grant_scopes (grant_id, source_id) VALUES (${ids.grant1}, ${ids.private1}) RETURNING id`);
  ids.scope2 = await scalar(`INSERT INTO worklog_ai_grant_scopes (grant_id, source_id) VALUES (${ids.grant2}, ${ids.private2}) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_ai_grant_scopes WHERE id IN (${ids.scope1}, ${ids.scope2})`);

  ids.reservation1 = await scalar(`INSERT INTO worklog_ai_point_reservations (token, charged_user_id, actor_user_id, source_id, points_reserved, expires_at) VALUES (${quote(`integrity-res-1-${suffix}`)}, ${ids.user1}, ${ids.user1}, ${ids.private1}, 10, now() + interval '1 hour') RETURNING id`);
  ids.reservation2 = await scalar(`INSERT INTO worklog_ai_point_reservations (token, charged_user_id, actor_user_id, source_id, points_reserved, expires_at) VALUES (${quote(`integrity-res-2-${suffix}`)}, ${ids.user2}, ${ids.user2}, ${ids.private2}, 10, now() + interval '1 hour') RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_ai_point_reservations WHERE id IN (${ids.reservation1}, ${ids.reservation2})`);

  ids.usage1 = await scalar(`INSERT INTO worklog_ai_usage_events (reservation_token, actor_user_id, charged_user_id, workspace_id, source_id, record_id, operation, provider, model, input_usd_per_million, output_usd_per_million, provider_cost_usd, customer_points_charged) VALUES (${quote(`integrity-usage-${suffix}`)}, ${ids.user1}, ${ids.user1}, ${ids.workspace1}, ${ids.private1}, ${ids.record1}, 'TEXT_RECORD_CREATE', 'GOOGLE', 'gemini-3.5-flash', 1, 1, 0.000001, 1) RETURNING id`);
  cleanup.unshift(`DELETE FROM worklog_ai_usage_events WHERE id = ${ids.usage1}`);
}

async function probes() {
  await expectRejected(
    'PRIVATE/GROUP Source identity shape rejects mixed identity',
    `INSERT INTO worklog_sources (workspace_id, type, private_user_id, line_group_id) VALUES (${ids.workspace1}, 'GROUP', ${ids.user1}, ${quote(`invalid-mixed-${suffix}`)})`,
  );

  await expectRejected(
    'Alias cannot point to Entity from another Source',
    `INSERT INTO worklog_entity_aliases (source_id, entity_id, alias) VALUES (${ids.private1}, ${ids.entity2}, ${quote(`bad-alias-${suffix}`)})`,
  );

  await expectRejected(
    'Record cannot point to Entity from another Source',
    `INSERT INTO worklog_records (source_id, entity_id, author_user_id, input_type, raw_text) VALUES (${ids.private1}, ${ids.entity2}, ${ids.user1}, 'TEXT', 'bad cross-source record')`,
  );

  await expectRejected(
    'Pending Confirmation Record must belong to same Source',
    `INSERT INTO worklog_ai_confirmations (source_id, record_id, requested_user_id, confirmation_type, status) VALUES (${ids.private1}, ${ids.record2}, ${ids.user1}, 'RECORD_TITLE', 'PENDING')`,
  );

  await expectRejected(
    'PRIVATE Web entry user and Source must match',
    `INSERT INTO worklog_private_web_entry_nonces (nonce, line_user_id, user_id, source_id, expires_at) VALUES (${quote(`bad-private-web-${suffix}`)}, ${quote(`integrity-u1-${suffix}`)}, ${ids.user1}, ${ids.private2}, now() + interval '5 minutes')`,
  );

  await expectRejected(
    'LINE AI edit target Record must belong to same Source',
    `INSERT INTO worklog_line_ai_edits (source_id, record_id, actor_user_id, charged_user_id, line_command_message_id, quoted_line_message_id, command_timestamp, instruction, expected_record_version, status, claim_token) VALUES (${ids.private1}, ${ids.record2}, ${ids.user1}, ${ids.user1}, ${quote(`bad-line-edit-${suffix}`)}, ${quote(`quoted-${suffix}`)}, now(), 'change it', 1, 'PROCESSING', ${quote(`claim-${suffix}`)})`,
  );

  await expectRejected(
    'Attachment Record must belong to same Source',
    `INSERT INTO worklog_attachment_ingestions (command_line_message_id, quoted_line_message_id, source_id, actor_user_id, status, record_id) VALUES (${quote(`bad-att-rec-${suffix}`)}, ${quote(`quoted-att-rec-${suffix}`)}, ${ids.private1}, ${ids.user1}, 'SUCCEEDED', ${ids.record2})`,
  );

  await expectRejected(
    'Attachment reservation must belong to same Source',
    `INSERT INTO worklog_attachment_ingestions (command_line_message_id, quoted_line_message_id, source_id, actor_user_id, status, reservation_token) VALUES (${quote(`bad-att-res-${suffix}`)}, ${quote(`quoted-att-res-${suffix}`)}, ${ids.private1}, ${ids.user1}, 'PROCESSING', ${quote(`integrity-res-2-${suffix}`)})`,
  );

  await expectRejected(
    'Reservation funding scope must belong to same Grant',
    `INSERT INTO worklog_ai_point_reservation_funding (reservation_id, grant_id, grant_scope_id, points_reserved) VALUES (${ids.reservation1}, ${ids.grant1}, ${ids.scope2}, 1)`,
  );

  await expectRejected(
    'Usage funding scope must belong to same Grant',
    `INSERT INTO worklog_ai_usage_funding (usage_event_id, grant_id, grant_scope_id, points_charged) VALUES (${ids.usage1}, ${ids.grant1}, ${ids.scope2}, 1)`,
  );

  const entityCaseBase = `CaseProbe${suffix}`;
  await expectAccepted(
    'Entity baseline accepts first case variant',
    `INSERT INTO worklog_entities (source_id, name) VALUES (${ids.private1}, ${quote(entityCaseBase)})`,
  );
  await expectAccepted(
    'Entity database currently allows case-only duplicate (observed behavior)',
    `INSERT INTO worklog_entities (source_id, name) VALUES (${ids.private1}, ${quote(entityCaseBase.toLowerCase())})`,
  );
  cleanup.unshift(`DELETE FROM worklog_entities WHERE source_id = ${ids.private1} AND lower(name) = lower(${quote(entityCaseBase)})`);

  const aliasCaseBase = `AliasProbe${suffix}`;
  await expectAccepted(
    'Alias baseline accepts first case variant',
    `INSERT INTO worklog_entity_aliases (source_id, entity_id, alias) VALUES (${ids.private1}, ${ids.entity1}, ${quote(aliasCaseBase)})`,
  );
  await expectAccepted(
    'Alias database currently allows case-only duplicate (observed behavior)',
    `INSERT INTO worklog_entity_aliases (source_id, entity_id, alias) VALUES (${ids.private1}, ${ids.entity1}, ${quote(aliasCaseBase.toLowerCase())})`,
  );
  cleanup.unshift(`DELETE FROM worklog_entity_aliases WHERE source_id = ${ids.private1} AND lower(alias) = lower(${quote(aliasCaseBase)})`);

  console.log('[OBSERVE] Entity/Alias uniqueness is case-sensitive in PostgreSQL; runtime matching is case-insensitive. This must be resolved before launch.');
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
console.log('AFTERTRACE fresh PostgreSQL integrity probes passed; case-insensitive Entity/Alias collision remains an observed launch blocker.');
