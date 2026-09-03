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
  ensureGroupSource(lineGroupId: string, workspaceId: number, at: Date): Promise<WorklogBoundGroup>;
  reactivateBoundGroup(sourceId: number, at: Date): Promise<boolean>;
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

/**
 * GROUP Source existence is independent from AI funding. A group becomes a durable
 * Source as soon as a known member interacts; ownerUserId may remain null indefinitely.
 * Manual PWA access is authorized by Source membership elsewhere, not by this legacy
 * owner field. The field remains transitional only until the grant/responsible-user
 * schema replaces it.
 */
export type GroupBootstrapResult = {
  status: 'BOUND';
  userId: number;
  sourceId: number;
  ownerUserId: number | null;
};

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

    let group = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (!group) {
      // workspace_id is still a non-null legacy column. Use the first observed member's
      // workspace only as a temporary storage parent; it is NOT authorization or data
      // ownership. The final Source schema batch removes this accidental coupling.
      const storageWorkspaceId = await this.repository.ensureWorkspace(user.userId, at);
      group = await this.repository.ensureGroupSource(lineGroupId, storageWorkspaceId, at);
    } else if (group.status === 'INACTIVE') {
      const reactivated = await this.repository.reactivateBoundGroup(group.sourceId, at);
      if (reactivated) group = { ...group, status: 'ACTIVE' };
      else {
        // A newer lifecycle event may legitimately win. Re-read rather than treating
        // an older delayed interaction as authority to reactivate the Source.
        const refreshed = await this.repository.findBoundGroupByLineId(lineGroupId);
        if (refreshed) group = refreshed;
      }
    }

    await this.repository.upsertBoundGroupMember(group.sourceId, user.userId, true, at);
    return {
      status: 'BOUND',
      userId: user.userId,
      sourceId: group.sourceId,
      ownerUserId: group.ownerUserId,
    };
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

    let group = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (!group) {
      const storageWorkspaceId = await this.repository.ensureWorkspace(user.userId, at);
      group = await this.repository.ensureGroupSource(lineGroupId, storageWorkspaceId, at);
    } else if (input.isActive && group.status === 'INACTIVE') {
      const reactivated = await this.repository.reactivateBoundGroup(group.sourceId, at);
      if (reactivated) group = { ...group, status: 'ACTIVE' };
    }

    await this.repository.upsertBoundGroupMember(group.sourceId, user.userId, input.isActive, at);
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
    if (existing?.ownerUserId === owner.userId) {
      await this.repository.upsertBoundGroupMember(existing.sourceId, owner.userId, true, at);
      return { status: 'ALREADY_BOUND', sourceId: existing.sourceId, ownerUserId: owner.userId };
    }

    // Ensure the data Source exists before assigning AI funding responsibility. This
    // keeps manual group history available even when no responsible user is configured.
    if (!existing) {
      const storageWorkspaceId = await this.repository.ensureWorkspace(owner.userId, at);
      await this.repository.ensureGroupSource(lineGroupId, storageWorkspaceId, at);
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
        throw new Error('group AI responsible-user binding failed without a winning user');
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
