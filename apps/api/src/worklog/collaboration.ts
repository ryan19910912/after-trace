export type GroupManualAccessContext = {
  sourceId: number;
  sourceStatus: 'ACTIVE' | 'INACTIVE';
  actorIsActiveMember: boolean;
};

export interface WorklogCollaborationRepository {
  getGroupManualAccessContext(
    sourceId: number,
    actorUserId: number,
  ): Promise<GroupManualAccessContext | null>;
}

export type GroupAccessAuthorizationResult =
  | { status: 'OK'; actorUserId: number }
  | { status: 'GROUP_NOT_FOUND' | 'GROUP_INACTIVE' | 'NOT_ACTIVE_MEMBER' };

/**
 * Free/manual GROUP authorization only.
 *
 * Group data existence and manual access are independent from subscription, plan,
 * AI points and AI 額度負責人. AI authorization belongs to ai-responsibility.ts.
 */
export class WorklogCollaborationService {
  constructor(private readonly repository: WorklogCollaborationRepository) {}

  async authorizeGroupAccess(input: {
    sourceId: number;
    actorUserId: number;
  }): Promise<GroupAccessAuthorizationResult> {
    const context = await this.repository.getGroupManualAccessContext(
      input.sourceId,
      input.actorUserId,
    );
    if (!context) return { status: 'GROUP_NOT_FOUND' };
    if (context.sourceStatus !== 'ACTIVE') return { status: 'GROUP_INACTIVE' };
    if (!context.actorIsActiveMember) return { status: 'NOT_ACTIVE_MEMBER' };
    return { status: 'OK', actorUserId: input.actorUserId };
  }
}
