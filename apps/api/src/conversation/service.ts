import type { ProductConfig } from '../config/product';
import type { BufferedGroupMessage } from '../line/events';
import {
  evaluateExtractionThreshold,
  type ExtractionThresholdDecision,
  type PendingCounters,
} from './threshold';

export type GroupRecord = {
  id: number;
  lineGroupId: string;
};

export interface ConversationRepository {
  upsertActiveGroup(lineGroupId: string): Promise<GroupRecord>;
  markGroupInactive(lineGroupId: string, inactiveAt: Date): Promise<void>;
  insertMessage(groupId: number, message: BufferedGroupMessage): Promise<boolean>;
  incrementPending(groupId: number, charCount: number): Promise<PendingCounters>;
  getPending(groupId: number): Promise<PendingCounters>;
}

export type ConversationIngestionResult = {
  duplicate: boolean;
  counters: PendingCounters;
  threshold: ExtractionThresholdDecision;
};

export class ConversationIngestionService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly config: ProductConfig,
  ) {}

  async ingest(message: BufferedGroupMessage): Promise<ConversationIngestionResult> {
    const group = await this.repository.upsertActiveGroup(message.lineGroupId);
    const inserted = await this.repository.insertMessage(group.id, message);
    const counters = inserted
      ? await this.repository.incrementPending(group.id, message.charCount)
      : await this.repository.getPending(group.id);

    return {
      duplicate: !inserted,
      counters,
      threshold: evaluateExtractionThreshold(counters, message.charCount, this.config),
    };
  }

  async handleLifecycle(lineGroupId: string, type: 'JOIN' | 'LEAVE', at: Date): Promise<void> {
    if (type === 'JOIN') {
      await this.repository.upsertActiveGroup(lineGroupId);
      return;
    }
    await this.repository.markGroupInactive(lineGroupId, at);
  }
}
