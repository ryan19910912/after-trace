import { describe, expect, it } from 'vitest';
import {
  WorklogCollaborationService,
  type GroupAuthorizationContext,
  type GroupManualAccessContext,
  type WorklogCollaborationRepository,
} from './collaboration';

class FakeRepository implements WorklogCollaborationRepository {
  manualContext: GroupManualAccessContext | null = null;
  context: GroupAuthorizationContext | null = null;
  owners = new Map<number, number | null>();
  activeMembers = new Set<string>();
  permissionWrites: Array<{
    sourceId: number;
    memberUserId: number;
    enabled: boolean;
    updatedByUserId: number;
  }> = [];
  bindSucceeds = true;

  async getGroupManualAccessContext() { return this.manualContext; }
  async getGroupAuthorizationContext() { return this.context; }
  async getGroupOwnerUserId(sourceId: number) { return this.owners.get(sourceId) ?? null; }
  async isActiveGroupMember(sourceId: number, userId: number) { return this.activeMembers.has(`${sourceId}:${userId}`); }
  async setMemberRecordingEnabled(sourceId: number, memberUserId: number, enabled: boolean, updatedByUserId: number) {
    this.permissionWrites.push({ sourceId, memberUserId, enabled, updatedByUserId });
  }
  async bindGroupOwnerIfUnbound(sourceId: number, ownerUserId: number) {
    if (!this.bindSucceeds) return false;
    this.owners.set(sourceId, ownerUserId);
    return true;
  }
}

function manualContext(): GroupManualAccessContext {
  return {
    sourceId: 10,
    sourceStatus: 'ACTIVE',
    actorIsActiveMember: true,
  };
}

function baseContext(): GroupAuthorizationContext {
  return {
    sourceId: 10,
    sourceStatus: 'ACTIVE',
    ownerUserId: 100,
    ownerIsActiveMember: true,
    actorIsActiveMember: true,
    actorRecordingEnabled: true,
    ownerPlanCode: 'SUB1',
    ownerPlanDisplayName: '專業版',
    ownerSubscriptionStatus: 'ACTIVE',
    ownerEffectiveAt: new Date('2026-09-01T00:00:00Z'),
    ownerPeriodStart: new Date('2026-09-01T00:00:00Z'),
    ownerPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    ownerPlanEnabled: true,
    ownerCapabilities: {},
    ownerAllowanceUnits: 100,
    ownerConsumedUnits: 20,
  };
}

const ACTIVE_AT = new Date('2026-09-02T00:00:00Z');

describe('WorklogCollaborationService manual group access', () => {
  it('allows an active member without consulting owner/subscription AI state', async () => {
    const repository = new FakeRepository();
    repository.manualContext = manualContext();
    repository.context = {
      ...baseContext(),
      ownerUserId: null,
      ownerIsActiveMember: false,
      ownerSubscriptionStatus: null,
      ownerPlanEnabled: false,
    };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'OK', actorUserId: 200 });
  });

  it('does not require the legacy owner to still be a member for manual access', async () => {
    const repository = new FakeRepository();
    repository.manualContext = manualContext();
    repository.context = { ...baseContext(), ownerIsActiveMember: false };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'OK', actorUserId: 200 });
  });

  it('blocks a non-member even if legacy billing state is valid', async () => {
    const repository = new FakeRepository();
    repository.manualContext = { ...manualContext(), actorIsActiveMember: false };
    repository.context = baseContext();
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'NOT_ACTIVE_MEMBER' });
  });

  it('blocks inactive and missing group sources', async () => {
    const repository = new FakeRepository();
    const service = new WorklogCollaborationService(repository);

    repository.manualContext = { ...manualContext(), sourceStatus: 'INACTIVE' };
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200 }))
      .resolves.toEqual({ status: 'GROUP_INACTIVE' });

    repository.manualContext = null;
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200 }))
      .resolves.toEqual({ status: 'GROUP_NOT_FOUND' });
  });
});

describe('WorklogCollaborationService temporary legacy AI authorization', () => {
  it('charges group AI usage to the legacy bound owner while retaining the actor', async () => {
    const repository = new FakeRepository();
    repository.context = baseContext();
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 5, at: ACTIVE_AT }))
      .resolves.toEqual({
        status: 'OK',
        actorUserId: 200,
        chargedUserId: 100,
        ownerPlanCode: 'SUB1',
        ownerCapabilities: {},
        remainingAiUnits: 75,
      });
  });

  it('still pauses legacy AI use when the bound owner is absent until grant/responsible-user refactor lands', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerIsActiveMember: false };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 5, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'OWNER_ABSENT' });
  });

  it('blocks a member before legacy AI usage when recording permission is disabled', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), actorRecordingEnabled: false };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'RECORDING_DISABLED' });
  });

  it('blocks a stale legacy subscription before quota/provider work', async () => {
    const repository = new FakeRepository();
    repository.context = {
      ...baseContext(),
      ownerPeriodEnd: new Date('2026-09-02T00:00:00Z'),
      ownerAllowanceUnits: 1000,
      ownerConsumedUnits: 0,
    };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 1, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '專業版' });
  });

  it('blocks the provider call when legacy allowance cannot cover requested AI units', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerAllowanceUnits: 100, ownerConsumedUnits: 99 };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 2, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'AI_QUOTA_EXHAUSTED' });
  });

  it('does not let a stale/non-member group identity consume legacy owner quota', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), actorIsActiveMember: false };
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'NOT_ACTIVE_MEMBER' });
  });
});

describe('WorklogCollaborationService member permissions', () => {
  it('allows only the legacy owner to change a member recording permission', async () => {
    const repository = new FakeRepository();
    repository.owners.set(10, 100);
    repository.activeMembers.add('10:200');
    const service = new WorklogCollaborationService(repository);

    await expect(service.setMemberRecordingPermission({ sourceId: 10, actorUserId: 999, memberUserId: 200, enabled: false }))
      .resolves.toEqual({ status: 'FORBIDDEN' });
    expect(repository.permissionWrites).toEqual([]);

    await expect(service.setMemberRecordingPermission({ sourceId: 10, actorUserId: 100, memberUserId: 200, enabled: false }))
      .resolves.toEqual({ status: 'UPDATED' });
    expect(repository.permissionWrites).toEqual([
      { sourceId: 10, memberUserId: 200, enabled: false, updatedByUserId: 100 },
    ]);
  });

  it('does not allow the legacy owner to disable their own recording permission', async () => {
    const repository = new FakeRepository();
    repository.owners.set(10, 100);
    repository.activeMembers.add('10:100');
    const service = new WorklogCollaborationService(repository);

    await expect(service.setMemberRecordingPermission({ sourceId: 10, actorUserId: 100, memberUserId: 100, enabled: false }))
      .resolves.toEqual({ status: 'OWNER_CANNOT_BE_DISABLED' });
  });
});

describe('WorklogCollaborationService legacy owner binding', () => {
  it('binds once and refuses accidental reassignment', async () => {
    const repository = new FakeRepository();
    const service = new WorklogCollaborationService(repository);

    await expect(service.bindGroupOwner({ sourceId: 10, ownerUserId: 100, bindingMethod: 'line_actor' }))
      .resolves.toEqual({ status: 'BOUND', ownerUserId: 100 });
    await expect(service.bindGroupOwner({ sourceId: 10, ownerUserId: 200, bindingMethod: 'line_actor' }))
      .resolves.toEqual({ status: 'OWNER_CONFLICT', ownerUserId: 100 });
  });
});
