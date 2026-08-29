import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Drizzle Kit');
}

export default defineConfig({
  schema: [
    './apps/api/src/db/schema.ts',
    './apps/api/src/db/schema-round5.ts',
    './apps/api/src/db/schema-round6.ts',
    './apps/api/src/db/schema-round8.ts',
    './apps/api/src/db/schema-round9.ts',
    './apps/api/src/db/schema-round11.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
