import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environment = String(process.argv[2] ?? '').trim().toLowerCase();
const component = String(process.argv[3] ?? 'all').trim().toLowerCase();

if (!['dev', 'prod'].includes(environment)) {
  fail('usage: node scripts/deploy-workers.mjs <dev|prod> [all|api|web|admin]');
}
if (!['all', 'api', 'web', 'admin'].includes(component)) {
  fail('component must be one of: all, api, web, admin');
}

const envFile = resolve(root, `.env.${environment}`);
if (!existsSync(envFile)) {
  fail(`missing ${envFile}. Create .env.${environment} before deploying.`);
}

// The selected file is authoritative for deployment so stale shell variables from
// another environment cannot silently override dev/prod targets.
Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')));

const apiOrigin = requireOrigin('VITE_API_BASE_URL');
const webOrigin = requireOrigin('WEB_APP_URL');
const adminOrigin = requireOrigin('ADMIN_WEB_ORIGIN');
assertEnvironmentHost(apiOrigin, `after-trace-api${environment === 'dev' ? '-dev' : ''}`);
assertEnvironmentHost(webOrigin, `after-trace-web${environment === 'dev' ? '-dev' : ''}`);
assertEnvironmentHost(adminOrigin, `after-trace-admin${environment === 'dev' ? '-dev' : ''}`);

console.log(`AFTERTRACE manual deployment target: ${environment.toUpperCase()}`);
console.log(`API   : ${apiOrigin}`);
console.log(`Web   : ${webOrigin}`);
console.log(`Admin : ${adminOrigin}`);

if (component === 'all' || component === 'api') {
  if (!process.env.DATABASE_URL?.trim()) {
    fail(`DATABASE_URL is required in .env.${environment} before API deployment.`);
  }
  run('Apply database migrations', 'pnpm', ['--filter', '@aftertrace/api', 'db:deploy:migrate']);
  run('Deploy API Worker', 'pnpm', ['--filter', '@aftertrace/api', 'exec', 'wrangler', 'deploy', '--env', environment]);
}

if (component === 'all' || component === 'web') {
  run('Build Web', 'pnpm', ['--filter', '@aftertrace/web', 'build']);
  run('Deploy Web Worker', 'pnpm', ['--filter', '@aftertrace/web', 'exec', 'wrangler', 'deploy', '--env', environment]);
}

if (component === 'all' || component === 'admin') {
  run('Build Admin', 'pnpm', ['--filter', '@aftertrace/admin', 'build']);
  run('Deploy Admin Worker', 'pnpm', ['--filter', '@aftertrace/admin', 'exec', 'wrangler', 'deploy', '--env', environment]);
}

console.log('');
console.log(`AFTERTRACE ${environment.toUpperCase()} deployment completed.`);
console.log('Runtime Variables/Secrets are environment-specific Cloudflare Worker configuration and are not uploaded from the local env file by this command.');

function requireOrigin(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required in .env.${environment}.`);
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || !url.host
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      fail(`${name} must be an absolute HTTPS origin without path/query/hash.`);
    }
    return url.origin;
  } catch {
    fail(`${name} must be a valid absolute HTTPS origin.`);
  }
}

function assertEnvironmentHost(origin, expectedWorkerName) {
  const url = new URL(origin);
  if (!url.hostname.endsWith('.workers.dev')) return;
  const actualWorkerName = url.hostname.split('.')[0];
  if (actualWorkerName !== expectedWorkerName) {
    fail(`Environment mismatch: ${origin} points to ${actualWorkerName}, expected ${expectedWorkerName}.`);
  }
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
  console.error(`AFTERTRACE deploy failed: ${message}`);
  process.exit(1);
}
