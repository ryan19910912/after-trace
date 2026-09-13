import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const failures = [];
const root = process.cwd();
const dbDir = resolve(root, 'apps/api/src/db');
for (const name of readdirSync(dbDir)) {
  if (!/^schema-worklog.*\.ts$/.test(name)) continue;
  const text = readFileSync(resolve(dbDir, name), 'utf8');
  if (/\bpgEnum\s*\(/.test(text)) failures.push(`${name}: pgEnum`);
  if (/\bcheck\s*\(/.test(text)) failures.push(`${name}: check`);
}
const journal = JSON.parse(readFileSync(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'));
if ((journal.entries ?? []).at(-1)?.tag !== '0003_remove_database_domain_rules') failures.push('journal: missing 0003');
if (failures.length) throw new Error(`Database schema guard failed: ${failures.join(', ')}`);
console.log('Database schema guard passed.');
