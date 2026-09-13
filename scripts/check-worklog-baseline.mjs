import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDir = resolve(root, 'drizzle');
const metaDir = resolve(drizzleDir, 'meta');
const baselinePath = resolve(drizzleDir, '0000_worklog_baseline.sql');
const snapshotPath = resolve(metaDir, '0000_snapshot.json');
const journalPath = resolve(metaDir, '_journal.json');
const failures = [];

checkArtifactShape();

const baseline = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : '';
if (!baseline) failures.push('missing drizzle/0000_worklog_baseline.sql');
if (!existsSync(snapshotPath)) failures.push('missing drizzle/meta/0000_snapshot.json');
if (!existsSync(journalPath)) failures.push('missing drizzle/meta/_journal.json');

for (const marker of [
  'CREATE TABLE "worklog_users"',
  'CREATE TABLE "worklog_records"',
  'CREATE TABLE "worklog_checkout_intents"',
  'CREATE TABLE "worklog_newebpay_subscriptions"',
  'CREATE TABLE "worklog_newebpay_subscription_history"',
  'COMMENT ON TABLE "worklog_users"',
  'COMMENT ON TABLE "worklog_records"',
  'COMMENT ON TABLE "worklog_newebpay_subscription_history"',
  'COMMENT ON COLUMN "worklog_checkout_intents"."payer_email"',
]) {
  if (baseline && !baseline.includes(marker)) failures.push(`baseline missing: ${marker}`);
}

if (/CREATE\s+TYPE\s+.+\s+AS\s+ENUM/i.test(baseline)) {
  failures.push('baseline must not create PostgreSQL ENUM types; domain values belong to the application layer');
}
if (/\bCHECK\s*\(/i.test(baseline)) {
  failures.push('baseline must not contain CHECK constraints; domain/business validation belongs to the application layer');
}

const forbidden = [
  ['worklog_customers', 'legacy Customer table'],
  ['worklog_projects', 'legacy Project table'],
  ['worklog_project_status', 'legacy Project enum'],
  ['worklog_record_category', 'legacy Record category enum'],
  ['worklog_transaction_type', 'legacy Transaction enum'],
  ['worklog_transactions', 'legacy Transaction table'],
  ['ai_units_consumed', 'retired aggregate AI usage column'],
  ['worklog_ai_quota', 'retired aggregate AI quota schema/table marker'],
  ['subscription_owner_user_id', 'retired subscription Owner binding'],
  ['recording_enabled', 'retired GROUP recording preference'],
  ['subscription_period_points', 'retired subscription-only plan point template column'],
  ['worklog_source_ai_responsibility', 'retired GROUP AI responsible-user schema'],
  ['worklog_line_ai_edits', 'retired LINE AI edit state'],
  ['web_auth_entry_nonces', 'retired LINE Web-entry nonce'],
  ['line_user_id', 'retired core LINE user identity column'],
  ['line_group_id', 'retired LINE GROUP identity column'],
  ['worklog_entities', 'retired Entity table'],
  ['worklog_entity_aliases', 'retired Entity alias table'],
  ['worklog_ai_confirmations', 'retired AI confirmation table'],
  ['worklog_line_text_cache', 'retired LINE text cache'],
  ['worklog_line_record_reply_targets', 'retired LINE reply target table'],
  ['worklog_line_text_interpretations', 'retired LINE interpretation table'],
  ['worklog_record_ai_normalizations', 'retired post-persistence normalization table'],
  ['worklog_attachment_ingestions', 'retired LINE attachment ingestion table'],
  ['worklog_source_line_profiles', 'retired LINE group profile table'],
  ['LINE_AI_EDIT', 'retired LINE Record revision channel'],
];
for (const [marker, description] of forbidden) {
  if (baseline.includes(marker)) failures.push(`baseline forbidden: ${marker} (${description})`);
}

if (existsSync(journalPath)) {
  try {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    if (journal.dialect !== 'postgresql') failures.push('Drizzle journal dialect must be postgresql');
    if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
      failures.push('Drizzle journal must contain exactly one canonical baseline entry');
    } else {
      const entry = journal.entries[0];
      if (entry?.idx !== 0 || entry?.tag !== '0000_worklog_baseline') {
        failures.push('Drizzle journal entry must be idx=0 and tag=0000_worklog_baseline');
      }
    }
  } catch {
    failures.push('Drizzle journal is not valid JSON');
  }
}

if (failures.length > 0) {
  console.error('AFTERTRACE canonical database baseline is stale/inconsistent and deployment must stop.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('AFTERTRACE single canonical 0000 database baseline guard passed.');

function checkArtifactShape() {
  if (!existsSync(drizzleDir)) {
    failures.push('missing drizzle directory');
    return;
  }
  const rootEntries = readdirSync(drizzleDir).sort();
  const expectedRoot = ['0000_worklog_baseline.sql', 'meta'];
  if (!sameEntries(rootEntries, expectedRoot)) {
    failures.push(`drizzle directory must contain exactly ${expectedRoot.join(', ')}; found ${rootEntries.join(', ') || '(empty)'}`);
  }
  if (!existsSync(metaDir)) {
    failures.push('missing drizzle/meta directory');
    return;
  }
  const metaEntries = readdirSync(metaDir).sort();
  const expectedMeta = ['0000_snapshot.json', '_journal.json'];
  if (!sameEntries(metaEntries, expectedMeta)) {
    failures.push(`drizzle/meta must contain exactly ${expectedMeta.join(', ')}; found ${metaEntries.join(', ') || '(empty)'}`);
  }
}

function sameEntries(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
