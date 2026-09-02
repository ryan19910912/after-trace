import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, '..');
const rootEnvPath = resolve(apiDir, '../..', '.env.local');

if (!existsSync(rootEnvPath)) {
  console.error(`Missing root .env.local: ${rootEnvPath}`);
  console.error('Copy .env.example to .env.local and fill in local values.');
  process.exit(1);
}

loadEnvFile(rootEnvPath);

// Wrangler normally loads .env/.dev.vars next to wrangler.toml. AFTERTRACE keeps one
// local source of truth at the repository root, so expose that loaded process env to
// the local Worker bindings instead of maintaining a second apps/api/.dev.vars file.
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true';

const wranglerCommand = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
const result = spawnSync(wranglerCommand, ['dev'], {
  cwd: apiDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
