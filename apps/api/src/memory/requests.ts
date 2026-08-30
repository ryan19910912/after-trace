export type ExplicitMemoryRequestCommand = {
  quotedLineMessageId: string | null;
  instruction: string | null;
  preferRecentImage?: boolean;
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
    const sourceLineMessageId = command.quotedLineMessageId ?? message.lineMessageId;
    return this.repository.createExplicit({
      groupId,
      requestLineMessageId: message.lineMessageId,
      actorLineUserId: message.lineUserId,
      sourceLineMessageId,
      instruction,
      preferRecentImage: command.quotedLineMessageId === null && command.preferRecentImage === true,
      createdAt: message.lineTimestamp,
    });
  }
}
