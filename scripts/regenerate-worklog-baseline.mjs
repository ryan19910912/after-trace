import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDir = resolve(root, 'drizzle');
const metaDir = resolve(drizzleDir, 'meta');
const resetFlag = '--confirm-prelaunch-reset';

if (!process.argv.includes(resetFlag)) {
  console.error('Refusing to regenerate AFTERTRACE Drizzle baseline without explicit prelaunch-reset confirmation.');
  console.error(`Run: pnpm db:baseline:regenerate ${resetFlag}`);
  process.exit(2);
}

assertCurrentPrelaunchShape();

const backupRoot = mkdtempSync(join(tmpdir(), 'aftertrace-drizzle-backup-'));
const backupDir = resolve(backupRoot, 'drizzle');
cpSync(drizzleDir, backupDir, { recursive: true });

try {
  console.log('Regenerating the disposable prelaunch Drizzle baseline from apps/api/src/db/schema-all.ts...');
  rmSync(drizzleDir, { recursive: true, force: true });
  mkdirSync(drizzleDir, { recursive: true });

  run(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
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
  );

  run(
    process.execPath,
    [resolve(root, 'scripts/check-worklog-baseline.mjs')],
    'AFTERTRACE baseline guard',
  );

  console.log('Prelaunch baseline regenerated and guard passed.');
  console.log('Next: inspect the generated diff and apply it to a fresh disposable PostgreSQL database before any deployment.');
} catch (error) {
  rmSync(drizzleDir, { recursive: true, force: true });
  cpSync(backupDir, drizzleDir, { recursive: true });
  console.error('Baseline regeneration failed. The previous drizzle directory was restored in full.');
  throw error;
} finally {
  rmSync(backupRoot, { recursive: true, force: true });
}

function assertCurrentPrelaunchShape() {
  if (!existsSync(drizzleDir) || !existsSync(metaDir)) {
    fail('Expected the current prelaunch drizzle directory and meta directory to exist before regeneration.');
  }

  const rootEntries = readdirSync(drizzleDir).sort();
  const expectedRoot = ['0000_worklog_baseline.sql', 'meta'];
  if (!sameEntries(rootEntries, expectedRoot)) {
    fail(
      `Refusing to delete unexpected migration artifacts. Expected ${expectedRoot.join(', ')}; found ${rootEntries.join(', ') || '(empty)'}.`,
    );
  }

  const metaEntries = readdirSync(metaDir).sort();
  const expectedMeta = ['0000_snapshot.json', '_journal.json'];
  if (!sameEntries(metaEntries, expectedMeta)) {
    fail(
      `Refusing to delete unexpected Drizzle metadata. Expected ${expectedMeta.join(', ')}; found ${metaEntries.join(', ') || '(empty)'}.`,
    );
  }
}

function sameEntries(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function run(command, args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
