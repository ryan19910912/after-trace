import { describe, expect, it } from 'vitest';
import {
  worklogRecordAiEnrichmentStatusEnum,
  worklogRecordRevisionChannelEnum,
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
    expect('entityId' in worklogRecords).toBe(false);
    expect('lineMessageId' in worklogRecords).toBe(false);
    expect('quotedLineMessageId' in worklogRecords).toBe(false);
  });

  it('keeps only target enrichment states', () => {
    expect(worklogRecordAiEnrichmentStatusEnum.enumValues).toEqual(['NONE', 'ENRICHED']);
  });

  it('keeps only target revision channels', () => {
    expect(worklogRecordRevisionChannelEnum.enumValues).toEqual([
      'PWA_MANUAL',
      'PWA_DELETE',
      'PWA_RESTORE',
      'AI_REWRITE',
      'SYSTEM',
    ]);
  });

  it('allows revision snapshots when a Record has no business event time', () => {
    expect(worklogRecordRevisions.previousOccurredAt.notNull).toBe(false);
    expect(worklogRecordRevisions.newOccurredAt.notNull).toBe(false);
    expect('previousEntityId' in worklogRecordRevisions).toBe(false);
    expect('newEntityId' in worklogRecordRevisions).toBe(false);
  });
});