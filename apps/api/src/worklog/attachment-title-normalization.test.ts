import { describe, expect, it } from 'vitest';
import { WorklogAttachmentTitleNormalizationService } from './attachment-title-normalization';

describe('WorklogAttachmentTitleNormalizationService', () => {
  it('runs title/time normalization after a newly recorded attachment', async () => {
    const normalized: number[] = [];
    const service = new WorklogAttachmentTitleNormalizationService(
      {
        async ingest() {
          return { status: 'RECORDED' as const, recordId: 41, duplicate: false };
        },
      },
      {
        async normalizeText(recordId: number) {
          normalized.push(recordId);
          return { status: 'NORMALIZED' as const, entityId: 7, createdEntity: true };
        },
      },
    );

    await expect(service.ingest({} as never)).resolves.toEqual({
      status: 'RECORDED',
      recordId: 41,
      duplicate: false,
    });
    expect(normalized).toEqual([41]);
  });

  it('re-enters idempotent normalization on duplicate attachment retry to recover a crash between stages', async () => {
    const normalized: number[] = [];
    const service = new WorklogAttachmentTitleNormalizationService(
      {
        async ingest() {
          return { status: 'RECORDED' as const, recordId: 41, duplicate: true };
        },
      },
      {
        async normalizeText(recordId: number) {
          normalized.push(recordId);
          return { status: 'ALREADY_NORMALIZED' as const };
        },
      },
    );

    await service.ingest({} as never);
    expect(normalized).toEqual([41]);
  });

  it('does not start title normalization until durable attachment ingestion has a Record', async () => {
    let normalized = false;
    const service = new WorklogAttachmentTitleNormalizationService(
      {
        async ingest() {
          return { status: 'IN_PROGRESS' as const };
        },
      },
      {
        async normalizeText() {
          normalized = true;
          return { status: 'IN_PROGRESS' as const };
        },
      },
    );

    await expect(service.ingest({} as never)).resolves.toEqual({ status: 'IN_PROGRESS' });
    expect(normalized).toBe(false);
  });

  it('preserves durable attachment success when title normalization throws', async () => {
    const service = new WorklogAttachmentTitleNormalizationService(
      {
        async ingest() {
          return { status: 'RECORDED' as const, recordId: 41, duplicate: false };
        },
      },
      {
        async normalizeText() {
          throw new Error('temporary normalization failure');
        },
      },
    );

    await expect(service.ingest({} as never)).resolves.toEqual({
      status: 'RECORDED',
      recordId: 41,
      duplicate: false,
    });
  });
});
