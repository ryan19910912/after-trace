import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { conversationMessages, lineGroups } from '../db/schema';
import type { BufferedGroupMessage } from '../line/events';
import type { ConversationRepository, GroupRecord } from './service';
import type { PendingCounters } from './threshold';

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async upsertActiveGroup(lineGroupId: string): Promise<GroupRecord> {
    const [group] = await this.db
      .insert(lineGroups)
      .values({ lineGroupId })
      .onConflictDoUpdate({
        target: lineGroups.lineGroupId,
        set: {
          status: 'ACTIVE',
          inactiveAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: lineGroups.id, lineGroupId: lineGroups.lineGroupId });

    if (!group) throw new Error('Failed to upsert LINE group');
    return group;
  }

  async markGroupInactive(lineGroupId: string, inactiveAt: Date): Promise<void> {
    await this.db
      .update(lineGroups)
      .set({
        status: 'INACTIVE',
        inactiveAt,
        updatedAt: new Date(),
      })
      .where(eq(lineGroups.lineGroupId, lineGroupId));
  }

  async insertMessage(groupId: number, message: BufferedGroupMessage): Promise<boolean> {
    const inserted = await this.db
      .insert(conversationMessages)
      .values({
        groupId,
        webhookEventId: message.webhookEventId,
        lineMessageId: message.lineMessageId,
        quotedLineMessageId: message.quotedLineMessageId,
        lineUserId: message.lineUserId,
        messageType: message.messageType,
        textContent: message.textContent,
        charCount: message.charCount,
        quoteToken: message.quoteToken,
        lineTimestamp: message.lineTimestamp,
        metadata: message.metadata,
      })
      .onConflictDoNothing({ target: conversationMessages.lineMessageId })
      .returning({ id: conversationMessages.id });

    return inserted.length > 0;
  }

  async incrementPending(groupId: number, charCount: number): Promise<PendingCounters> {
    const [updated] = await this.db
      .update(lineGroups)
      .set({
        pendingMessageCount: sql`${lineGroups.pendingMessageCount} + 1`,
        pendingCharCount: sql`${lineGroups.pendingCharCount} + ${charCount}`,
        updatedAt: new Date(),
      })
      .where(eq(lineGroups.id, groupId))
      .returning({
        messageCount: lineGroups.pendingMessageCount,
        charCount: lineGroups.pendingCharCount,
      });

    if (!updated) throw new Error('Failed to update pending conversation counters');
    return updated;
  }

  async getPending(groupId: number): Promise<PendingCounters> {
    const [group] = await this.db
      .select({
        messageCount: lineGroups.pendingMessageCount,
        charCount: lineGroups.pendingCharCount,
      })
      .from(lineGroups)
      .where(eq(lineGroups.id, groupId))
      .limit(1);

    if (!group) throw new Error('LINE group not found while reading pending counters');
    return group;
  }
}
