export type WorklogBootstrapUser = {
  userId: number;
  lineUserId: string;
  isOaFriend: boolean;
};

export type WorklogBoundGroup = {
  sourceId: number;
  lineGroupId: string;
  workspaceId: number;
  ownerUserId: number | null;
  status: 'ACTIVE' | 'INACTIVE';
};

export type WorklogPendingGroup = {
  pendingGroupId: number;
  lineGroupId: string;
  isActive: boolean;
  promotedSourceId: number | null;
};

export interface WorklogBootstrapRepository {
  upsertLineUser(input: {
    lineUserId: string;
    displayName: string | null;
    at: Date;
  }): Promise<WorklogBootstrapUser>;
  setOaFriendState(userId: number, isOaFriend: boolean, at: Date): Promise<void>;
  ensureWorkspace(ownerUserId: number, at: Date): Promise<number>;
  ensurePrivateSource(userId: number, workspaceId: number, at: Date): Promise<number>;
  findBoundGroupByLineId(lineGroupId: string): Promise<WorklogBoundGroup | null>;
  reactivateBoundGroup(sourceId: number, at: Date): Promise<boolean>;
  upsertPendingGroup(lineGroupId: string, at: Date): Promise<WorklogPendingGroup>;
  upsertPendingGroupMember(
    pendingGroupId: number,
    userId: number,
    isActive: boolean,
    at: Date,
  ): Promise<void>;
  upsertBoundGroupMember(sourceId: number, userId: number, isActive: boolean, at: Date): Promise<void>;
  markGroupInactive(lineGroupId: string, at: Date): Promise<void>;
  promoteGroup(input: {
    lineGroupId: string;
    ownerUserId: number;
    workspaceId: number;
    bindingMethod: string;
    at: Date;
  }): Promise<WorklogBoundGroup | null>;
}

export type PrivateBootstrapResult =
  | { status: 'READY'; userId: number; workspaceId: number; sourceId: number }
  | { status: 'NOT_OA_FRIEND'; userId: number };

export type GroupBootstrapResult =
  | { status: 'BOUND'; userId: number; sourceId: number; ownerUserId: number | null }
  | { status: 'PENDING_OWNER'; userId: number; pendingGroupId: number };

export type GroupOwnerBindResult =
  | { status: 'BOUND'; sourceId: number; ownerUserId: number }
  | { status: 'ALREADY_BOUND'; sourceId: number; ownerUserId: number }
  | { status: 'OWNER_CONFLICT'; sourceId: number; ownerUserId: number };

export class WorklogBootstrapService {
  constructor(private readonly repository: WorklogBootstrapRepository) {}

  async handleOaFollow(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<{ userId: number; workspaceId: number; sourceId: number }> {
    const at = input.at ?? new Date();
    const user = await this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.lineUserId, 'LINE user id'),
      displayName: normalizeDisplayName(input.displayName),
      at,
    });
    await this.repository.setOaFriendState(user.userId, true, at);
    const workspaceId = await this.repository.ensureWorkspace(user.userId, at);
    const sourceId = await this.repository.ensurePrivateSource(user.userId, workspaceId, at);
    return { userId: user.userId, workspaceId, sourceId };
  }

  async handleOaUnfollow(input: { lineUserId: string; at?: Date }): Promise<{ userId: number }> {
    const at = input.at ?? new Date();
    const user = await this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.lineUserId, 'LINE user id'),
      displayName: null,
      at,
    });
    await this.repository.setOaFriendState(user.userId, false, at);
    return { userId: user.userId };
  }

  async touchPrivateInteraction(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<WorklogBootstrapUser> {
    return this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.lineUserId, 'LINE user id'),
      displayName: normalizeDisplayName(input.displayName),
      at: input.at ?? new Date(),
    });
  }

  async bootstrapPrivateInteraction(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<PrivateBootstrapResult> {
    const at = input.at ?? new Date();
    const user = await this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.lineUserId, 'LINE user id'),
      displayName: normalizeDisplayName(input.displayName),
      at,
    });
    if (!user.isOaFriend) return { status: 'NOT_OA_FRIEND', userId: user.userId };

    const workspaceId = await this.repository.ensureWorkspace(user.userId, at);
    const sourceId = await this.repository.ensurePrivateSource(user.userId, workspaceId, at);
    return { status: 'READY', userId: user.userId, workspaceId, sourceId };
  }

  async bootstrapGroupInteraction(input: {
    lineGroupId: string;
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<GroupBootstrapResult> {
    const at = input.at ?? new Date();
    const lineGroupId = normalizeLineId(input.lineGroupId, 'LINE group id');
    const user = await this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.lineUserId, 'LINE user id'),
      displayName: normalizeDisplayName(input.displayName),
      at,
    });

    const bound = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (bound) {
      if (bound.status === 'INACTIVE') {
        const reactivated = await this.repository.reactivateBoundGroup(bound.sourceId, at);
        if (!reactivated) throw new Error('failed to reactivate known Worklog group');
      }
      await this.repository.upsertBoundGroupMember(bound.sourceId, user.userId, true, at);
      return {
        status: 'BOUND',
        userId: user.userId,
        sourceId: bound.sourceId,
        ownerUserId: bound.ownerUserId,
      };
    }

    const pending = await this.repository.upsertPendingGroup(lineGroupId, at);
    await this.repository.upsertPendingGroupMember(pending.pendingGroupId, user.userId, true, at);
    return { status: 'PENDING_OWNER', userId: user.userId, pendingGroupId: pending.pendingGroupId };
  }

  async setGroupMemberPresence(input: {
    lineGroupId: string;
    lineUserId: string;
    displayName?: string | null;
    isActive: boolean;
    at?: Date;
  }): Promise<void> {
    const at = input.at ?? new Date();
    const lineGroupId = normalizeLineId(input.lineGroupId, 'LINE group id');
    const user = await this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.lineUserId, 'LINE user id'),
      displayName: normalizeDisplayName(input.displayName),
      at,
    });

    const bound = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (bound) {
      if (input.isActive && bound.status === 'INACTIVE') {
        const reactivated = await this.repository.reactivateBoundGroup(bound.sourceId, at);
        if (!reactivated) throw new Error('failed to reactivate known Worklog group');
      }
      await this.repository.upsertBoundGroupMember(bound.sourceId, user.userId, input.isActive, at);
      return;
    }

    const pending = await this.repository.upsertPendingGroup(lineGroupId, at);
    await this.repository.upsertPendingGroupMember(
      pending.pendingGroupId,
      user.userId,
      input.isActive,
      at,
    );
  }

  async handleGroupLeave(input: { lineGroupId: string; at?: Date }): Promise<void> {
    await this.repository.markGroupInactive(
      normalizeLineId(input.lineGroupId, 'LINE group id'),
      input.at ?? new Date(),
    );
  }

  async bindGroupOwner(input: {
    lineGroupId: string;
    ownerLineUserId: string;
    ownerDisplayName?: string | null;
    evidence: 'RELIABLE_JOIN_ACTOR' | 'EXPLICIT_CLAIM';
    at?: Date;
  }): Promise<GroupOwnerBindResult> {
    const at = input.at ?? new Date();
    const lineGroupId = normalizeLineId(input.lineGroupId, 'LINE group id');
    const owner = await this.repository.upsertLineUser({
      lineUserId: normalizeLineId(input.ownerLineUserId, 'LINE user id'),
      displayName: normalizeDisplayName(input.ownerDisplayName),
      at,
    });

    const existing = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (existing?.ownerUserId !== null && existing?.ownerUserId !== undefined) {
      return existing.ownerUserId === owner.userId
        ? { status: 'ALREADY_BOUND', sourceId: existing.sourceId, ownerUserId: owner.userId }
        : {
            status: 'OWNER_CONFLICT',
            sourceId: existing.sourceId,
            ownerUserId: existing.ownerUserId,
          };
    }

    const workspaceId = await this.repository.ensureWorkspace(owner.userId, at);
    const promoted = await this.repository.promoteGroup({
      lineGroupId,
      ownerUserId: owner.userId,
      workspaceId,
      bindingMethod: input.evidence,
      at,
    });

    if (!promoted) {
      const winner = await this.repository.findBoundGroupByLineId(lineGroupId);
      if (!winner || winner.ownerUserId === null) {
        throw new Error('group owner binding failed without a winning owner');
      }
      return winner.ownerUserId === owner.userId
        ? { status: 'ALREADY_BOUND', sourceId: winner.sourceId, ownerUserId: owner.userId }
        : { status: 'OWNER_CONFLICT', sourceId: winner.sourceId, ownerUserId: winner.ownerUserId };
    }

    if (promoted.ownerUserId !== owner.userId) {
      return {
        status: 'OWNER_CONFLICT',
        sourceId: promoted.sourceId,
        ownerUserId: promoted.ownerUserId ?? owner.userId,
      };
    }

    await this.repository.upsertBoundGroupMember(promoted.sourceId, owner.userId, true, at);
    return { status: 'BOUND', sourceId: promoted.sourceId, ownerUserId: owner.userId };
  }
}

function normalizeLineId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 64) throw new Error(`${label} is too long`);
  return normalized;
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 255) : null;
}
