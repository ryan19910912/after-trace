import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  worklogRecordAiEnrichmentStatusEnum,
  worklogRecordRevisions,
  worklogRecords,
} from '../db/schema-worklog-record-core';

describe('Web/PWA product Record schema', () => {
  it('allows a manual Record without event time or AI enrichment metadata', () => {
    expect(worklogRecords.rawText.notNull).toBe(true);
    expect(worklogRecords.occurredAt.notNull).toBe(false);
    expect(worklogRecords.title.notNull).toBe(false);
    expect(worklogRecords.extractedMetadata.notNull).toBe(false);
    expect(worklogRecords.aiEnrichedAt.notNull).toBe(false);
    expect(worklogRecords.aiEnrichmentStatus.notNull).toBe(true);
    expect(worklogRecords.aiEnrichmentStatus.default).toBe('NONE');
  });

  it('keeps explicit enrichment state so legacy data is not guessed from nullable metadata', () => {
    expect(worklogRecordAiEnrichmentStatusEnum.enumValues).toEqual([
      'NONE',
      'ENRICHED',
      'LEGACY',
    ]);
  });

  it('allows revision snapshots when a Record has no business event time', () => {
    expect(worklogRecordRevisions.previousOccurredAt.notNull).toBe(false);
    expect(worklogRecordRevisions.newOccurredAt.notNull).toBe(false);
  });

  it('keeps the forward migration idempotent and marks pre-reset rows as legacy', async () => {
    const migration = await readFile(join(process.cwd(), 'scripts/forward-compat.mjs'), 'utf8');

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS title varchar(255)');
    expect(migration).toContain("SET ai_enrichment_status = 'LEGACY'");
    expect(migration).toContain('ALTER COLUMN occurred_at DROP NOT NULL');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS worklog_record_ai_enrichment_idx');
  });
});