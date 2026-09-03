import { describe, expect, it } from 'vitest';
import {
  WorklogCollaborationService,
  type GroupAuthorizationContext,
  type WorklogCollaborationRepository,
} from './collaboration';

class FakeRepository implements WorklogCollaborationRepository {
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
    ownerCapabilities: { groupCollaboration: true, maxGroupCount: 3 },
    ownerAllowanceUnits: 100,
    ownerConsumedUnits: 20,
    ownerGroupPosition: 1,
  };
}

const ACTIVE_AT = new Date('2026-09-02T00:00:00Z');

describe('WorklogCollaborationService access authorization', () => {
  it('allows historical group read when recording is disabled but the owner plan is entitled', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), actorRecordingEnabled: false };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT })).resolves.toEqual({
      status: 'OK', actorUserId: 200, ownerUserId: 100, ownerPlanCode: 'SUB1',
      ownerCapabilities: { groupCollaboration: true, maxGroupCount: 3 },
    });
  });

  it('suspends group read when the bound owner is no longer an active member', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerIsActiveMember: false };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'OWNER_ABSENT' });
  });

  it('keeps FREE personal-only for group query/read access', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerPlanCode: 'FREE', ownerPlanDisplayName: '免費版' };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '免費版' });
  });

  it('blocks group read when an ACTIVE row is already past its billing period', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerPeriodEnd: new Date('2026-09-02T00:00:00Z') };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '專業版' });
  });

  it('blocks group read before the paid period becomes effective', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerEffectiveAt: new Date('2026-09-03T00:00:00Z'), ownerPeriodStart: new Date('2026-09-03T00:00:00Z') };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '專業版' });
  });

  it('fails closed when a group-enabled legacy plan omits maxGroupCount', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerCapabilities: { groupCollaboration: true } };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '專業版' });
  });

  it('blocks a group whose stable owner ordinal is beyond maxGroupCount', async () => {
    const repository = new FakeRepository();
    repository.context = { ...baseContext(), ownerGroupPosition: 4 };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT })).resolves.toEqual({
      status: 'GROUP_LIMIT_REACHED', ownerPlanDisplayName: '專業版', maxGroupCount: 3,
    });
  });
});

describe('WorklogCollaborationService authorization', () => {
  it('charges group AI usage to the group owner while retaining the actor', async () => {
    const repository = new FakeRepository(); repository.context = baseContext();
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 5, at: ACTIVE_AT })).resolves.toEqual({
      status: 'OK', actorUserId: 200, chargedUserId: 100, ownerPlanCode: 'SUB1',
      ownerCapabilities: { groupCollaboration: true, maxGroupCount: 3 }, remainingAiUnits: 75,
    });
  });

  it('suspends recording and quota use when the bound owner has left the group', async () => {
    const repository = new FakeRepository(); repository.context = { ...baseContext(), ownerIsActiveMember: false };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 5, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'OWNER_ABSENT' });
  });

  it('blocks a member before AI usage when owner disabled recording permission', async () => {
    const repository = new FakeRepository(); repository.context = { ...baseContext(), actorRecordingEnabled: false };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'RECORDING_DISABLED' });
  });

  it('never lets FREE use group collaboration even if bad capability data says true', async () => {
    const repository = new FakeRepository(); repository.context = { ...baseContext(), ownerPlanCode: 'FREE', ownerPlanDisplayName: '免費版' };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '免費版' });
  });

  it('blocks a stale ACTIVE subscription before quota checks or provider work', async () => {
    const repository = new FakeRepository(); repository.context = { ...baseContext(), ownerPeriodEnd: new Date('2026-09-02T00:00:00Z'), ownerAllowanceUnits: 1000, ownerConsumedUnits: 0 };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 1, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'GROUP_NOT_ENTITLED', ownerPlanDisplayName: '專業版' });
  });

  it('blocks the provider call when owner allowance cannot cover requested AI units', async () => {
    const repository = new FakeRepository(); repository.context = { ...baseContext(), ownerAllowanceUnits: 100, ownerConsumedUnits: 99 };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, requestedAiUnits: 2, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'AI_QUOTA_EXHAUSTED' });
  });

  it('does not let a stale/non-member group identity consume owner quota', async () => {
    const repository = new FakeRepository(); repository.context = { ...baseContext(), actorIsActiveMember: false };
    const service = new WorklogCollaborationService(repository);
    await expect(service.authorizeGroupRecord({ sourceId: 10, actorUserId: 200, at: ACTIVE_AT }))
      .resolves.toEqual({ status: 'NOT_ACTIVE_MEMBER' });
  });
});

describe('WorklogCollaborationService member permissions', () => {
  it('allows only the owner to change a member recording permission', async () => {
    const repository = new FakeRepository(); repository.owners.set(10, 100); repository.activeMembers.add('10:200');
    const service = new WorklogCollaborationService(repository);
    await expect(service.setMemberRecordingPermission({ sourceId: 10, actorUserId: 999, memberUserId: 200, enabled: false })).resolves.toEqual({ status: 'FORBIDDEN' });
    expect(repository.permissionWrites).toEqual([]);
    await expect(service.setMemberRecordingPermission({ sourceId: 10, actorUserId: 100, memberUserId: 200, enabled: false })).resolves.toEqual({ status: 'UPDATED' });
    expect(repository.permissionWrites).toEqual([{ sourceId: 10, memberUserId: 200, enabled: false, updatedByUserId: 100 }]);
  });

  it('does not allow the owner to disable their own recording permission', async () => {
    const repository = new FakeRepository(); repository.owners.set(10, 100); repository.activeMembers.add('10:100');
    const service = new WorklogCollaborationService(repository);
    await expect(service.setMemberRecordingPermission({ sourceId: 10, actorUserId: 100, memberUserId: 100, enabled: false })).resolves.toEqual({ status: 'OWNER_CANNOT_BE_DISABLED' });
  });
});

describe('WorklogCollaborationService owner binding', () => {
  it('binds once and refuses accidental ownership reassignment', async () => {
    const repository = new FakeRepository(); const service = new WorklogCollaborationService(repository);
    await expect(service.bindGroupOwner({ sourceId: 10, ownerUserId: 100, bindingMethod: 'line_actor' })).resolves.toEqual({ status: 'BOUND', ownerUserId: 100 });
    await expect(service.bindGroupOwner({ sourceId: 10, ownerUserId: 200, bindingMethod: 'line_actor' })).resolves.toEqual({ status: 'OWNER_CONFLICT', ownerUserId: 100 });
  });
});
