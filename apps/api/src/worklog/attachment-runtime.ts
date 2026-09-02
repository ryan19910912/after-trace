import type { WorklogAttachmentIngestionService } from './attachment-ingestion';

let current: WorklogAttachmentIngestionService | null = null;

export function configureWorklogAttachmentRuntime(service: WorklogAttachmentIngestionService | null): void {
  current = service;
}

export function worklogAttachmentRuntime(): WorklogAttachmentIngestionService | null {
  return current;
}
