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

const sources = [];
if (existsSync(baselinePath)) sources.push(['baseline SQL', readFileSync(baselinePath, 'utf8')]);
else failures.push('missing drizzle/0000_worklog_baseline.sql');
if (existsSync(snapshotPath)) sources.push(['Drizzle snapshot', readFileSync(snapshotPath, 'utf8')]);
else failures.push('missing drizzle/meta/0000_snapshot.json');
const journalText = existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : null;
if (journalText === null) failures.push('missing drizzle/meta/_journal.json');

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
  ['worklog_entity_alias_source_entity_fk', 'Alias cannot point at an Entity from another Source'],
  ['worklog_record_source_entity_fk', 'Record title Entity must belong to the same Source'],
  ['worklog_ai_confirmation_source_record_fk', 'Pending Confirmation Record must belong to the same Source'],
  ['worklog_ai_confirmation_source_entity_fk', 'Pending Confirmation candidate Entity must belong to the same Source'],
  ['worklog_line_ai_edit_source_record_fk', 'LINE AI edit target Record must belong to the same Source'],
  ['worklog_line_ai_edit_source_confirmation_fk', 'LINE AI edit confirmation must belong to the same Source'],
  ['worklog_line_ai_edit_source_entity_fk', 'LINE AI edit applied Entity must belong to the same Source'],
  ['worklog_ai_point_reservation_funding_grant_scope_fk', 'reservation funding scope must belong to the same Grant'],
  ['worklog_ai_usage_funding_grant_scope_fk', 'usage funding scope must belong to the same Grant'],
];

for (const [sourceName, source] of sources) {
  for (const [marker, description] of forbidden) {
    if (source.includes(marker)) failures.push(`${sourceName} forbidden: ${marker} (${description})`);
  }
  for (const [marker, description] of required) {
    if (!source.includes(marker)) failures.push(`${sourceName} missing: ${marker} (${description})`);
  }
}

let journal;
if (journalText !== null) {
  try {
    journal = JSON.parse(journalText);
  } catch {
    failures.push('Drizzle journal is not valid JSON');
  }
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

function checkArtifactShape() {
  if (!existsSync(drizzleDir)) {
    failures.push('missing drizzle directory');
    return;
  }

  const rootEntries = readdirSync(drizzleDir).sort();
  const expectedRoot = ['0000_worklog_baseline.sql', 'meta'];
  if (!sameEntries(rootEntries, expectedRoot)) {
    failures.push(
      `prelaunch drizzle directory must contain exactly ${expectedRoot.join(', ')}; found ${rootEntries.join(', ') || '(empty)'}`,
    );
  }

  if (!existsSync(metaDir)) {
    failures.push('missing drizzle/meta directory');
    return;
  }
  const metaEntries = readdirSync(metaDir).sort();
  const expectedMeta = ['0000_snapshot.json', '_journal.json'];
  if (!sameEntries(metaEntries, expectedMeta)) {
    failures.push(
      `prelaunch drizzle/meta must contain exactly ${expectedMeta.join(', ')}; found ${metaEntries.join(', ') || '(empty)'}`,
    );
  }
}

function sameEntries(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
