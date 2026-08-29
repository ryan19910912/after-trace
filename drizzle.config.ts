import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Drizzle Kit');
}

const rootDir = dirname(fileURLToPath(import.meta.url));
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
  ],
  out: drizzlePath('drizzle'),
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
