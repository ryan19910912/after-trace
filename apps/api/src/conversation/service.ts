import type { ProductConfig } from '../config/product';
import type { BufferedGroupMessage, GroupLifecycleEvent } from '../line/events';
import {
  evaluateExtractionThreshold,
  type ExtractionThresholdDecision,
  type PendingCounters,
} from './threshold';

export type GroupRecord = {
  id: number;
  lineGroupId: string;
  status: 'ACTIVE' | 'INACTIVE';
};

export interface ConversationRepository {
  ensureGroup(lineGroupId: string): Promise<GroupRecord>;
  activateGroup(lineGroupId: string): Promise<GroupRecord>;
  markGroupInactive(lineGroupId: string, inactiveAt: Date): Promise<void>;
  touchGroupMember(groupId: number, lineUserId: string, seenAt: Date): Promise<void>;
  markGroupMembersInactive(groupId: number, lineUserIds: readonly string[], at: Date): Promise<void>;
  insertMessage(groupId: number, message: BufferedGroupMessage): Promise<boolean>;
  incrementPending(groupId: number, charCount: number): Promise<PendingCounters>;
  getPending(groupId: number): Promise<PendingCounters>;
}

export type ConversationIngestionResult =
  | { status: 'IGNORED_INACTIVE' }
  | {
      status: 'STORED' | 'DUPLICATE';
      groupId: number;
      counters: PendingCounters;
      threshold: ExtractionThresholdDecision;
    };

export class ConversationIngestionService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly config: ProductConfig,
  ) {}

  async ingest(message: BufferedGroupMessage): Promise<ConversationIngestionResult> {
    const group = await this.repository.ensureGroup(message.lineGroupId);
    if (group.status === 'INACTIVE') return { status: 'IGNORED_INACTIVE' };

    if (message.lineUserId) {
      await this.repository.touchGroupMember(group.id, message.lineUserId, message.lineTimestamp);
    }

    const inserted = await this.repository.insertMessage(group.id, message);
    const counters = inserted
      ? await this.repository.incrementPending(group.id, message.charCount)
      : await this.repository.getPending(group.id);

    return {
      status: inserted ? 'STORED' : 'DUPLICATE',
      groupId: group.id,
      counters,
      threshold: evaluateExtractionThreshold(counters, message.charCount, this.config),
    };
  }

  async handleLifecycle(event: GroupLifecycleEvent): Promise<void> {
    if (event.type === 'JOIN') {
      await this.repository.activateGroup(event.lineGroupId);
      return;
    }
    if (event.type === 'LEAVE') {
      await this.repository.markGroupInactive(event.lineGroupId, event.lineTimestamp);
      return;
    }

    const group = await this.repository.ensureGroup(event.lineGroupId);
    if (group.status !== 'ACTIVE') return;
    if (event.type === 'MEMBER_JOINED') {
      for (const lineUserId of event.lineUserIds) {
        await this.repository.touchGroupMember(group.id, lineUserId, event.lineTimestamp);
      }
      return;
    }
    await this.repository.markGroupMembersInactive(
      group.id,
      event.lineUserIds,
      event.lineTimestamp,
    );
  }
}
