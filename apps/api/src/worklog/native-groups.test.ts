import { describe, expect, it } from 'vitest';
import {
  NativeGroupService,
  type NativeGroupCreateResult,
  type NativeGroupInviteCreateResult,
  type NativeGroupInviteRevokeResult,
  type NativeGroupInviteTokenCodec,
  type NativeGroupJoinResult,
  type NativeGroupRepository,
} from './native-groups';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

class FakeTokenCodec implements NativeGroupInviteTokenCodec {
  issued = { token: 'raw-invite-token', tokenHash: HASH_A };
  hashes: string[] = [];

  async issue() {
    return this.issued;
  }

  async hash(token: string) {
    this.hashes.push(token);
    return HASH_B;
  }
}

class FakeRepository implements NativeGroupRepository {
  createGroupResult: NativeGroupCreateResult = {
    status: 'CREATED',
    group: { sourceId: 20, name: '產品群', role: 'OWNER' },
  };
  createInviteResult: NativeGroupInviteCreateResult = {
    status: 'CREATED',
    invite: {
      id: 30,
      sourceId: 20,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
      revokedAt: null,
      createdAt: '2026-09-07T00:00:00.000Z',
    },
  };
  revokeInviteResult: NativeGroupInviteRevokeResult = { status: 'REVOKED', inviteId: 30 };
  joinResult: NativeGroupJoinResult = {
    status: 'JOINED',
    group: { sourceId: 20, name: '產品群', role: 'MEMBER' },
  };

  createGroupCalls: Array<{ creatorUserId: number; name: string }> = [];
  createInviteCalls: Array<{
    sourceId: number;
    actorUserId: number;
    tokenHash: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }> = [];
  revokeInviteCalls: Array<{ sourceId: number; inviteId: number; actorUserId: number }> = [];
  joinCalls: Array<{ actorUserId: number; tokenHash: string }> = [];

  async createGroup(input: { creatorUserId: number; name: string }) {
    this.createGroupCalls.push(input);
    return this.createGroupResult;
  }

  async createInvite(input: {
    sourceId: number;
    actorUserId: number;
    tokenHash: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }) {
    this.createInviteCalls.push(input);
    return this.createInviteResult;
  }

  async revokeInvite(input: { sourceId: number; inviteId: number; actorUserId: number }) {
    this.revokeInviteCalls.push(input);
    return this.revokeInviteResult;
  }

  async joinWithInvite(input: { actorUserId: number; tokenHash: string }) {
    this.joinCalls.push(input);
    return this.joinResult;
  }
}

describe('NativeGroupService', () => {
  it('creates a named group with the authenticated creator as the repository actor', async () => {
    const repository = new FakeRepository();
    const service = new NativeGroupService(repository, new FakeTokenCodec());

    await expect(service.createGroup({ creatorUserId: 7, name: ' 產品群 ' })).resolves.toEqual(
      repository.createGroupResult,
    );
    expect(repository.createGroupCalls).toEqual([{ creatorUserId: 7, name: '產品群' }]);
  });

  it('returns the one-time raw invite token but persists only its hash', async () => {
    const repository = new FakeRepository();
    const codec = new FakeTokenCodec();
    const service = new NativeGroupService(repository, codec);
    const expiresAt = new Date('2026-09-08T00:00:00.000Z');

    const result = await service.createInvite({
      sourceId: 20,
      actorUserId: 7,
      expiresAt,
      maxUses: 5,
      now: new Date('2026-09-07T00:00:00.000Z'),
    });

    expect(result).toEqual({
      status: 'CREATED',
      token: 'raw-invite-token',
      invite: repository.createInviteResult.status === 'CREATED'
        ? repository.createInviteResult.invite
        : undefined,
    });
    expect(repository.createInviteCalls).toEqual([
      { sourceId: 20, actorUserId: 7, tokenHash: HASH_A, expiresAt, maxUses: 5 },
    ]);
    expect(JSON.stringify(repository.createInviteCalls)).not.toContain('raw-invite-token');
  });

  it('hashes an invite token before authenticated join persistence', async () => {
    const repository = new FakeRepository();
    const codec = new FakeTokenCodec();
    const service = new NativeGroupService(repository, codec);

    await expect(service.join({ actorUserId: 9, token: ' invite-from-link ' })).resolves.toEqual(
      repository.joinResult,
    );
    expect(codec.hashes).toEqual(['invite-from-link']);
    expect(repository.joinCalls).toEqual([{ actorUserId: 9, tokenHash: HASH_B }]);
  });

  it('rejects already-expired invite creation before persistence', async () => {
    const repository = new FakeRepository();
    const service = new NativeGroupService(repository, new FakeTokenCodec());

    await expect(service.createInvite({
      sourceId: 20,
      actorUserId: 7,
      expiresAt: new Date('2026-09-06T23:59:59.000Z'),
      now: new Date('2026-09-07T00:00:00.000Z'),
    })).rejects.toThrow('invite expiry must be in the future');
    expect(repository.createInviteCalls).toEqual([]);
  });

  it('does not reinterpret repository authorization failures', async () => {
    const repository = new FakeRepository();
    repository.createInviteResult = { status: 'FORBIDDEN_OR_UNAVAILABLE' };
    repository.revokeInviteResult = { status: 'FORBIDDEN_OR_NOT_FOUND' };
    repository.joinResult = { status: 'INVALID_INVITE' };
    const service = new NativeGroupService(repository, new FakeTokenCodec());

    await expect(service.createInvite({ sourceId: 20, actorUserId: 8 })).resolves.toEqual({
      status: 'FORBIDDEN_OR_UNAVAILABLE',
    });
    await expect(service.revokeInvite({ sourceId: 20, inviteId: 30, actorUserId: 8 })).resolves.toEqual({
      status: 'FORBIDDEN_OR_NOT_FOUND',
    });
    await expect(service.join({ actorUserId: 8, token: 'invite-from-link' })).resolves.toEqual({
      status: 'INVALID_INVITE',
    });
  });
});
