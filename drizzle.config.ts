import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const rootDir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(rootDir, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const drizzlePath = (...segments: string[]) => resolve(rootDir, ...segments).replaceAll('\\', '/');
const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  // schema-all.ts is the authoritative export surface. Keeping one entry prevents the
  // migration config from silently omitting newly split Source/Record/Grant/LINE
  // schema modules or retaining deleted legacy quota/bootstrap files.
  schema: drizzlePath('apps/api/src/db/schema-all.ts'),
  out: drizzlePath('drizzle'),
  dialect: 'postgresql',
  // `generate` / `export` only need the TypeScript schema. Do not force developers to
  // point schema generation at a real database. Commands that actually connect (for
  // example `migrate`) still fail closed in Drizzle Kit when DATABASE_URL is absent.
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
