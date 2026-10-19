import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv();

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

const apiOrigin = productionApiOrigin(process.env.VITE_API_BASE_URL);
if (!apiOrigin) {
  fail('VITE_API_BASE_URL must be the actual absolute https API Worker origin before release preflight');
}
process.env.VITE_API_BASE_URL = apiOrigin;

console.log(`AFTERTRACE release preflight using pnpm@${pnpmVersion}`);
console.log(`Frontend production API origin: ${apiOrigin}`);

run('Baseline / migration guard', 'node', ['scripts/check-worklog-baseline.mjs']);
run('TypeScript typecheck', 'pnpm', ['typecheck']);
run('ESLint', 'pnpm', ['lint']);
run('Vitest', 'pnpm', ['test']);
run('Worker/Web/Admin production builds', 'pnpm', ['build']);
run('Drizzle schema export', 'pnpm', ['db:schema:check']);

console.log('');
console.log('AFTERTRACE local release preflight passed.');
console.log('This does NOT apply database migrations, deploy Workers, or replace browser/LINE/Gemini runtime smoke checks.');

function loadLocalEnv() {
  // Keep the same root environment convention as local API/Drizzle tooling. Explicit
  // process environment values win because loadEnvFile does not overwrite them.
  const local = resolve(root, '.env.local');
  const fallback = resolve(root, '.env');
  if (existsSync(local)) loadEnvFile(local);
  else if (existsSync(fallback)) loadEnvFile(fallback);
}

function productionApiOrigin(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:'
      || !url.host
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

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
