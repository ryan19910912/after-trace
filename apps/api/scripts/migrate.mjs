import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
let normalizedMigrationsFolder;

try {
  // A disposable Dev database may have had the public schema dropped during reset.
  // Recreate it before Drizzle runs unqualified CREATE TABLE statements.
  await sql`CREATE SCHEMA IF NOT EXISTS public`;

  // Neon HTTP executes prepared statements and rejects multiple SQL commands in one statement.
  // AFTERTRACE intentionally keeps one canonical prelaunch SQL migration, so normalize that
  // file into Drizzle statement breakpoints in a temporary copy before executing it.
  normalizedMigrationsFolder = mkdtempSync(resolve(tmpdir(), 'aftertrace-drizzle-'));
  cpSync(migrationsFolder, normalizedMigrationsFolder, { recursive: true });
  normalizeSingleFileBaseline(normalizedMigrationsFolder);

  await migrate(db, { migrationsFolder: normalizedMigrationsFolder });
  console.log('AFTERTRACE database migrations applied successfully.');
} catch (error) {
  console.error('AFTERTRACE database migration failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  if (normalizedMigrationsFolder) rmSync(normalizedMigrationsFolder, { recursive: true, force: true });
}

function normalizeSingleFileBaseline(folder) {
  const baselinePath = resolve(folder, '0000_worklog_baseline.sql');
  if (!existsSync(baselinePath)) throw new Error('Missing drizzle/0000_worklog_baseline.sql');

  const source = readFileSync(baselinePath, 'utf8')
    .replace(/^\s*--> statement-breakpoint\s*$/gm, '')
    .replace(/;\s*(?=\r?\n|$)/g, ';\n--> statement-breakpoint\n');

  writeFileSync(baselinePath, source, 'utf8');
}
