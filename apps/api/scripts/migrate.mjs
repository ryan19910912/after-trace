import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  // Disposable Dev databases may have had public dropped during reset.
  await sql`CREATE SCHEMA IF NOT EXISTS public`;

  // Neon HTTP executes prepared statements and rejects multiple SQL commands in one statement.
  // Keep the repository at one canonical 0000 migration, but create a same-volume temporary
  // Drizzle folder whose baseline has a breakpoint after every SQL statement.
  normalizedMigrationsFolder = resolve(
    root,
    `.aftertrace-drizzle-migrate-${process.pid}-${Date.now()}`,
  );
  mkdirSync(normalizedMigrationsFolder, { recursive: true });
  cpSync(
    resolve(migrationsFolder, '0000_worklog_baseline.sql'),
    resolve(normalizedMigrationsFolder, '0000_worklog_baseline.sql'),
  );
  cpSync(resolve(migrationsFolder, 'meta'), resolve(normalizedMigrationsFolder, 'meta'), {
    recursive: true,
  });
  normalizeSingleFileBaseline(normalizedMigrationsFolder);

  await migrate(db, { migrationsFolder: normalizedMigrationsFolder });
  console.log('AFTERTRACE database migrations applied successfully.');
} catch (error) {
  console.error('AFTERTRACE database migration failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  if (normalizedMigrationsFolder) {
    rmSync(normalizedMigrationsFolder, { recursive: true, force: true });
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
      // Drizzle breakpoint markers are metadata, not SQL comments we need to execute.
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
