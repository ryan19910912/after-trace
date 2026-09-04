import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, 'drizzle/0000_worklog_baseline.sql');
const baseline = readFileSync(baselinePath, 'utf8');

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
  ['worklog_line_record_edits', 'durable Reply-targeted LINE edit state'],
];

const failures = [];
for (const [marker, description] of forbidden) {
  if (baseline.includes(marker)) failures.push(`forbidden: ${marker} (${description})`);
}
for (const [marker, description] of required) {
  if (!baseline.includes(marker)) failures.push(`missing: ${marker} (${description})`);
}

if (failures.length > 0) {
  console.error('AFTERTRACE migration baseline is stale and deployment must stop.');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Regenerate drizzle/0000_worklog_baseline.sql + meta snapshot/journal from apps/api/src/db/schema-all.ts, then apply it to a fresh disposable PostgreSQL database before deployment.');
  process.exit(1);
}

console.log('AFTERTRACE Worklog baseline guard passed.');
