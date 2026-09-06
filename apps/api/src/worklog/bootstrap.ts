export type WorklogBootstrapUser = {
  userId: number;
  lineUserId: string;
  displayName: string | null;
  isOaFriend: boolean;
};

export type WorklogBoundGroup = {
  sourceId: number;
  lineGroupId: string;
  workspaceId: number;
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
}

export interface WorklogInitialGrantPort {
  ensureInitialFreeGrant(input: {
    userId: number;
    privateSourceId: number;
    at?: Date;
  }): Promise<unknown>;
}

export interface WorklogAiResponsibilityClaimPort {
  claim(input: {
    sourceId: number;
    actorUserId: number;
    reason?: string;
    at?: Date;
  }): Promise<
    | { status: 'BOUND' | 'ALREADY_BOUND'; sourceId: number; responsibleUserId: number }
    | { status: 'CONFLICT'; sourceId: number }
    | { status: 'GROUP_NOT_FOUND' | 'NOT_ACTIVE_MEMBER'; sourceId: number }
  >;
}

export interface WorklogLineUserProfilePort {
  getUserProfile(lineUserId: string): Promise<{ displayName: string } | null>;
  getGroupMemberProfile(lineGroupId: string, lineUserId: string): Promise<{ displayName: string } | null>;
}

export type PrivateBootstrapResult = {
  status: 'READY';
  userId: number;
  workspaceId: number;
  sourceId: number;
};

/** GROUP Source existence is independent from AI funding responsibility. */
export type GroupBootstrapResult = {
  status: 'BOUND';
  userId: number;
  sourceId: number;
};

export type GroupAiResponsibilityBindResult =
  | { status: 'BOUND'; sourceId: number; responsibleUserId: number }
  | { status: 'ALREADY_BOUND'; sourceId: number; responsibleUserId: number }
  | { status: 'RESPONSIBILITY_CONFLICT'; sourceId: number };

export class WorklogBootstrapService {
  constructor(
    private readonly repository: WorklogBootstrapRepository,
    private readonly initialGrants?: WorklogInitialGrantPort,
    private readonly aiResponsibility?: WorklogAiResponsibilityClaimPort,
    private readonly lineProfiles?: WorklogLineUserProfilePort,
  ) {}

  async handleOaFollow(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<{ userId: number; workspaceId: number; sourceId: number }> {
    const at = input.at ?? new Date();
    const user = await this.upsertPrivateUser(input.lineUserId, input.displayName, at);
    await this.repository.setOaFriendState(user.userId, true, at);
    const workspaceId = await this.repository.ensureWorkspace(user.userId, at);
    const sourceId = await this.repository.ensurePrivateSource(user.userId, workspaceId, at);
    await this.ensureInitialGrant(user.userId, sourceId, at);
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
    return this.upsertPrivateUser(input.lineUserId, input.displayName, input.at ?? new Date());
  }

  /**
   * A delivered LINE private-message webhook is its own trusted entry surface.
   * OA friendship remains lifecycle/analytics state only and never gates PRIVATE Source bootstrap.
   */
  async bootstrapPrivateInteraction(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<PrivateBootstrapResult> {
    const at = input.at ?? new Date();
    const user = await this.upsertPrivateUser(input.lineUserId, input.displayName, at);
    const workspaceId = await this.repository.ensureWorkspace(user.userId, at);
    const sourceId = await this.repository.ensurePrivateSource(user.userId, workspaceId, at);
    await this.ensureInitialGrant(user.userId, sourceId, at);
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
    const user = await this.upsertGroupUser(lineGroupId, input.lineUserId, input.displayName, at);

    let group = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (!group) {
      // workspace_id remains a transitional storage parent only. GROUP authorization
      // is membership-based and GROUP AI funding is stored in responsibility + grants.
      const storageWorkspaceId = await this.repository.ensureWorkspace(user.userId, at);
      group = await this.repository.ensureGroupSource(lineGroupId, storageWorkspaceId, at);
    } else if (group.status === 'INACTIVE') {
      const reactivated = await this.repository.reactivateBoundGroup(group.sourceId, at);
      if (reactivated) group = { ...group, status: 'ACTIVE' };
      else {
        const refreshed = await this.repository.findBoundGroupByLineId(lineGroupId);
        if (refreshed) group = refreshed;
      }
    }

    await this.repository.upsertBoundGroupMember(group.sourceId, user.userId, true, at);
    return { status: 'BOUND', userId: user.userId, sourceId: group.sourceId };
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
    const user = await this.upsertGroupUser(lineGroupId, input.lineUserId, input.displayName, at);

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

  async claimGroupAiResponsibility(input: {
    lineGroupId: string;
    lineUserId: string;
    displayName?: string | null;
    evidence: 'RELIABLE_JOIN_ACTOR' | 'EXPLICIT_CLAIM';
    at?: Date;
  }): Promise<GroupAiResponsibilityBindResult> {
    if (!this.aiResponsibility) throw new Error('group AI responsibility service is not configured');

    const at = input.at ?? new Date();
    const lineGroupId = normalizeLineId(input.lineGroupId, 'LINE group id');
    const user = await this.upsertGroupUser(lineGroupId, input.lineUserId, input.displayName, at);

    let group = await this.repository.findBoundGroupByLineId(lineGroupId);
    if (!group) {
      const storageWorkspaceId = await this.repository.ensureWorkspace(user.userId, at);
      group = await this.repository.ensureGroupSource(lineGroupId, storageWorkspaceId, at);
    }
    await this.repository.upsertBoundGroupMember(group.sourceId, user.userId, true, at);

    const claimed = await this.aiResponsibility.claim({
      sourceId: group.sourceId,
      actorUserId: user.userId,
      reason: input.evidence,
      at,
    });
    if (claimed.status === 'BOUND') {
      return { status: 'BOUND', sourceId: group.sourceId, responsibleUserId: user.userId };
    }
    if (claimed.status === 'ALREADY_BOUND') {
      return { status: 'ALREADY_BOUND', sourceId: group.sourceId, responsibleUserId: user.userId };
    }
    if (claimed.status === 'CONFLICT') {
      return { status: 'RESPONSIBILITY_CONFLICT', sourceId: group.sourceId };
    }
    throw new Error(`group AI responsibility claim failed: ${claimed.status}`);
  }

  private async upsertPrivateUser(lineUserIdRaw: string, displayNameRaw: string | null | undefined, at: Date): Promise<WorklogBootstrapUser> {
    const lineUserId = normalizeLineId(lineUserIdRaw, 'LINE user id');
    const directName = normalizeDisplayName(displayNameRaw);
    let user = await this.repository.upsertLineUser({ lineUserId, displayName: directName, at });
    if (directName || user.displayName || !this.lineProfiles) return user;
    try {
      const profile = await this.lineProfiles.getUserProfile(lineUserId);
      const resolved = normalizeDisplayName(profile?.displayName);
      if (resolved) user = await this.repository.upsertLineUser({ lineUserId, displayName: resolved, at });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'worklog_line_private_profile_refresh_failed', lineUserId, message: error instanceof Error ? error.message : 'unknown error' }));
    }
    return user;
  }

  private async upsertGroupUser(lineGroupId: string, lineUserIdRaw: string, displayNameRaw: string | null | undefined, at: Date): Promise<WorklogBootstrapUser> {
    const lineUserId = normalizeLineId(lineUserIdRaw, 'LINE user id');
    const directName = normalizeDisplayName(displayNameRaw);
    let user = await this.repository.upsertLineUser({ lineUserId, displayName: directName, at });
    if (directName || user.displayName || !this.lineProfiles) return user;
    try {
      const profile = await this.lineProfiles.getGroupMemberProfile(lineGroupId, lineUserId);
      const resolved = normalizeDisplayName(profile?.displayName);
      if (resolved) user = await this.repository.upsertLineUser({ lineUserId, displayName: resolved, at });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'worklog_line_group_member_profile_refresh_failed', lineGroupId, lineUserId, message: error instanceof Error ? error.message : 'unknown error' }));
    }
    return user;
  }

  private async ensureInitialGrant(userId: number, privateSourceId: number, at: Date): Promise<void> {
    if (!this.initialGrants) return;
    await this.initialGrants.ensureInitialFreeGrant({ userId, privateSourceId, at });
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
