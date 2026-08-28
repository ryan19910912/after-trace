export type ExtractionInputMessage = {
  id: number;
  lineMessageId: string;
  lineUserId: string | null;
  messageType: string;
  textContent: string | null;
  charCount: number;
  quoteToken: string | null;
  quotedLineMessageId: string | null;
  lineTimestamp: Date;
  metadata: Record<string, unknown> | null;
};

export type ExtractionBatchInput = {
  batchId: number;
  groupId: number;
  currentMessages: ExtractionInputMessage[];
  previousContext: null | {
    batchId: number;
    messages: ExtractionInputMessage[];
  };
};

export interface ExtractionInputRepository {
  loadBatchInput(batchId: number): Promise<ExtractionBatchInput | null>;
}

export class ExtractionBatchInputService {
  constructor(private readonly repository: ExtractionInputRepository) {}

  load(batchId: number): Promise<ExtractionBatchInput | null> {
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      throw new Error('batchId must be a positive safe integer');
    }
    return this.repository.loadBatchInput(batchId);
  }
}
