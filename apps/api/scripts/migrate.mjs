import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const localEnvPath = resolve(root, '.env.local');
const fallbackEnvPath = resolve(root, '.env');

if (!process.env.DATABASE_URL) {
  if (existsSync(localEnvPath)) loadEnvFile(localEnvPath);
  else if (existsSync(fallbackEnvPath)) loadEnvFile(fallbackEnvPath);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required for migration.');
  process.exit(2);
}

const migrationsFolder = resolve(root, 'drizzle');
const sql = neon(databaseUrl);
const db = drizzle(sql);

try {
  // A disposable Dev database may have had the public schema dropped during reset.
  // Recreate it before Drizzle runs unqualified CREATE TABLE statements.
  await sql`CREATE SCHEMA IF NOT EXISTS public`;

  await migrate(db, { migrationsFolder });
  console.log('AFTERTRACE database migrations applied successfully.');
} catch (error) {
  console.error('AFTERTRACE database migration failed.');
  console.error(error);
  process.exit(1);
}
