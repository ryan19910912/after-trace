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
const warnings = [];

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
  ['worklog_ai_quota', 'retired aggregate AI quota schema/table marker'],
  ['subscription_owner_user_id', 'retired subscription Owner binding'],
  ['recording_enabled', 'retired GROUP recording preference'],
  ['subscription_period_points', 'retired subscription-only plan point template column'],
];

// Accepted V1 release baseline. These markers intentionally follow the provider-neutral
// Web/PWA + native group + task/notification + FREE-trial/AI-Pro + NewebPay target rather
// than the retired LINE GROUP funding product.
const required = [
  ['worklog_auth_provider', 'Google/LINE/Apple provider-neutral auth enum'],
  ['worklog_auth_identities', 'provider-neutral login identity bindings'],
  ['worklog_user_public_accounts', 'opaque customer-facing account id'],
  ['worklog_source_invites', 'AFTERTRACE-native group invite tokens'],
  ['worklog_record_revisions', 'immutable Record revision history'],
  ['worklog_ai_grants', 'user-owned AI Grant table'],
  ['worklog_ai_grant_scopes', 'Grant Source scope table'],
  ['worklog_ai_point_reservations', 'Grant-backed AI point reservation table'],
  ['worklog_ai_usage_funding', 'exact usage-to-Grant funding attribution'],
  ['provider_cost_committed_twd', 'subscription-period committed provider-cost counter'],
  ['provider_cost_reserved_twd', 'subscription-period concurrent provider-cost hold counter'],
  ['provider_cost_hold_twd', 'per-reservation provider-cost hold'],
  ['worklog_commercial_config', 'operator commercial singleton'],
  ['free_initial_ai_trial_points', 'Admin-configured one-time FREE AI trial quantity'],
  ['worklog_notifications', 'durable ANNOUNCEMENT/SYSTEM/TASK notification table'],
  ['worklog_notification_recipients', 'durable per-user notification/read state'],
  ['worklog_push_subscriptions', 'Web Push subscriptions'],
  ['worklog_notification_preferences', 'user Push preferences'],
  ['worklog_tasks', 'user-confirmed task/reminder table'],
  ['worklog_checkout_intents', 'bounded paid checkout intent table'],
  ['worklog_subscription_lifecycle_events', 'provider-neutral idempotent subscription lifecycle inbox'],
  ['worklog_feedback', 'durable in-product feedback'],
  ['worklog_feedback_management', 'Admin feedback category/status workflow'],
  ['worklog_newebpay_subscriptions', 'NewebPay adapter state'],
  ['customer_points_charged', 'customer point charge fact'],
  ['platform_subsidized_points', 'platform subsidy fact'],
  ['worklog_ai_point_reservation_funding_grant_scope_fk', 'reservation funding scope belongs to Grant'],
  ['worklog_ai_usage_funding_grant_scope_fk', 'usage funding scope belongs to Grant'],
];

// These are known migration residue. They are no longer V1 requirements, but remain in
// source until executable dependency validation proves they can be physically removed.
// Make their presence visible without letting the old product contract define readiness.
const migrationResidue = [
  ['worklog_source_ai_responsibility', 'retired GROUP AI responsible-user schema'],
  ["'ONE_TIME'", 'retired one-time paid plan enum value'],
  ["'TOP_UP'", 'retired AI top-up Grant type'],
  ['worklog_line_ai_edits', 'retired LINE AI edit state'],
  ['web_auth_entry_nonces', 'legacy LINE GROUP Web-entry nonce'],
];

for (const [sourceName, source] of sources) {
  for (const [marker, description] of forbidden) {
    if (source.includes(marker)) failures.push(`${sourceName} forbidden: ${marker} (${description})`);
  }
  for (const [marker, description] of required) {
    if (!source.includes(marker)) failures.push(`${sourceName} missing: ${marker} (${description})`);
  }
  for (const [marker, description] of migrationResidue) {
    if (source.includes(marker)) warnings.push(`${sourceName} migration residue: ${marker} (${description})`);
  }
}

let journal;
if (journalText !== null) {
  try { journal = JSON.parse(journalText); }
  catch { failures.push('Drizzle journal is not valid JSON'); }
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

if (warnings.length > 0) {
  console.warn('AFTERTRACE baseline still contains known migration residue (allowed until executable dependency cleanup):');
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length > 0) {
  console.error('AFTERTRACE migration baseline is stale/inconsistent and deployment must stop.');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Regenerate drizzle/0000_worklog_baseline.sql + meta snapshot/journal together from apps/api/src/db/schema-all.ts, then apply them to a fresh disposable PostgreSQL database before deployment.');
  process.exit(1);
}

console.log('AFTERTRACE V1 target baseline + Drizzle metadata guard passed.');

function checkArtifactShape() {
  if (!existsSync(drizzleDir)) { failures.push('missing drizzle directory'); return; }
  const rootEntries = readdirSync(drizzleDir).sort();
  const expectedRoot = ['0000_worklog_baseline.sql', 'meta'];
  if (!sameEntries(rootEntries, expectedRoot)) failures.push(`prelaunch drizzle directory must contain exactly ${expectedRoot.join(', ')}; found ${rootEntries.join(', ') || '(empty)'}`);
  if (!existsSync(metaDir)) { failures.push('missing drizzle/meta directory'); return; }
  const metaEntries = readdirSync(metaDir).sort();
  const expectedMeta = ['0000_snapshot.json', '_journal.json'];
  if (!sameEntries(metaEntries, expectedMeta)) failures.push(`prelaunch drizzle/meta must contain exactly ${expectedMeta.join(', ')}; found ${metaEntries.join(', ') || '(empty)'}`);
}

function sameEntries(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
