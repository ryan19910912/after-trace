import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDir = resolve(root, 'drizzle');
const metaDir = resolve(drizzleDir, 'meta');
const journalPath = resolve(metaDir, '_journal.json');
const baselinePath = resolve(drizzleDir, '0000_worklog_baseline.sql');
const commentsPath = resolve(drizzleDir, '0002_worklog_schema_comments.sql');
const resetFlag = '--confirm-prelaunch-reset';

if (!process.argv.includes(resetFlag)) {
  console.error('Refusing to regenerate AFTERTRACE Drizzle baseline without explicit prelaunch-reset confirmation.');
  console.error(`Run: pnpm db:baseline:regenerate ${resetFlag}`);
  process.exit(2);
}

assertCurrentPrelaunchShape();
const existingBaselineWhen = readExistingBaselineWhen();
const preservedComments = existsSync(commentsPath) ? readFileSync(commentsPath, 'utf8').trim() : '';

// Dev and prelaunch Prod are disposable. Rebuild one canonical migration from the current
// Drizzle schema instead of keeping transitional 0001/0002/0003 migrations around.
const backupDir = resolve(root, `.aftertrace-drizzle-backup-${process.pid}-${Date.now()}`);
if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
renameSync(drizzleDir, backupDir);
mkdirSync(drizzleDir, { recursive: true });

try {
  console.log('Regenerating the canonical fresh-database Drizzle baseline from apps/api/src/db/schema-all.ts...');

  try {
    run(
      'pnpm',
      [
        '--filter',
        '@aftertrace/api',
        'exec',
        'drizzle-kit',
        'generate',
        '--config=../../drizzle.config.ts',
        '--name=worklog_baseline',
      ],
      'Drizzle baseline generation',
      process.platform === 'win32',
    );
    preserveBaselineMigrationIdentity(existingBaselineWhen);
    appendSchemaComments(preservedComments);
  } catch (error) {
    rmSync(drizzleDir, { recursive: true, force: true });
    renameSync(backupDir, drizzleDir);
    console.error('Baseline generation failed. The previous drizzle directory was restored in full.');
    throw error;
  }

  run(process.execPath, [resolve(root, 'scripts/check-worklog-baseline.mjs')], 'AFTERTRACE baseline guard');

  console.log('Prelaunch baseline regenerated and guard passed.');
  console.log('The drizzle directory now contains one canonical 0000 migration plus metadata only.');
  console.log('Rebuild disposable Dev/Prod-prelaunch databases from this 0000 baseline.');
} finally {
  if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
}

function readExistingBaselineWhen() {
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    fail('Existing Drizzle journal is unreadable; refusing to regenerate baseline identity.');
  }

  const entry = journal?.entries?.[0];
  if (!entry || entry.idx !== 0 || entry.tag !== '0000_worklog_baseline' || !Number.isFinite(entry.when)) {
    fail('Existing Drizzle journal does not contain a valid 0000_worklog_baseline identity.');
  }
  return entry.when;
}

function preserveBaselineMigrationIdentity(existingWhen) {
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    throw new Error('Generated Drizzle journal is unreadable.');
  }

  if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
    throw new Error('Generated Drizzle journal must contain exactly one baseline entry.');
  }

  const entry = journal.entries[0];
  if (entry?.idx !== 0 || entry?.tag !== '0000_worklog_baseline') {
    throw new Error('Generated Drizzle journal baseline identity is unexpected.');
  }

  entry.when = existingWhen;
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  console.log(`Preserved 0000_worklog_baseline migration timestamp: ${existingWhen}`);
}

function appendSchemaComments(comments) {
  if (!comments) {
    console.warn('No existing schema comments migration found; generated baseline will contain no COMMENT ON statements.');
    return;
  }
  if (!existsSync(baselinePath)) throw new Error('Generated 0000_worklog_baseline.sql is missing.');
  const baseline = readFileSync(baselinePath, 'utf8').trimEnd();
  writeFileSync(
    baselinePath,
    `${baseline}\n--> statement-breakpoint\n${comments}\n`,
    'utf8',
  );
  console.log('Merged schema/table/column comments into 0000_worklog_baseline.sql.');
}

function assertCurrentPrelaunchShape() {
  if (!existsSync(drizzleDir) || !existsSync(metaDir)) {
    fail('Expected the current prelaunch drizzle directory and meta directory to exist before regeneration.');
  }

  const rootEntries = readdirSync(drizzleDir).sort();
  const sqlEntries = rootEntries.filter((entry) => /^\d{4}_.+\.sql$/.test(entry));
  const unexpected = rootEntries.filter((entry) => entry !== 'meta' && !/^\d{4}_.+\.sql$/.test(entry));
  if (!sqlEntries.includes('0000_worklog_baseline.sql') || unexpected.length > 0) {
    fail(`Unexpected prelaunch drizzle contents: ${rootEntries.join(', ') || '(empty)'}.`);
  }

  const metaEntries = readdirSync(metaDir).sort();
  const expectedMeta = ['0000_snapshot.json', '_journal.json'];
  if (!sameEntries(metaEntries, expectedMeta)) {
    fail(`Unexpected drizzle/meta contents. Expected ${expectedMeta.join(', ')}; found ${metaEntries.join(', ') || '(empty)'}.`);
  }
}

function sameEntries(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function run(command, args, label, shell = false) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
