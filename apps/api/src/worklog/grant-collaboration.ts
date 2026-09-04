import type { GroupAiAuthorizationResult, WorklogAiResponsibilityService } from './ai-responsibility';
import type { GroupAccessAuthorizationResult, WorklogCollaborationService } from './collaboration';

/**
 * GROUP manual access and GROUP AI funding share one runtime adapter but stay separate
 * domains. Manual access delegates only to active membership. AI delegates only to
 * AI 額度負責人 + explicitly scoped positive Grants.
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

  authorizeGroupAi(input: {
    sourceId: number;
    actorUserId: number;
    at?: Date;
  }): Promise<GroupAiAuthorizationResult> {
    return this.responsibility.authorizeGroupAi(input);
  }
}
