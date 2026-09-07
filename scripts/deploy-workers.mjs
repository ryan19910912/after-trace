import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environment = String(process.argv[2] ?? '').trim().toLowerCase();
const component = String(process.argv[3] ?? 'all').trim().toLowerCase();
const wranglerConfig = {
  api: resolve(root, 'apps/api/wrangler.toml'),
  web: resolve(root, 'apps/web/wrangler.toml'),
  admin: resolve(root, 'apps/admin/wrangler.toml'),
};

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

Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')));

const workerNames = {
  api: `after-trace-api-${environment}`,
  web: `after-trace-web-${environment}`,
  admin: `after-trace-admin-${environment}`,
};

const apiOrigin = requireOrigin('VITE_API_BASE_URL');
const webOrigin = requireOrigin('WEB_APP_URL');
const webAppOrigin = requireOrigin('WEB_APP_ORIGIN');
const adminOrigin = requireOrigin('ADMIN_WEB_ORIGIN');
assertEnvironmentHost(apiOrigin, workerNames.api);
assertEnvironmentHost(webOrigin, workerNames.web);
assertEnvironmentHost(adminOrigin, workerNames.admin);
if (webOrigin !== webAppOrigin) {
  fail(`WEB_APP_URL and WEB_APP_ORIGIN must be identical in .env.${environment}.`);
}

console.log(`AFTERTRACE manual deployment target: ${environment.toUpperCase()}`);
console.log(`API   : ${workerNames.api} -> ${apiOrigin}`);
console.log(`Web   : ${workerNames.web} -> ${webOrigin}`);
console.log(`Admin : ${workerNames.admin} -> ${adminOrigin}`);

if (component === 'all' || component === 'api') {
  const apiRuntimeBindings = requireApiRuntimeBindings();
  run('Apply database migrations', 'pnpm', ['--filter', '@aftertrace/api', 'db:deploy:migrate']);

  const secretsFile = resolve(
    tmpdir(),
    `aftertrace-${environment}-${process.pid}-${Date.now()}-worker-secrets.json`,
  );
  writeFileSync(secretsFile, `${JSON.stringify(apiRuntimeBindings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    runWrangler('Deploy API Worker + runtime bindings', wranglerConfig.api, [
      '--name', workerNames.api,
      '--secrets-file', secretsFile,
    ]);
  } finally {
    try { unlinkSync(secretsFile); } catch {}
  }

  await verifyApiDeployment(apiOrigin);
}

if (component === 'all' || component === 'web') {
  run('Build Web', 'pnpm', ['--filter', '@aftertrace/web', 'build']);
  runWrangler('Deploy Web Worker', wranglerConfig.web, ['--name', workerNames.web]);
}

if (component === 'all' || component === 'admin') {
  run('Build Admin', 'pnpm', ['--filter', '@aftertrace/admin', 'build']);
  runWrangler('Deploy Admin Worker', wranglerConfig.admin, ['--name', workerNames.admin]);
}

console.log('');
console.log(`AFTERTRACE ${environment.toUpperCase()} deployment completed.`);
if (component === 'all' || component === 'api') {
  console.log(`API runtime bindings were uploaded from .env.${environment} using a temporary Wrangler secrets file and the temporary file was deleted after deployment.`);
}

function requireApiRuntimeBindings() {
  const names = [
    'DATABASE_URL',
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'GEMINI_API_KEY',
    'WEB_APP_URL',
    'WEB_APP_ORIGIN',
    'WEB_AUTH_SECRET',
    'LINE_LOGIN_CHANNEL_ID',
    'LINE_LOGIN_CHANNEL_SECRET',
    'GOOGLE_LOGIN_CLIENT_ID',
    'GOOGLE_LOGIN_CLIENT_SECRET',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'ADMIN_SESSION_SECRET',
    'ADMIN_WEB_ORIGIN',
    'WEB_PUSH_PUBLIC_KEY',
    'WEB_PUSH_PRIVATE_KEY',
    'WEB_PUSH_SUBJECT',
  ];
  const values = {};
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (!value) fail(`${name} is required in .env.${environment} before API deployment.`);
    values[name] = value;
  }

  const appleNames = [
    'APPLE_LOGIN_CLIENT_ID',
    'APPLE_LOGIN_TEAM_ID',
    'APPLE_LOGIN_KEY_ID',
    'APPLE_LOGIN_PRIVATE_KEY_P8_BASE64',
  ];
  const configuredApple = appleNames.filter((name) => Boolean(process.env[name]?.trim()));
  if (configuredApple.length > 0 && configuredApple.length !== appleNames.length) {
    fail(`Apple Login is optional, but if enabled all of ${appleNames.join(', ')} must be set in .env.${environment}.`);
  }
  if (configuredApple.length === appleNames.length) {
    for (const name of appleNames) values[name] = process.env[name].trim();
  }

  if (values.WEB_AUTH_SECRET.length < 32) {
    fail(`WEB_AUTH_SECRET must be at least 32 characters in .env.${environment}.`);
  }
  if (values.ADMIN_PASSWORD.length < 8) {
    fail(`ADMIN_PASSWORD must be at least 8 characters in .env.${environment}.`);
  }
  if (values.ADMIN_SESSION_SECRET.length < 32) {
    fail(`ADMIN_SESSION_SECRET must be at least 32 characters in .env.${environment}.`);
  }
  return values;
}

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

async function verifyApiDeployment(origin) {
  console.log('');
  console.log('==> Verify API Worker liveness');
  let health;
  try {
    const response = await fetch(`${origin}/health`);
    health = await response.json();
    if (!response.ok || health?.status !== 'ok') {
      fail(`API /health failed: HTTP ${response.status} ${JSON.stringify(health)}`);
    }
  } catch (error) {
    fail(`API /health request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`API liveness: ${health.status}`);

  console.log('');
  console.log('==> Verify API Worker readiness');
  try {
    const response = await fetch(`${origin}/health/ready`);
    const body = await response.json();
    if (response.ok && body?.status === 'ready') {
      console.log('API readiness: ready');
      return;
    }
    const expectedBootstrapPending = response.status === 503
      && ['AI_RUNTIME_CONFIG_NOT_INITIALIZED', 'FREE_PLAN_NOT_INITIALIZED'].includes(body?.error);
    if (expectedBootstrapPending) {
      console.warn(`API is live; first-environment bootstrap is still pending: ${body.error}`);
      return;
    }
    fail(`API /health/ready failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AFTERTRACE deploy failed:')) throw error;
    fail(`API /health/ready request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runWrangler(label, configPath, args) {
  run(label, 'pnpm', [
    '--filter', '@aftertrace/api', 'exec', 'wrangler', 'deploy',
    '--config', configPath,
    ...args,
  ]);
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
  throw new Error(`AFTERTRACE deploy failed: ${message}`);
}
