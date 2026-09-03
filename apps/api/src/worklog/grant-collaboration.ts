import type {
  GroupAccessAuthorizationResult,
  GroupRecordAuthorizationResult,
  WorklogCollaborationService,
} from './collaboration';
import type { WorklogAiResponsibilityService } from './ai-responsibility';

/**
 * Transitional adapter for the existing LINE runtime shape.
 *
 * Manual access remains delegated to the manual collaboration service. AI access is
 * now authoritative from AI 額度負責人 + scoped grant balance. The legacy plan fields
 * in the success result are compatibility-only and are deliberately not used as a
 * paid group gate; they can disappear when the LINE runtime contract is simplified.
 */
export class WorklogGrantBackedCollaboration {
  constructor(
    private readonly manual: Pick<WorklogCollaborationService, 'authorizeGroupAccess'>,
    private readonly responsibility: Pick<WorklogAiResponsibilityService, 'authorizeGroupAi'>,
  ) {}

  authorizeGroupAccess(input: {
    sourceId: number;
    actorUserId: number;
  }): Promise<GroupAccessAuthorizationResult> {
    return this.manual.authorizeGroupAccess(input);
  }

  async authorizeGroupRecord(input: {
    sourceId: number;
    actorUserId: number;
    requestedAiUnits?: number;
  }): Promise<GroupRecordAuthorizationResult> {
    const result = await this.responsibility.authorizeGroupAi({
      sourceId: input.sourceId,
      actorUserId: input.actorUserId,
    });
    if (result.status === 'OK') {
      return {
        status: 'OK',
        actorUserId: result.actorUserId,
        chargedUserId: result.chargedUserId,
        ownerPlanCode: 'GRANT',
        ownerCapabilities: {
          aiTextRecording: true,
          aiMediaIngestion: true,
        },
        remainingAiUnits: 1,
      };
    }
    if (result.status === 'AI_RESPONSIBLE_USER_UNBOUND') return { status: 'OWNER_UNBOUND' };
    if (result.status === 'AI_RESPONSIBLE_USER_ABSENT') return { status: 'OWNER_ABSENT' };
    if (result.status === 'AI_POINTS_EXHAUSTED') return { status: 'AI_QUOTA_EXHAUSTED' };
    return { status: result.status };
  }
}
