import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { conversationMessages, groupMembers, lineGroups, lineUsers } from '../db/schema';
import type { BufferedGroupMessage } from '../line/events';
import type { ConversationRepository, GroupRecord } from './service';
import type { PendingCounters } from './threshold';

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async ensureGroup(lineGroupId: string): Promise<GroupRecord> {
    const [group] = await this.db
      .insert(lineGroups)
      .values({ lineGroupId })
      .onConflictDoUpdate({ target: lineGroups.lineGroupId, set: { updatedAt: new Date() } })
      .returning({ id: lineGroups.id, lineGroupId: lineGroups.lineGroupId, status: lineGroups.status });
    if (!group) throw new Error('Failed to ensure LINE group');
    return group;
  }

  async activateGroup(lineGroupId: string): Promise<GroupRecord> {
    const [group] = await this.db
      .insert(lineGroups)
      .values({ lineGroupId, status: 'ACTIVE', inactiveAt: null })
      .onConflictDoUpdate({
        target: lineGroups.lineGroupId,
        set: { status: 'ACTIVE', inactiveAt: null, updatedAt: new Date() },
      })
      .returning({ id: lineGroups.id, lineGroupId: lineGroups.lineGroupId, status: lineGroups.status });
    if (!group) throw new Error('Failed to activate LINE group');
    return group;
  }

  async markGroupInactive(lineGroupId: string, inactiveAt: Date): Promise<void> {
    await this.db
      .insert(lineGroups)
      .values({ lineGroupId, status: 'INACTIVE', inactiveAt })
      .onConflictDoUpdate({
        target: lineGroups.lineGroupId,
        set: { status: 'INACTIVE', inactiveAt, updatedAt: new Date() },
      });
  }

  async touchGroupMember(groupId: number, lineUserId: string, seenAt: Date): Promise<void> {
    await this.db
      .insert(lineUsers)
      .values({ lineUserId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: lineUsers.lineUserId, set: { updatedAt: new Date() } });

    await this.db
      .insert(groupMembers)
      .values({
        groupId,
        lineUserId,
        isActive: true,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      })
      .onConflictDoUpdate({
        target: [groupMembers.groupId, groupMembers.lineUserId],
        set: {
          isActive: true,
          lastSeenAt: sql`GREATEST(${groupMembers.lastSeenAt}, ${seenAt})`,
          updatedAt: new Date(),
        },
      });
  }

  async markGroupMembersInactive(
    groupId: number,
    lineUserIds: readonly string[],
    at: Date,
  ): Promise<void> {
    if (lineUserIds.length === 0) return;
    await this.db
      .update(groupMembers)
      .set({
        isActive: false,
        lastSeenAt: sql`GREATEST(${groupMembers.lastSeenAt}, ${at})`,
        updatedAt: at,
      })
      .where(and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.lineUserId, [...lineUserIds]),
      ));
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
      .returning({ messageCount: lineGroups.pendingMessageCount, charCount: lineGroups.pendingCharCount });
    if (!updated) throw new Error('Failed to update pending conversation counters');
    return updated;
  }

  async getPending(groupId: number): Promise<PendingCounters> {
    const [group] = await this.db
      .select({ messageCount: lineGroups.pendingMessageCount, charCount: lineGroups.pendingCharCount })
      .from(lineGroups)
      .where(eq(lineGroups.id, groupId))
      .limit(1);
    if (!group) throw new Error('LINE group not found while reading pending counters');
    return group;
  }
}
