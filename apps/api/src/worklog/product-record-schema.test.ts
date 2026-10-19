import { describe, expect, it } from 'vitest';
import {
  worklogRecordRevisions,
  worklogRecords,
} from '../db/schema-worklog-record-core';
import {
  WORKLOG_RECORD_AI_ENRICHMENT_STATUSES,
  WORKLOG_RECORD_REVISION_CHANNELS,
} from './domain-values';

describe('Web/PWA product Record schema', () => {
  it('allows a manual Record without event time or AI enrichment metadata', () => {
    expect(worklogRecords.rawText.notNull).toBe(true);
    expect(worklogRecords.occurredAt.notNull).toBe(false);
    expect(worklogRecords.title.notNull).toBe(false);
    expect(worklogRecords.extractedMetadata.notNull).toBe(false);
    expect(worklogRecords.aiEnrichedAt.notNull).toBe(false);
    expect(worklogRecords.aiEnrichmentStatus.notNull).toBe(true);
    expect(worklogRecords.aiEnrichmentStatus.default).toBe('NONE');
    expect(worklogRecords.aiEnrichmentStatus.dataType).toBe('string');
    expect('entityId' in worklogRecords).toBe(false);
    expect('lineMessageId' in worklogRecords).toBe(false);
    expect('quotedLineMessageId' in worklogRecords).toBe(false);
  });

  it('keeps only target enrichment states in application rules', () => {
    expect(WORKLOG_RECORD_AI_ENRICHMENT_STATUSES).toEqual(['NONE', 'ENRICHED']);
  });

  it('keeps only target revision channels in application rules', () => {
    expect(WORKLOG_RECORD_REVISION_CHANNELS).toEqual([
      'PWA_MANUAL',
      'PWA_DELETE',
      'PWA_RESTORE',
      'AI_REWRITE',
      'SYSTEM',
    ]);
    expect(worklogRecordRevisions.channel.dataType).toBe('string');
  });

  it('allows revision snapshots when a Record has no business event time or title', () => {
    expect(worklogRecordRevisions.previousTitle.notNull).toBe(false);
    expect(worklogRecordRevisions.newTitle.notNull).toBe(false);
    expect(worklogRecordRevisions.previousOccurredAt.notNull).toBe(false);
    expect(worklogRecordRevisions.newOccurredAt.notNull).toBe(false);
    expect('previousEntityId' in worklogRecordRevisions).toBe(false);
    expect('newEntityId' in worklogRecordRevisions).toBe(false);
  });
});
