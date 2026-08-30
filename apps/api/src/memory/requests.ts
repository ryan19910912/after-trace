export type ExplicitMemoryRequestCommand = {
  quotedLineMessageId: string | null;
  instruction: string | null;
};

export type MemoryRequestResult = {
  id: number;
  status: 'PENDING' | 'BLOCKED_SOURCE_MISSING';
  sourceLineMessageId: string;
};

export interface MemoryRequestRepository {
  createExplicit(input: {
    groupId: number;
    requestLineMessageId: string;
    actorLineUserId: string | null;
    sourceLineMessageId: string;
    instruction: string | null;
    preferRecentImage: boolean;
    createdAt: Date;
  }): Promise<MemoryRequestResult>;
}

export class ExplicitMemoryRequestService {
  constructor(private readonly repository: MemoryRequestRepository) {}

  enqueue(
    groupId: number,
    message: {
      lineMessageId: string;
      lineUserId: string | null;
      lineTimestamp: Date;
    },
    command: ExplicitMemoryRequestCommand,
  ): Promise<MemoryRequestResult> {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      throw new Error('groupId must be a positive safe integer');
    }

    const instruction = command.instruction?.trim() || null;
    const preferRecentImage =
      command.quotedLineMessageId === null &&
      Boolean(instruction && /(?:圖片|照片|截圖|這張|行程|訂單|機票|車票)/.test(instruction));
    const sourceLineMessageId = command.quotedLineMessageId ?? message.lineMessageId;
    return this.repository.createExplicit({
      groupId,
      requestLineMessageId: message.lineMessageId,
      actorLineUserId: message.lineUserId,
      sourceLineMessageId,
      instruction,
      preferRecentImage,
      createdAt: message.lineTimestamp,
    });
  }
}
