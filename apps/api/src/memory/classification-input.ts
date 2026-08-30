import type { ExtractionBatchInputService, ExtractionInputMessage } from '../extraction/input';
import type { InlineMemoryMedia, LineMessageContentResolver } from '../line/content';
import type { EligibleMemorySubjectService } from './eligible-subjects';
import type { ActiveMemory, MemoryCandidatePipeline } from './pipeline';
import type { ClaimedMemoryRequest, MemoryRequestOrigin } from './work';

export type MemoryClassificationInput = {
  requestId: number;
  groupId: number;
  origin: MemoryRequestOrigin;
  actorLineUserId: string | null;
  instruction: string | null;
  currentMessages: ExtractionInputMessage[];
  previousContext: null | {
    batchId: number;
    messages: ExtractionInputMessage[];
  };
  activeMemories: ActiveMemory[];
  eligibleSubjectLineUserIds: string[];
  inlineMedia?: InlineMemoryMedia[];
};

export interface MemorySourceMessageRepository {
  loadById(groupId: number, conversationMessageId: number): Promise<ExtractionInputMessage | null>;
}

export class MemoryClassificationInputService {
  constructor(
    private readonly extractionInput: ExtractionBatchInputService,
    private readonly sourceMessages: MemorySourceMessageRepository,
    private readonly candidates: MemoryCandidatePipeline,
    private readonly eligibleSubjects?: Pick<EligibleMemorySubjectService, 'listForRequest'>,
    private readonly contentResolver?: Pick<LineMessageContentResolver, 'image'>,
  ) {}

  async load(request: ClaimedMemoryRequest): Promise<MemoryClassificationInput> {
    const activeMemories = await this.candidates.listActiveMemories(request.groupId);

    if (request.origin === 'EXPLICIT') {
      if (request.sourceConversationMessageId === null) {
        throw new Error('explicit memory request is missing its source conversation message');
      }
      const source = await this.sourceMessages.loadById(
        request.groupId,
        request.sourceConversationMessageId,
      );
      if (!source) throw new Error('explicit memory request source is no longer available');

      const inlineMedia: InlineMemoryMedia[] = [];
      if (source.messageType === 'image') {
        if (!this.contentResolver) throw new Error('explicit image memory requires LINE content resolver');
        inlineMedia.push(await this.contentResolver.image(source.lineMessageId));
      }

      return {
        requestId: request.id,
        groupId: request.groupId,
        origin: request.origin,
        actorLineUserId: request.actorLineUserId,
        instruction: request.instruction,
        currentMessages: [source],
        previousContext: null,
        activeMemories,
        eligibleSubjectLineUserIds: request.actorLineUserId ? [request.actorLineUserId] : [],
        inlineMedia,
      };
    }

    if (request.extractionBatchId === null) {
      throw new Error('automatic memory request is missing its extraction batch');
    }
    const batch = await this.extractionInput.load(request.extractionBatchId);
    if (!batch) throw new Error('automatic memory request extraction batch was not found');
    if (batch.groupId !== request.groupId) {
      throw new Error('automatic memory request extraction batch belongs to another group');
    }
    if (!this.eligibleSubjects) {
      throw new Error('automatic memory request requires eligible subject snapshot repository');
    }
    const subjects = await this.eligibleSubjects.listForRequest(request.id);
    if (subjects.length === 0) {
      throw new Error('automatic memory request has no eligible subject snapshot');
    }

    return {
      requestId: request.id,
      groupId: request.groupId,
      origin: request.origin,
      actorLineUserId: request.actorLineUserId,
      instruction: null,
      currentMessages: batch.currentMessages,
      previousContext: batch.previousContext,
      activeMemories,
      eligibleSubjectLineUserIds: subjects.map((subject) => subject.lineUserId),
      inlineMedia: [],
    };
  }
}
