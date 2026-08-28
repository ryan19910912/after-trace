import { describe, expect, it } from 'vitest';
import { defaultProductConfig } from '../config/product';
import type { BufferedGroupMessage } from '../line/events';
import {
  ConversationIngestionService,
  type ConversationRepository,
  type GroupRecord,
} from './service';
import type { PendingCounters } from './threshold';

class FakeConversationRepository implements ConversationRepository {
  readonly group: GroupRecord = { id: 1, lineGroupId: 'group-1', status: 'ACTIVE' };
  counters: PendingCounters = { messageCount: 29, charCount: 100 };
  insertedMessageIds = new Set<string>();

  async ensureGroup(lineGroupId: string): Promise<GroupRecord> {
    this.group.lineGroupId = lineGroupId;
    return this.group;
  }

  async activateGroup(lineGroupId: string): Promise<GroupRecord> {
    this.group.lineGroupId = lineGroupId;
    this.group.status = 'ACTIVE';
    return this.group;
  }

  async markGroupInactive(): Promise<void> {
    this.group.status = 'INACTIVE';
  }

  async insertMessage(_groupId: number, message: BufferedGroupMessage): Promise<boolean> {
    if (this.insertedMessageIds.has(message.lineMessageId)) return false;
    this.insertedMessageIds.add(message.lineMessageId);
    return true;
  }

  async incrementPending(_groupId: number, charCount: number): Promise<PendingCounters> {
    this.counters = {
      messageCount: this.counters.messageCount + 1,
      charCount: this.counters.charCount + charCount,
    };
    return this.counters;
  }

  async getPending(): Promise<PendingCounters> {
    return this.counters;
  }
}

function message(id = 'msg-1'): BufferedGroupMessage {
  return {
    webhookEventId: 'evt-1',
    lineGroupId: 'group-1',
    lineMessageId: id,
    quotedLineMessageId: null,
    lineUserId: 'user-1',
    messageType: 'text',
    textContent: 'hello',
    charCount: 5,
    quoteToken: null,
    lineTimestamp: new Date('2026-08-29T00:00:00Z'),
    metadata: null,
  };
}

describe('ConversationIngestionService', () => {
  it('stores a new message, increments counters, and returns threshold decision', async () => {
    const repository = new FakeConversationRepository();
    const service = new ConversationIngestionService(repository, defaultProductConfig);

    const result = await service.ingest(message());

    expect(result.status).toBe('STORED');
    if (result.status !== 'STORED') throw new Error('Expected stored result');
    expect(result.counters).toEqual({ messageCount: 30, charCount: 105 });
    expect(result.threshold).toMatchObject({ extractionDue: true, reason: 'MESSAGE_COUNT' });
  });

  it('does not increment counters for a redelivered LINE message id', async () => {
    const repository = new FakeConversationRepository();
    const service = new ConversationIngestionService(repository, defaultProductConfig);

    await service.ingest(message('same-id'));
    const duplicate = await service.ingest(message('same-id'));

    expect(duplicate.status).toBe('DUPLICATE');
    if (duplicate.status !== 'DUPLICATE') throw new Error('Expected duplicate result');
    expect(duplicate.counters).toEqual({ messageCount: 30, charCount: 105 });
  });

  it('ignores delayed/redelivered messages while the group is inactive', async () => {
    const repository = new FakeConversationRepository();
    const service = new ConversationIngestionService(repository, defaultProductConfig);

    await service.handleLifecycle('group-1', 'LEAVE', new Date());
    const result = await service.ingest(message('late-message'));

    expect(result).toEqual({ status: 'IGNORED_INACTIVE' });
    expect(repository.counters).toEqual({ messageCount: 29, charCount: 100 });
    expect(repository.insertedMessageIds.size).toBe(0);
  });

  it('reactivates a group only on join', async () => {
    const repository = new FakeConversationRepository();
    const service = new ConversationIngestionService(repository, defaultProductConfig);

    await service.handleLifecycle('group-1', 'LEAVE', new Date());
    expect(repository.group.status).toBe('INACTIVE');

    await service.handleLifecycle('group-1', 'JOIN', new Date());
    expect(repository.group.status).toBe('ACTIVE');
  });
});
