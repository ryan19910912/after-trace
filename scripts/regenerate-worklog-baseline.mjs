import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDir = resolve(root, 'drizzle');
const metaDir = resolve(drizzleDir, 'meta');
const journalPath = resolve(metaDir, '_journal.json');
const baselinePath = resolve(drizzleDir, '0000_worklog_baseline.sql');
const resetFlag = '--confirm-prelaunch-reset';

if (!process.argv.includes(resetFlag)) {
  console.error('Refusing to regenerate AFTERTRACE Drizzle baseline without explicit prelaunch-reset confirmation.');
  console.error(`Run: pnpm db:baseline:regenerate ${resetFlag}`);
  process.exit(2);
}

assertCurrentPrelaunchShape();
const existingBaselineWhen = readExistingBaselineWhen();
const existingComments = extractCommentStatements(readFileSync(baselinePath, 'utf8'));

const backupDir = resolve(root, `.aftertrace-drizzle-backup-${process.pid}-${Date.now()}`);
if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
renameSync(drizzleDir, backupDir);
mkdirSync(drizzleDir, { recursive: true });

try {
  console.log('Regenerating the canonical fresh-database Drizzle baseline from apps/api/src/db/schema-all.ts...');
  try {
    run(
      'pnpm',
      [
        '--filter',
        '@aftertrace/api',
        'exec',
        'drizzle-kit',
        'generate',
        '--config=../../drizzle.config.ts',
        '--name=worklog_baseline',
      ],
      'Drizzle baseline generation',
      process.platform === 'win32',
    );
    preserveBaselineMigrationIdentity(existingBaselineWhen);
    restoreCanonicalComments(existingComments);
  } catch (error) {
    rmSync(drizzleDir, { recursive: true, force: true });
    renameSync(backupDir, drizzleDir);
    console.error('Baseline generation failed. The previous drizzle directory was restored in full.');
    throw error;
  }

  run(process.execPath, [resolve(root, 'scripts/check-worklog-baseline.mjs')], 'AFTERTRACE baseline guard');
  console.log('Prelaunch baseline regenerated and guard passed.');
} finally {
  if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
}

function readExistingBaselineWhen() {
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    fail('Existing Drizzle journal is unreadable; refusing to regenerate baseline identity.');
  }

  const entry = journal?.entries?.[0];
  if (!entry || entry.idx !== 0 || entry.tag !== '0000_worklog_baseline' || !Number.isFinite(entry.when)) {
    fail('Existing Drizzle journal does not contain a valid 0000_worklog_baseline identity.');
  }
  return entry.when;
}

function preserveBaselineMigrationIdentity(existingWhen) {
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    throw new Error('Generated Drizzle journal is unreadable.');
  }

  if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
    throw new Error('Generated Drizzle journal must contain exactly one baseline entry.');
  }

  const entry = journal.entries[0];
  if (entry?.idx !== 0 || entry?.tag !== '0000_worklog_baseline') {
    throw new Error('Generated Drizzle journal baseline identity is unexpected.');
  }

  entry.when = existingWhen;
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
}

function extractCommentStatements(sql) {
  const comments = new Map();
  for (const match of sql.matchAll(/COMMENT ON (?:TABLE|COLUMN) [\s\S]*?;/g)) {
    const statement = match[0].trim();
    const key = commentKey(statement);
    if (key) comments.set(key, statement);
  }
  return comments;
}

function restoreCanonicalComments(existingComments) {
  let generated = readFileSync(baselinePath, 'utf8').trimEnd();
  generated = generated.replace(/\n?--> statement-breakpoint\nCOMMENT ON (?:TABLE|COLUMN) [\s\S]*$/m, '').trimEnd();

  const required = schemaCommentTargets(generated);
  const statements = [];
  for (const target of required) {
    const existing = existingComments.get(target);
    if (existing) {
      statements.push(existing);
      continue;
    }
    const generatedComment = newCommentFor(target);
    if (!generatedComment) {
      throw new Error(`Missing PostgreSQL schema comment for ${target}. Add a meaningful comment before regenerating the canonical baseline.`);
    }
    statements.push(generatedComment);
  }

  writeFileSync(
    baselinePath,
    `${generated}\n\n--> statement-breakpoint\n${statements.join('\n')}\n`,
    'utf8',
  );
}

function schemaCommentTargets(sql) {
  const targets = [];
  for (const tableMatch of sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
    const [, table, body] = tableMatch;
    targets.push(`TABLE:${table}`);
    for (const line of body.split('\n')) {
      const columnMatch = /^\s*"([^"]+)"\s+/.exec(line);
      if (columnMatch) targets.push(`COLUMN:${table}.${columnMatch[1]}`);
    }
  }
  return targets;
}

function commentKey(statement) {
  let match = /^COMMENT ON TABLE "([^"]+)"/i.exec(statement);
  if (match) return `TABLE:${match[1]}`;
  match = /^COMMENT ON COLUMN "([^"]+)"\."([^"]+)"/i.exec(statement);
  return match ? `COLUMN:${match[1]}.${match[2]}` : null;
}

function newCommentFor(target) {
  const additions = {
    'COLUMN:worklog_record_revisions.previous_title': '修改前的紀錄標題。',
    'COLUMN:worklog_record_revisions.new_title': '修改後的紀錄標題。',
  };
  const text = additions[target];
  if (!text) return null;
  const [, qualified] = target.split(':');
  const [table, column] = qualified.split('.');
  return `COMMENT ON COLUMN "${table}"."${column}" IS '${text.replaceAll("'", "''")}';`;
}

function assertCurrentPrelaunchShape() {
  if (!existsSync(drizzleDir) || !existsSync(metaDir)) {
    fail('Expected the current prelaunch drizzle directory and meta directory to exist before regeneration.');
  }

  const rootEntries = readdirSync(drizzleDir).sort();
  const expectedRoot = ['0000_worklog_baseline.sql', 'meta'];
  if (!sameEntries(rootEntries, expectedRoot)) {
    fail(`Refusing to delete unexpected migration artifacts. Expected ${expectedRoot.join(', ')}; found ${rootEntries.join(', ') || '(empty)'}.`);
  }

  const metaEntries = readdirSync(metaDir).sort();
  const expectedMeta = ['0000_snapshot.json', '_journal.json'];
  if (!sameEntries(metaEntries, expectedMeta)) {
    fail(`Refusing to delete unexpected Drizzle metadata. Expected ${expectedMeta.join(', ')}; found ${metaEntries.join(', ') || '(empty)'}.`);
  }
}

function sameEntries(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function run(command, args, label, shell = false) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
