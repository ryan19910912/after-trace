import type { WorklogAiGrantService } from './ai-grants';

export type WorklogGroupAiContext = {
  sourceId: number;
  sourceStatus: 'ACTIVE' | 'INACTIVE';
  actorIsActiveMember: boolean;
  responsibleUserId: number | null;
  responsibleUserIsActiveMember: boolean;
};

export interface WorklogAiResponsibilityRepository {
  getGroupAiContext(sourceId: number, actorUserId: number): Promise<WorklogGroupAiContext | null>;
  assignIfUnbound(input: {
    sourceId: number;
    responsibleUserId: number;
    actorUserId: number;
    reason: string;
    at: Date;
  }): Promise<'ASSIGNED' | 'ALREADY_ASSIGNED' | 'CONFLICT' | 'SOURCE_NOT_FOUND' | 'ACTOR_NOT_ACTIVE'>;
}

export type GroupAiAuthorizationResult =
  | { status: 'OK'; actorUserId: number; chargedUserId: number }
  | {
      status:
        | 'GROUP_NOT_FOUND'
        | 'GROUP_INACTIVE'
        | 'NOT_ACTIVE_MEMBER'
        | 'AI_RESPONSIBLE_USER_UNBOUND'
        | 'AI_RESPONSIBLE_USER_ABSENT'
        | 'AI_POINTS_EXHAUSTED';
    };

export type GroupAiResponsibilityClaimResult =
  | { status: 'BOUND' | 'ALREADY_BOUND'; sourceId: number; responsibleUserId: number }
  | { status: 'CONFLICT'; sourceId: number }
  | { status: 'GROUP_NOT_FOUND' | 'NOT_ACTIVE_MEMBER'; sourceId: number };

/**
 * GROUP data access and GROUP AI funding are deliberately separate domains.
 *
 * Manual PWA access never calls this service. AI may start only when the actor is an
 * active member, a current AI 額度負責人 exists and remains an active member, and that
 * responsible user owns at least one positive grant explicitly scoped to this Source.
 */
export class WorklogAiResponsibilityService {
  constructor(
    private readonly repository: WorklogAiResponsibilityRepository,
    private readonly grants: Pick<WorklogAiGrantService, 'canStartAi'>,
  ) {}

  async authorizeGroupAi(input: {
    sourceId: number;
    actorUserId: number;
    at?: Date;
  }): Promise<GroupAiAuthorizationResult> {
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const at = validDate(input.at ?? new Date(), 'at');
    const context = await this.repository.getGroupAiContext(sourceId, actorUserId);
    if (!context) return { status: 'GROUP_NOT_FOUND' };
    if (context.sourceStatus !== 'ACTIVE') return { status: 'GROUP_INACTIVE' };
    if (!context.actorIsActiveMember) return { status: 'NOT_ACTIVE_MEMBER' };
    if (context.responsibleUserId === null) return { status: 'AI_RESPONSIBLE_USER_UNBOUND' };
    if (!context.responsibleUserIsActiveMember) return { status: 'AI_RESPONSIBLE_USER_ABSENT' };

    const eligible = await this.grants.canStartAi({
      userId: context.responsibleUserId,
      sourceId,
      at,
    });
    if (!eligible.allowed) return { status: 'AI_POINTS_EXHAUSTED' };
    return { status: 'OK', actorUserId, chargedUserId: context.responsibleUserId };
  }

  async claim(input: {
    sourceId: number;
    actorUserId: number;
    reason?: string;
    at?: Date;
  }): Promise<GroupAiResponsibilityClaimResult> {
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const result = await this.repository.assignIfUnbound({
      sourceId,
      responsibleUserId: actorUserId,
      actorUserId,
      reason: normalizeReason(input.reason ?? 'EXPLICIT_CLAIM'),
      at: validDate(input.at ?? new Date(), 'at'),
    });
    if (result === 'ASSIGNED') return { status: 'BOUND', sourceId, responsibleUserId: actorUserId };
    if (result === 'ALREADY_ASSIGNED') return { status: 'ALREADY_BOUND', sourceId, responsibleUserId: actorUserId };
    if (result === 'CONFLICT') return { status: 'CONFLICT', sourceId };
    if (result === 'ACTOR_NOT_ACTIVE') return { status: 'NOT_ACTIVE_MEMBER', sourceId };
    return { status: 'GROUP_NOT_FOUND', sourceId };
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}

function normalizeReason(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return (normalized || 'UNKNOWN').slice(0, 64);
}
