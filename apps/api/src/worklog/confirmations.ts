export type WorklogConfirmationCandidate = {
  entityId: number;
  name: string;
  matchedVia: 'ENTITY' | 'ALIAS' | 'FUZZY';
};

export type WorklogPendingConfirmation = {
  id: number;
  sourceId: number;
  recordId: number;
  requestedUserId: number;
  confirmationType: 'ALIAS_MATCH' | 'RECORD_TITLE' | 'ENTITY_MATCH';
  candidateEntityId: number | null;
  candidateTitle: string | null;
  proposedName: string | null;
  reason: string | null;
  /** CREATE_TITLE is the original AI-create ambiguity; LINE_AI_EDIT is an already-paid Reply edit. */
  operation: 'CREATE_TITLE' | 'LINE_AI_EDIT';
  /** Complete proposed durable Record text for LINE_AI_EDIT; null for create-title confirmation. */
  proposedRawText: string | null;
  /** Proposed occurred_at captured from the already-paid provider result. */
  occurredAt: Date;
  /** Current durable Record occurred_at before a LINE_AI_EDIT confirmation is applied. */
  recordOccurredAt: Date;
  expectedRecordVersion: number;
  candidates: WorklogConfirmationCandidate[];
  recordRawText: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export type WorklogConfirmationResolution =
  | {
      status: 'CONFIRMED';
      confirmationId: number;
      recordId: number;
      entityId: number;
      title: string;
      createdEntity: boolean;
      aliasCreated: boolean;
    }
  | { status: 'REJECTED'; confirmationId: number; recordId: number }
  | {
      status:
        | 'NOT_FOUND'
        | 'RECORD_CHANGED'
        | 'ENTITY_NOT_ALLOWED'
        | 'TITLE_REQUIRED'
        | 'TITLE_CONFLICT';
    };

export interface WorklogConfirmationRepository {
  listPending(input: {
    requestedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogPendingConfirmation[]>;

  resolveExisting(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    entityId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution>;

  resolveNewTitle(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    title: string;
    at: Date;
  }): Promise<WorklogConfirmationResolution>;

  reject(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution>;
}

export type WorklogConfirmationDecision =
  | { kind: 'USE_EXISTING'; entityId: number }
  | { kind: 'CREATE_TITLE'; title?: string | null }
  | { kind: 'REJECT' };

/**
 * Resolves already-paid/durable AI ambiguity without issuing another provider call.
 *
 * The repository owns the atomic DB guard: confirmation must still be PENDING and the
 * underlying Record must still be ACTIVE and at the version captured when the
 * confirmation was created. CREATE title resolution additionally requires an unresolved
 * Record; LINE AI edit resolution requires the exact pre-edit title/entity snapshot.
 * This service only validates the deterministic user decision and never performs AI or
 * billing work.
 */
export class WorklogConfirmationService {
  constructor(private readonly repository: WorklogConfirmationRepository) {}

  listPending(requestedUserId: number, sourceId: number, at = new Date()) {
    return this.repository.listPending({
      requestedUserId: positiveInteger(requestedUserId, 'requestedUserId'),
      sourceId: positiveInteger(sourceId, 'sourceId'),
      at: validDate(at, 'at'),
    });
  }

  async resolve(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    decision: WorklogConfirmationDecision;
    at?: Date;
  }): Promise<WorklogConfirmationResolution> {
    const base = {
      confirmationId: positiveInteger(input.confirmationId, 'confirmationId'),
      requestedUserId: positiveInteger(input.requestedUserId, 'requestedUserId'),
      sourceId: positiveInteger(input.sourceId, 'sourceId'),
      at: validDate(input.at ?? new Date(), 'at'),
    };

    if (input.decision.kind === 'REJECT') return this.repository.reject(base);

    if (input.decision.kind === 'USE_EXISTING') {
      return this.repository.resolveExisting({
        ...base,
        entityId: positiveInteger(input.decision.entityId, 'entityId'),
      });
    }

    const title = optionalTitle(input.decision.title);
    if (!title) {
      // The repository may still use the AI-proposed title when the caller omits one.
      return this.repository.resolveNewTitle({ ...base, title: '' });
    }
    return this.repository.resolveNewTitle({ ...base, title });
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}

function optionalTitle(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 255) throw new Error('title is too long');
  return normalized;
}
