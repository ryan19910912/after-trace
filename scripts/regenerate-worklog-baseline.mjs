import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDir = resolve(root, 'drizzle');
const baselinePath = resolve(drizzleDir, '0000_worklog_baseline.sql');
const snapshotPath = resolve(drizzleDir, 'meta/0000_snapshot.json');
const journalPath = resolve(drizzleDir, 'meta/_journal.json');
const resetFlag = '--confirm-prelaunch-reset';

if (!process.argv.includes(resetFlag)) {
  console.error('Refusing to regenerate AFTERTRACE Drizzle baseline without explicit prelaunch-reset confirmation.');
  console.error(`Run: pnpm db:baseline:regenerate ${resetFlag}`);
  process.exit(2);
}

if (!process.env.DATABASE_URL && !existsSync(resolve(root, '.env'))) {
  console.error('DATABASE_URL (or a root .env containing it) is required because drizzle.config.ts fails closed without DB configuration.');
  process.exit(2);
}

const managedFiles = [baselinePath, snapshotPath, journalPath];
const backup = new Map();
for (const path of managedFiles) {
  if (existsSync(path)) backup.set(path, readFileSync(path));
}

function restoreBackup() {
  rmSync(drizzleDir, { recursive: true, force: true });
  for (const [path, bytes] of backup.entries()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}

console.log('Regenerating the disposable prelaunch Drizzle baseline from apps/api/src/db/schema-all.ts...');
rmSync(drizzleDir, { recursive: true, force: true });

const generate = spawnSync(
  'pnpm',
  ['--filter', '@aftertrace/api', 'exec', 'drizzle-kit', 'generate', '--config=../../drizzle.config.ts', '--name=worklog_baseline'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);

if (generate.status !== 0) {
  console.error('Drizzle generation failed; restoring the previous checked-in artifacts.');
  restoreBackup();
  process.exit(generate.status ?? 1);
}

if (!existsSync(baselinePath) || !existsSync(snapshotPath) || !existsSync(journalPath)) {
  console.error('Drizzle generation did not produce the expected 0000 baseline/snapshot/journal; restoring previous artifacts.');
  restoreBackup();
  process.exit(1);
}

const guard = spawnSync('node', ['scripts/check-worklog-baseline.mjs'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (guard.status !== 0) {
  console.error('Generated artifacts failed the AFTERTRACE baseline guard. They are left in place for inspection, but deployment remains blocked.');
  process.exit(guard.status ?? 1);
}

console.log('Prelaunch baseline regenerated and guard passed. Next: apply it to a fresh disposable PostgreSQL database before any deployment.');
