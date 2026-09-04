import type { WorklogAttachmentIngestionService, WorklogAttachmentIngestionResult } from './attachment-ingestion';
import type { WorklogTextNormalizationService } from './text-normalization';

export interface WorklogAttachmentRuntimePort {
  ingest(input: Parameters<WorklogAttachmentIngestionService['ingest']>[0]): Promise<WorklogAttachmentIngestionResult>;
}

/**
 * Attachment ingestion has two auditable AI stages:
 * 1) binary -> durable text Record;
 * 2) durable text -> single title / occurred_at.
 *
 * Duplicate attachment retries re-enter the idempotent normalization state machine so
 * a crash between the two stages can resume without blindly issuing a second provider call.
 */
export class WorklogAttachmentTitleNormalizationService implements WorklogAttachmentRuntimePort {
  constructor(
    private readonly attachments: WorklogAttachmentRuntimePort,
    private readonly normalization: Pick<WorklogTextNormalizationService, 'normalizeText'>,
  ) {}

  async ingest(
    input: Parameters<WorklogAttachmentIngestionService['ingest']>[0],
  ): Promise<WorklogAttachmentIngestionResult> {
    const result = await this.attachments.ingest(input);
    if (result.status !== 'RECORDED') return result;

    try {
      await this.normalization.normalizeText(result.recordId);
    } catch (error) {
      // The durable attachment text is already stored. Never convert that success into
      // data loss or a second binary fetch because title/date normalization had a
      // transient failure; PWA can still show the Record as pending/manual-organizable.
      console.error(JSON.stringify({
        event: 'worklog_attachment_title_normalization_failed_after_persist',
        recordId: result.recordId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
    }
    return result;
  }
}
