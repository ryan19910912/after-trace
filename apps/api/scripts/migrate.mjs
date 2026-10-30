import { accessSeedStatements,saveBootstrapPassword } from '../../../scripts/admin-access-seed.mjs';
import { promptSeedStatements } from '../../../scripts/local-prompt-seed.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  await sql`CREATE SCHEMA IF NOT EXISTS public`;

  normalizedMigrationsFolder = resolve(
    root,
    `.aftertrace-drizzle-migrate-${process.pid}-${Date.now()}`,
  );
  mkdirSync(normalizedMigrationsFolder, { recursive: true });
  for (const file of readdirSync(migrationsFolder).filter(name=>name.endsWith('.sql'))) {
    cpSync(resolve(migrationsFolder,file),resolve(normalizedMigrationsFolder,file));
  }
  cpSync(resolve(migrationsFolder, 'meta'), resolve(normalizedMigrationsFolder, 'meta'), {
    recursive: true,
  });
  normalizeSingleFileBaseline(normalizedMigrationsFolder);

  await migrate(db, { migrationsFolder: normalizedMigrationsFolder });
  await verifyCanonicalSchemaExists();
  const promptSeeds = JSON.parse(readFileSync(resolve(root, 'config/local-ai-prompts.seed.json'), 'utf8'));
  for (const statement of promptSeedStatements(promptSeeds)) await sql.query(statement);
  const receipt = process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE || resolve(root,'.test-artifacts/admin-bootstrap.json');
  const existingAdmin = await sql`SELECT id FROM worklog_admin_accounts WHERE username='admin'`;
  if (!existingAdmin.length && existsSync(receipt)) throw new Error('Bootstrap receipt already exists; choose an unused ADMIN_BOOTSTRAP_PASSWORD_FILE.');
  const accessSeed = accessSeedStatements(root,process.env.ADMIN_PASSWORD_PEPPER);
  for (const [index,statement] of accessSeed.statements.entries()) { const result=await sql.query(statement); if(index===1&&result.length) { mkdirSync(dirname(receipt),{recursive:true}); saveBootstrapPassword(receipt,accessSeed.password); } }
  console.log('AFTERTRACE database migrations and missing defaults applied successfully.');
} catch (error) {
  console.error('AFTERTRACE database migration failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  if (normalizedMigrationsFolder) {
    rmSync(normalizedMigrationsFolder, { recursive: true, force: true });
  }
}

async function verifyCanonicalSchemaExists() {
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'worklog_users',
        'worklog_records',
        'worklog_record_revisions',
        'worklog_subscription_plans',
        'worklog_commercial_config',
        'worklog_error_summaries',
        'worklog_error_occurrences',
        'worklog_error_rate_limits'
      )
  `;
  const found = new Set(rows.map((row) => String(row.table_name)));
  const required = [
    'worklog_users',
    'worklog_records',
    'worklog_record_revisions',
    'worklog_subscription_plans',
    'worklog_commercial_config',
        'worklog_error_summaries',
        'worklog_error_occurrences',
        'worklog_error_rate_limits',
  ];
  const missing = required.filter((table) => !found.has(table));
  if (missing.length > 0) {
    throw new Error(`Canonical schema verification failed. Missing public tables: ${missing.join(', ')}`);
  }
}

function normalizeSingleFileBaseline(folder) {
  const baselinePath = resolve(folder, '0000_worklog_baseline.sql');
  if (!existsSync(baselinePath)) throw new Error('Missing drizzle/0000_worklog_baseline.sql');

  const source = readFileSync(baselinePath, 'utf8');
  const statements = splitSqlStatements(source);
  if (statements.length === 0) throw new Error('Canonical baseline contains no SQL statements');

  writeFileSync(
    baselinePath,
    `${statements.join('\n--> statement-breakpoint\n')}\n`,
    'utf8',
  );
}

function splitSqlStatements(source) {
  const statements = [];
  let current = '';
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      current += char;
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === '-' && next === '-') {
      const remainder = source.slice(index);
      const marker = /^-->\s*statement-breakpoint\s*(?:\r?\n|$)/.exec(remainder);
      if (marker) {
        index += marker[0].length - 1;
        continue;
      }
      lineComment = true;
      current += char;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === '/' && next === '*') {
      blockComment = true;
      current += char;
      continue;
    }

    if (!doubleQuoted && char === "'") {
      current += char;
      if (singleQuoted && next === "'") {
        current += next;
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }

    if (!singleQuoted && char === '"') {
      current += char;
      if (doubleQuoted && next === '"') {
        current += next;
        index += 1;
      } else {
        doubleQuoted = !doubleQuoted;
      }
      continue;
    }

    current += char;
    if (!singleQuoted && !doubleQuoted && char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
