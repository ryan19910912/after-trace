import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const envPath = resolve(repoRoot, '.env');

if (!process.env.DATABASE_URL && existsSync(envPath)) {
  loadEnvFile(envPath);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for deploy migrations');
}

const sql = neon(databaseUrl);

await sql`
  CREATE TABLE IF NOT EXISTS web_auth_entry_nonces (
    nonce varchar(128) PRIMARY KEY,
    line_user_id varchar(64) NOT NULL,
    line_group_id varchar(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS web_auth_entry_expiry_idx
  ON web_auth_entry_nonces (expires_at)
`;

console.log('Deploy migrations: web_auth_entry_nonces ready');
