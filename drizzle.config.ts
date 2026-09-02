import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const rootDir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(rootDir, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Drizzle Kit');
}

const drizzlePath = (...segments: string[]) => resolve(rootDir, ...segments).replaceAll('\\', '/');

export default defineConfig({
  schema: [
    drizzlePath('apps/api/src/db/schema.ts'),
    drizzlePath('apps/api/src/db/schema-round5.ts'),
    drizzlePath('apps/api/src/db/schema-round6.ts'),
    drizzlePath('apps/api/src/db/schema-round8.ts'),
    drizzlePath('apps/api/src/db/schema-round9.ts'),
    drizzlePath('apps/api/src/db/schema-round11.ts'),
    drizzlePath('apps/api/src/db/schema-round16.ts'),
    drizzlePath('apps/api/src/db/schema-round17.ts'),
    drizzlePath('apps/api/src/db/schema-round18.ts'),
    drizzlePath('apps/api/src/db/schema-round19.ts'),
    drizzlePath('apps/api/src/db/schema-round20.ts'),
    drizzlePath('apps/api/src/db/schema-worklog.ts'),
    drizzlePath('apps/api/src/db/schema-worklog-quota.ts'),
    drizzlePath('apps/api/src/db/schema-worklog-bootstrap.ts'),
    drizzlePath('apps/api/src/db/schema-worklog-web-auth.ts'),
    drizzlePath('apps/api/src/db/schema-worklog-normalization.ts'),
    drizzlePath('apps/api/src/db/schema-worklog-line-text-cache.ts'),
  ],
  out: drizzlePath('drizzle'),
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
