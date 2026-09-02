import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, '..');
const rootEnvPath = resolve(apiDir, '../..', '.env.local');
const wranglerCliPath = resolve(apiDir, 'node_modules/wrangler/bin/wrangler.js');

if (!existsSync(rootEnvPath)) {
  console.error(`Missing root .env.local: ${rootEnvPath}`);
  console.error('Copy .env.example to .env.local and fill in local values.');
  process.exit(1);
}

if (!existsSync(wranglerCliPath)) {
  console.error(`Missing Wrangler CLI: ${wranglerCliPath}`);
  console.error('Run pnpm install from the repository root first.');
  process.exit(1);
}

loadEnvFile(rootEnvPath);

// Wrangler normally loads .env/.dev.vars next to wrangler.toml. AFTERTRACE keeps one
// local source of truth at the repository root, so expose that loaded process env to
// the local Worker bindings instead of maintaining a second apps/api/.dev.vars file.
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true';

// Invoke Wrangler through Node directly instead of spawning wrangler.cmd. The latter
// can fail with spawnSync EINVAL on Windows depending on the Node/shell combination.
const result = spawnSync(process.execPath, [wranglerCliPath, 'dev'], {
  cwd: apiDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
