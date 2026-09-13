import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDir = resolve(root, 'drizzle');
const metaDir = resolve(drizzleDir, 'meta');
const baselinePath = resolve(drizzleDir, '0000_worklog_baseline.sql');
const journalPath = resolve(metaDir, '_journal.json');
const failures = [];

checkArtifactShape();

let baseline = '';
if (existsSync(baselinePath)) baseline = readFileSync(baselinePath, 'utf8');
else failures.push('missing drizzle/0000_worklog_baseline.sql');

for (const marker of [
  'CREATE TABLE "worklog_users"',
  'CREATE TABLE "worklog_records"',
  'CREATE TABLE "worklog_record_revisions"',
  '"previous_title" varchar(255)',
  '"new_title" varchar(255)',
  'CREATE TABLE "worklog_checkout_intents"',
  '"payer_email" varchar(320)',
  'CREATE TABLE "worklog_newebpay_subscription_history"',
  'CREATE TABLE "worklog_newebpay_subscriptions"',
  'COMMENT ON TABLE "worklog_users"',
  'COMMENT ON TABLE "worklog_newebpay_subscription_history"',
  'COMMENT ON COLUMN "worklog_record_revisions"."previous_title"',
  'COMMENT ON COLUMN "worklog_record_revisions"."new_title"',
  'COMMENT ON COLUMN "worklog_checkout_intents"."payer_email"',
]) {
  if (!baseline.includes(marker)) failures.push(`baseline missing: ${marker}`);
}

if (/CREATE\s+TYPE\s+[^;]+\s+AS\s+ENUM/i.test(baseline)) {
  failures.push('baseline must not create PostgreSQL ENUM types; domain validation belongs to the application layer');
}
if (/\bCHECK\s*\(/i.test(baseline)) {
  failures.push('baseline must not contain CHECK constraints; domain validation belongs to the application layer');
}

let journal;
if (!existsSync(journalPath)) failures.push('missing drizzle/meta/_journal.json');
else {
  try { journal = JSON.parse(readFileSync(journalPath, 'utf8')); }
  catch { failures.push('Drizzle journal is not valid JSON'); }
}

if (journal) {
  if (journal.dialect !== 'postgresql') failures.push('Drizzle journal dialect must be postgresql');
  if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
    failures.push('Drizzle journal must contain exactly one canonical baseline entry');
  } else {
    const entry = journal.entries[0];
    if (entry?.idx !== 0 || entry?.tag !== '0000_worklog_baseline') {
      failures.push('Drizzle journal baseline entry must be idx=0 and tag=0000_worklog_baseline');
    }
  }
}

if (failures.length > 0) {
  console.error('AFTERTRACE canonical database baseline is stale/inconsistent and deployment must stop.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('AFTERTRACE canonical single database baseline guard passed.');

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
