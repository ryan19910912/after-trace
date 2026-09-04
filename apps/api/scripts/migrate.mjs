import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required for migration.');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../drizzle');

const sql = neon(databaseUrl);
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder });
  console.log('AFTERTRACE database migrations applied successfully.');
} catch (error) {
  console.error('AFTERTRACE database migration failed.');
  console.error(error);
  process.exit(1);
}
