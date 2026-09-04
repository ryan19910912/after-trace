import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, 'drizzle/0000_worklog_baseline.sql');
const snapshotPath = resolve(root, 'drizzle/meta/0000_snapshot.json');
const journalPath = resolve(root, 'drizzle/meta/_journal.json');

const sources = [
  ['baseline SQL', readFileSync(baselinePath, 'utf8')],
  ['Drizzle snapshot', readFileSync(snapshotPath, 'utf8')],
];
const journalText = readFileSync(journalPath, 'utf8');

const forbidden = [
  ['worklog_customers', 'legacy Customer table'],
  ['worklog_projects', 'legacy Project table'],
  ['worklog_project_status', 'legacy Project enum'],
  ['worklog_record_category', 'legacy Record category enum'],
  ['worklog_transaction_type', 'legacy Transaction enum'],
  ['worklog_transactions', 'legacy Transaction table'],
  ['ai_units_consumed', 'retired aggregate AI usage column'],
  ['worklog_ai_reservation_status', 'retired pre-Grant reservation enum'],
  ['subscription_owner_user_id', 'retired subscription Owner binding'],
  ['recording_enabled', 'retired GROUP recording preference'],
];

const required = [
  ['worklog_entities', 'single-title Entity table'],
  ['worklog_entity_aliases', 'Entity Alias table'],
  ['worklog_record_revisions', 'immutable Record Revision table'],
  ['worklog_ai_confirmations', 'durable Pending Confirmation table'],
  ['worklog_ai_grants', 'user-owned AI Grant table'],
  ['worklog_ai_grant_scopes', 'Grant Source scope table'],
  ['worklog_ai_point_reservations', 'Grant-backed AI point reservation table'],
  ['worklog_ai_usage_funding', 'exact usage-to-Grant funding attribution'],
  ['worklog_source_ai_responsibility', 'GROUP AI responsibility table'],
  ['customer_points_charged', 'customer point charge fact'],
  ['platform_subsidized_points', 'platform subsidy fact'],
  ['worklog_line_ai_edits', 'durable Reply-targeted LINE edit state'],
];

const failures = [];
for (const [sourceName, source] of sources) {
  for (const [marker, description] of forbidden) {
    if (source.includes(marker)) failures.push(`${sourceName} forbidden: ${marker} (${description})`);
  }
  for (const [marker, description] of required) {
    if (!source.includes(marker)) failures.push(`${sourceName} missing: ${marker} (${description})`);
  }
}

let journal;
try {
  journal = JSON.parse(journalText);
} catch {
  failures.push('Drizzle journal is not valid JSON');
}
if (journal) {
  if (journal.dialect !== 'postgresql') failures.push('Drizzle journal dialect must be postgresql');
  if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
    failures.push('prelaunch Drizzle journal must contain exactly one regenerated baseline entry');
  } else {
    const entry = journal.entries[0];
    if (entry?.idx !== 0 || entry?.tag !== '0000_worklog_baseline') {
      failures.push('Drizzle journal baseline entry must be idx=0 and tag=0000_worklog_baseline');
    }
  }
}

if (failures.length > 0) {
  console.error('AFTERTRACE migration baseline is stale/inconsistent and deployment must stop.');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Regenerate drizzle/0000_worklog_baseline.sql + meta snapshot/journal together from apps/api/src/db/schema-all.ts, then apply them to a fresh disposable PostgreSQL database before deployment.');
  process.exit(1);
}

console.log('AFTERTRACE Worklog baseline + Drizzle metadata guard passed.');
