import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const FORBIDDEN_GRANT_ALIAS = new RegExp(`worklog_ai_grants\\s+${'grant'}\\b`, 'i');

describe('PostgreSQL alias safety', () => {
  it('never aliases worklog_ai_grants as reserved keyword GRANT', async () => {
    const files = await sourceFiles(SOURCE_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (FORBIDDEN_GRANT_ALIAS.test(source)) {
        violations.push(relative(process.cwd(), file).replaceAll('\\', '/'));
      }
    }

    expect(violations, [
      'PostgreSQL reserves GRANT as a statement keyword.',
      'Use a safe alias such as g, ai_grant, or grant_row.',
      `Violations: ${violations.join(', ') || 'none'}`,
    ].join('\n')).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && extname(entry.name) === '.ts') files.push(path);
  }
  return files;
}
