import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const expectedPackageManager = String(packageJson.packageManager ?? '');
const expectedPnpmVersion = /^pnpm@(.+)$/.exec(expectedPackageManager)?.[1] ?? null;

const requiredFiles = [
  'pnpm-lock.yaml',
  'drizzle/0000_worklog_baseline.sql',
  'drizzle/meta/0000_snapshot.json',
  'drizzle/meta/_journal.json',
  'apps/api/wrangler.toml',
  'apps/web/wrangler.toml',
  'apps/admin/wrangler.toml',
];
for (const relative of requiredFiles) {
  if (!existsSync(resolve(root, relative))) fail(`missing required release artifact: ${relative}`);
}

if (!expectedPnpmVersion) {
  fail(`package.json must pin pnpm via packageManager; found ${expectedPackageManager || '(missing)'}`);
}
const pnpmVersion = commandOutput('pnpm', ['--version']);
if (pnpmVersion !== expectedPnpmVersion) {
  fail(`pnpm version mismatch: package.json requires ${expectedPnpmVersion}, current executable is ${pnpmVersion || '(unknown)'}`);
}

console.log(`AFTERTRACE release preflight using pnpm@${pnpmVersion}`);

run('Baseline / migration guard', 'node', ['scripts/check-worklog-baseline.mjs']);
run('TypeScript typecheck', 'pnpm', ['typecheck']);
run('ESLint', 'pnpm', ['lint']);
run('Vitest', 'pnpm', ['test']);
run('Worker/Web/Admin production builds', 'pnpm', ['build']);
run('Drizzle schema export', 'pnpm', ['db:schema:check']);

console.log('');
console.log('AFTERTRACE local release preflight passed.');
console.log('This does NOT apply database migrations, deploy Workers, or replace browser/LINE/Gemini runtime smoke checks.');

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  return String(result.stdout ?? '').trim();
}

function run(label, command, args) {
  console.log('');
  console.log(`==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? 'unknown'}`);
}

function fail(message) {
  console.error(`AFTERTRACE release preflight failed: ${message}`);
  process.exit(1);
}
