export type WorklogLineActionTarget = {
  id: number;
  sourceId: number;
  entityId: number | null;
  rawText: string;
  occurredAt: string;
  status: 'ACTIVE' | 'DELETED';
  version: number;
};

export type WorklogLineActionTargetResolution =
  | { status: 'FOUND'; record: WorklogLineActionTarget }
  | { status: 'NOT_FOUND' }
  | { status: 'AMBIGUOUS' };

export type WorklogLineRecordActionResult =
  | { status: 'DELETED' | 'RESTORED' | 'MOVED'; recordId: number; recordVersion: number }
  | { status: 'NOT_FOUND' | 'NOT_ACTIVE' | 'NOT_DELETED' | 'AMBIGUOUS_TITLE' | 'VERSION_CONFLICT' };

export interface WorklogLineRecordActionRepository {
  resolveTarget(sourceId: number, quotedLineMessageId: string): Promise<WorklogLineActionTargetResolution>;
  deleteRecord(target: WorklogLineActionTarget, actorUserId: number): Promise<WorklogLineRecordActionResult>;
  restoreRecord(target: WorklogLineActionTarget, actorUserId: number): Promise<WorklogLineRecordActionResult>;
  moveRecord(target: WorklogLineActionTarget, actorUserId: number, title: string): Promise<WorklogLineRecordActionResult>;
}

export class WorklogLineRecordActionService {
  constructor(private readonly repository: WorklogLineRecordActionRepository) {}

  resolveTarget(sourceId: number, quotedLineMessageId: string) {
    return this.repository.resolveTarget(positiveInteger(sourceId, 'sourceId'), requiredText(quotedLineMessageId, 'quotedLineMessageId', 64));
  }

  delete(target: WorklogLineActionTarget, actorUserId: number) {
    return this.repository.deleteRecord(normalizeTarget(target), positiveInteger(actorUserId, 'actorUserId'));
  }

  restore(target: WorklogLineActionTarget, actorUserId: number) {
    return this.repository.restoreRecord(normalizeTarget(target), positiveInteger(actorUserId, 'actorUserId'));
  }

  move(target: WorklogLineActionTarget, actorUserId: number, title: string) {
    return this.repository.moveRecord(normalizeTarget(target), positiveInteger(actorUserId, 'actorUserId'), requiredText(title, 'title', 255));
  }
}

function normalizeTarget(target: WorklogLineActionTarget): WorklogLineActionTarget {
  return { ...target, id: positiveInteger(target.id, 'recordId'), sourceId: positiveInteger(target.sourceId, 'sourceId'), version: positiveInteger(target.version, 'version') };
}
function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}
function requiredText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`invalid ${label}`);
  return text;
}
