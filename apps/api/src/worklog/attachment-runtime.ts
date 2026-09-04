import type { WorklogAttachmentRuntimePort } from './attachment-title-normalization';

let current: WorklogAttachmentRuntimePort | null = null;

export function configureWorklogAttachmentRuntime(service: WorklogAttachmentRuntimePort | null): void {
  current = service;
}

export function worklogAttachmentRuntime(): WorklogAttachmentRuntimePort | null {
  return current;
}
