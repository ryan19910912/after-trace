import {
  canConsumeAiUnits,
  parsePlanCapabilities,
  type PlanCapabilities,
} from './entitlements';
import type { WorklogSubscriptionStatus } from './subscription';

export type GroupAuthorizationContext = {
  sourceId: number;
  sourceStatus: 'ACTIVE' | 'INACTIVE';
  ownerUserId: number | null;
  ownerIsActiveMember: boolean;
  actorIsActiveMember: boolean;
  actorRecordingEnabled: boolean;
  ownerPlanCode: string | null;
  ownerPlanDisplayName?: string | null;
  ownerSubscriptionStatus: WorklogSubscriptionStatus | null;
  ownerEffectiveAt: Date | null;
  ownerPeriodStart: Date | null;
  ownerPeriodEnd: Date | null;
  ownerPlanEnabled: boolean;
  ownerCapabilities: unknown;
  ownerAllowanceUnits: number;
  ownerConsumedUnits: number;
};

export interface WorklogCollaborationRepository {
  getGroupAuthorizationContext(
    sourceId: number,
    actorUserId: number,
  ): Promise<GroupAuthorizationContext | null>;
  getGroupOwnerUserId(sourceId: number): Promise<number | null>;
  isActiveGroupMember(sourceId: number, userId: number): Promise<boolean>;
  setMemberRecordingEnabled(
    sourceId: number,
    memberUserId: number,
    enabled: boolean,
    updatedByUserId: number,
  ): Promise<void>;
  bindGroupOwnerIfUnbound(
    sourceId: number,
    ownerUserId: number,
    bindingMethod: string,
  ): Promise<boolean>;
}

type GroupAuthorizationFailureStatus =
  | 'GROUP_NOT_FOUND'
  | 'GROUP_INACTIVE'
  | 'OWNER_UNBOUND'
  | 'OWNER_ABSENT'
  | 'NOT_ACTIVE_MEMBER'
  | 'GROUP_NOT_ENTITLED';

type GroupAuthorizationFailure = {
  status: GroupAuthorizationFailureStatus;
  ownerPlanDisplayName?: string;
};

export type GroupAccessAuthorizationResult =
  | {
      status: 'OK';
      actorUserId: number;
      ownerUserId: number;
      ownerPlanCode: string;
      ownerCapabilities: PlanCapabilities;
    }
  | GroupAuthorizationFailure;

export type GroupRecordAuthorizationResult =
  | {
      status: 'OK';
      actorUserId: number;
      chargedUserId: number;
      ownerPlanCode: string;
      ownerCapabilities: PlanCapabilities;
      remainingAiUnits: number;
    }
  | GroupAuthorizationFailure
  | { status: 'RECORDING_DISABLED' | 'AI_QUOTA_EXHAUSTED' };

export type RecordingPermissionChangeResult =
  | { status: 'UPDATED' }
  | { status: 'FORBIDDEN' | 'MEMBER_NOT_FOUND' | 'OWNER_CANNOT_BE_DISABLED' | 'OWNER_UNBOUND' };

export type OwnerBindingResult =
  | { status: 'BOUND'; ownerUserId: number }
  | { status: 'ALREADY_BOUND'; ownerUserId: number }
  | { status: 'OWNER_CONFLICT'; ownerUserId: number }
  | { status: 'GROUP_NOT_FOUND' };

export class WorklogCollaborationService {
  constructor(private readonly repository: WorklogCollaborationRepository) {}

  async authorizeGroupAccess(input: {
    sourceId: number;
    actorUserId: number;
    at?: Date;
  }): Promise<GroupAccessAuthorizationResult> {
    const context = await this.repository.getGroupAuthorizationContext(
      input.sourceId,
      input.actorUserId,
    );
    if (!context) return { status: 'GROUP_NOT_FOUND' };
    if (context.sourceStatus !== 'ACTIVE') return { status: 'GROUP_INACTIVE' };
    if (context.ownerUserId === null) return { status: 'OWNER_UNBOUND' };
    if (!context.ownerIsActiveMember) return { status: 'OWNER_ABSENT' };
    if (!context.actorIsActiveMember) return { status: 'NOT_ACTIVE_MEMBER' };

    const entitlement = groupEntitlement(context, input.at ?? new Date());
    if (entitlement.status !== 'OK') return entitlement;

    return {
      status: 'OK',
      actorUserId: input.actorUserId,
      ownerUserId: context.ownerUserId,
      ownerPlanCode: entitlement.planCode,
      ownerCapabilities: entitlement.capabilities,
    };
  }

  async authorizeGroupRecord(input: {
    sourceId: number;
    actorUserId: number;
    requestedAiUnits?: number;
    at?: Date;
  }): Promise<GroupRecordAuthorizationResult> {
    const context = await this.repository.getGroupAuthorizationContext(
      input.sourceId,
      input.actorUserId,
    );
    if (!context) return { status: 'GROUP_NOT_FOUND' };
    if (context.sourceStatus !== 'ACTIVE') return { status: 'GROUP_INACTIVE' };
    if (context.ownerUserId === null) return { status: 'OWNER_UNBOUND' };
    if (!context.ownerIsActiveMember) return { status: 'OWNER_ABSENT' };
    if (!context.actorIsActiveMember) return { status: 'NOT_ACTIVE_MEMBER' };

    const isOwner = context.ownerUserId === input.actorUserId;
    if (!isOwner && !context.actorRecordingEnabled) {
      return { status: 'RECORDING_DISABLED' };
    }

    const entitlement = groupEntitlement(context, input.at ?? new Date());
    if (entitlement.status !== 'OK') return entitlement;

    const allowance = nonNegativeInteger(context.ownerAllowanceUnits);
    const consumed = nonNegativeInteger(context.ownerConsumedUnits);
    const requested = nonNegativeInteger(input.requestedAiUnits ?? 1);
    const remaining = Math.max(0, allowance - consumed);
    if (requested > 0 && !canConsumeAiUnits(allowance, consumed, requested)) {
      return { status: 'AI_QUOTA_EXHAUSTED' };
    }

    return {
      status: 'OK',
      actorUserId: input.actorUserId,
      chargedUserId: context.ownerUserId,
      ownerPlanCode: entitlement.planCode,
      ownerCapabilities: entitlement.capabilities,
      remainingAiUnits: Math.max(0, remaining - requested),
    };
  }

  async setMemberRecordingPermission(input: {
    sourceId: number;
    actorUserId: number;
    memberUserId: number;
    enabled: boolean;
  }): Promise<RecordingPermissionChangeResult> {
    const ownerUserId = await this.repository.getGroupOwnerUserId(input.sourceId);
    if (ownerUserId === null) return { status: 'OWNER_UNBOUND' };
    if (ownerUserId !== input.actorUserId) return { status: 'FORBIDDEN' };
    if (input.memberUserId === ownerUserId && !input.enabled) {
      return { status: 'OWNER_CANNOT_BE_DISABLED' };
    }
    if (!(await this.repository.isActiveGroupMember(input.sourceId, input.memberUserId))) {
      return { status: 'MEMBER_NOT_FOUND' };
    }

    await this.repository.setMemberRecordingEnabled(
      input.sourceId,
      input.memberUserId,
      input.enabled,
      input.actorUserId,
    );
    return { status: 'UPDATED' };
  }

  async bindGroupOwner(input: {
    sourceId: number;
    ownerUserId: number;
    bindingMethod: string;
  }): Promise<OwnerBindingResult> {
    const currentOwner = await this.repository.getGroupOwnerUserId(input.sourceId);
    if (currentOwner !== null) {
      return currentOwner === input.ownerUserId
        ? { status: 'ALREADY_BOUND', ownerUserId: currentOwner }
        : { status: 'OWNER_CONFLICT', ownerUserId: currentOwner };
    }

    const bound = await this.repository.bindGroupOwnerIfUnbound(
      input.sourceId,
      input.ownerUserId,
      normalizeBindingMethod(input.bindingMethod),
    );
    if (bound) return { status: 'BOUND', ownerUserId: input.ownerUserId };

    const winner = await this.repository.getGroupOwnerUserId(input.sourceId);
    if (winner === null) return { status: 'GROUP_NOT_FOUND' };
    return winner === input.ownerUserId
      ? { status: 'ALREADY_BOUND', ownerUserId: winner }
      : { status: 'OWNER_CONFLICT', ownerUserId: winner };
  }
}

type GroupEntitlementResult =
  | { status: 'OK'; planCode: string; capabilities: PlanCapabilities }
  | GroupAuthorizationFailure;

function groupEntitlement(
  context: GroupAuthorizationContext,
  at: Date,
): GroupEntitlementResult {
  const atMs = at.getTime();
  if (!Number.isFinite(atMs)) throw new Error('group entitlement time must be valid');
  if (context.ownerSubscriptionStatus !== 'ACTIVE' || !context.ownerPlanEnabled) {
    return notEntitled(context);
  }
  if (!context.ownerEffectiveAt || !context.ownerPeriodStart) return notEntitled(context);
  if (atMs < context.ownerEffectiveAt.getTime() || atMs < context.ownerPeriodStart.getTime()) {
    return notEntitled(context);
  }
  if (context.ownerPeriodEnd && atMs >= context.ownerPeriodEnd.getTime()) return notEntitled(context);

  const planCode = context.ownerPlanCode ?? 'FREE';
  const capabilities = parsePlanCapabilities(context.ownerCapabilities);
  return { status: 'OK', planCode, capabilities };
}

function notEntitled(context: GroupAuthorizationContext): GroupAuthorizationFailure {
  const displayName = planDisplayName(context);
  return {
    status: 'GROUP_NOT_ENTITLED',
    ...(displayName ? { ownerPlanDisplayName: displayName } : {}),
  };
}

function planDisplayName(context: GroupAuthorizationContext): string | undefined {
  const displayName = context.ownerPlanDisplayName?.trim();
  if (displayName) return displayName;
  const code = context.ownerPlanCode?.trim();
  return code || undefined;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) throw new Error('group AI quota value must be finite');
  return Math.max(0, Math.floor(value));
}

function normalizeBindingMethod(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return normalized.slice(0, 64) || 'UNKNOWN';
}
