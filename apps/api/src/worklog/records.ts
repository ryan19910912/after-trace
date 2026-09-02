export type WorklogRecordListItem = {
  id: number;
  sourceId: number;
  authorUserId: number | null;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  category: string;
  rawText: string | null;
  normalizedSummary: string | null;
  customerId: number | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WorklogGroupSurface = {
  sourceId: number;
  lineGroupId: string;
};

export type WorklogPwaSurfaces = {
  personal: { sourceId: number } | null;
  groups: WorklogGroupSurface[];
};

export interface WorklogRecordReadRepository {
  isOaFriend(userId: number): Promise<boolean>;
  getActivePersonalSourceId(userId: number): Promise<number | null>;
  listActiveGroupSurfaces(userId: number): Promise<WorklogGroupSurface[]>;
  isActiveGroupMember(userId: number, sourceId: number): Promise<boolean>;
  listRecordsBySource(sourceId: number, limit: number): Promise<WorklogRecordListItem[]>;
}

export type StoredTextRecordIdentity = {
  id: number;
  sourceId: number;
  authorUserId: number | null;
  lineMessageId: string;
  quotedLineMessageId: string | null;
  rawText: string | null;
};

export interface WorklogRecordWriteRepository {
  insertTextRecord(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    quotedLineMessageId?: string | null;
    rawText: string;
    sourceTimestamp: Date;
  }): Promise<
    | { status: 'CREATED'; record: StoredTextRecordIdentity }
    | { status: 'EXISTING'; record: StoredTextRecordIdentity }
    | { status: 'SOURCE_NOT_FOUND' }
  >;
}

export type WorklogTextRecordWriteResult =
  | { status: 'CREATED'; recordId: number }
  | { status: 'ALREADY_RECORDED'; recordId: number }
  | { status: 'SOURCE_NOT_FOUND' }
  | { status: 'IDEMPOTENCY_CONFLICT'; recordId: number };

export class WorklogRecordWriteService {
  constructor(private readonly repository: WorklogRecordWriteRepository) {}

  async recordText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult> {
    return this.recordTextInternal({ ...input, quotedLineMessageId: null });
  }

  async recordQuotedText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    quotedLineMessageId: string;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult> {
    return this.recordTextInternal(input);
  }

  private async recordTextInternal(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    quotedLineMessageId?: string | null;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult> {
    const sourceId = positiveInteger(input.sourceId, 'source id');
    const authorUserId = positiveInteger(input.authorUserId, 'author user id');
    const lineMessageId = requiredTrimmed(input.lineMessageId, 'LINE message id', 64);
    const quotedLineMessageId = input.quotedLineMessageId
      ? requiredTrimmed(input.quotedLineMessageId, 'quoted LINE message id', 64)
      : null;
    const text = requiredTrimmed(input.text, 'record text');
    const stored = await this.repository.insertTextRecord({
      sourceId,
      authorUserId,
      lineMessageId,
      quotedLineMessageId,
      rawText: text,
      sourceTimestamp: input.sourceTimestamp ?? new Date(),
    });

    if (stored.status === 'SOURCE_NOT_FOUND') return stored;
    if (stored.status === 'CREATED') return { status: 'CREATED', recordId: stored.record.id };

    const sameIdentity =
      stored.record.sourceId === sourceId &&
      stored.record.authorUserId === authorUserId &&
      stored.record.lineMessageId === lineMessageId &&
      stored.record.quotedLineMessageId === quotedLineMessageId &&
      stored.record.rawText === text;
    return sameIdentity
      ? { status: 'ALREADY_RECORDED', recordId: stored.record.id }
      : { status: 'IDEMPOTENCY_CONFLICT', recordId: stored.record.id };
  }
}

export class WorklogRecordReadService {
  constructor(private readonly repository: WorklogRecordReadRepository) {}

  async surfaces(userId: number): Promise<WorklogPwaSurfaces> {
    const [oaFriend, groups] = await Promise.all([
      this.repository.isOaFriend(userId),
      this.repository.listActiveGroupSurfaces(userId),
    ]);
    const personalSourceId = oaFriend
      ? await this.repository.getActivePersonalSourceId(userId)
      : null;
    return {
      personal: personalSourceId === null ? null : { sourceId: personalSourceId },
      groups,
    };
  }

  async personalRecords(userId: number, limit = 100): Promise<WorklogRecordListItem[]> {
    if (!(await this.repository.isOaFriend(userId))) return [];
    const sourceId = await this.repository.getActivePersonalSourceId(userId);
    if (sourceId === null) return [];
    return this.repository.listRecordsBySource(sourceId, safeLimit(limit));
  }

  async groupRecords(
    userId: number,
    sourceId: number,
    limit = 100,
  ): Promise<{ status: 'OK'; records: WorklogRecordListItem[] } | { status: 'FORBIDDEN' }> {
    if (!(await this.repository.isActiveGroupMember(userId, sourceId))) {
      return { status: 'FORBIDDEN' };
    }
    return {
      status: 'OK',
      records: await this.repository.listRecordsBySource(sourceId, safeLimit(limit)),
    };
  }
}

function safeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function requiredTrimmed(value: string, label: string, maxLength?: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (maxLength && normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}
