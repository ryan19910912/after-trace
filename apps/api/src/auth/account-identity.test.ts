import { describe, expect, it } from 'vitest';
import {
  AccountIdentityService,
  type AccountIdentityRepository,
  type AccountProfile,
  type ProvisionAccountIdentityInput,
} from './account-identity';
import { createPublicAccountId, isPublicAccountId } from './public-account-id';

function profile(publicAccountId = 'AT-23456789ABCD'): AccountProfile {
  return { userId: 7, displayName: 'Ryan', publicAccountId };
}

describe('public account id', () => {
  it('uses the AFTERTRACE prefix and opaque non-sequential alphabet', () => {
    const value = createPublicAccountId();
    expect(isPublicAccountId(value)).toBe(true);
    expect(value).toMatch(/^AT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/);
  });

  it('normalizes validation case without treating the id as a secret', () => {
    expect(isPublicAccountId('at-23456789abcd')).toBe(true);
    expect(isPublicAccountId('7')).toBe(false);
    expect(isPublicAccountId('AT-000000000000')).toBe(false);
  });
});

describe('AccountIdentityService', () => {
  it('provisions a provider identity without using email as an account key', async () => {
    let received: (ProvisionAccountIdentityInput & { publicAccountId: string; at: Date }) | null = null;
    const repository: AccountIdentityRepository = {
      async provision(input) {
        received = input;
        return profile(input.publicAccountId);
      },
      async profile() {
        return profile();
      },
    };
    const service = new AccountIdentityService(repository, () => 'AT-23456789ABCD');
    const result = await service.provision({
      provider: 'GOOGLE',
      subject: 'provider-subject-123',
      emailSnapshot: 'person@example.com',
      displayNameSnapshot: 'Ryan',
      at: new Date('2026-09-07T02:00:00.000Z'),
    });

    expect(result).toEqual(profile('AT-23456789ABCD'));
    expect(received).toMatchObject({
      provider: 'GOOGLE',
      subject: 'provider-subject-123',
      emailSnapshot: 'person@example.com',
      publicAccountId: 'AT-23456789ABCD',
    });
  });

  it('retries only public-account-id unique collisions with a fresh candidate', async () => {
    const candidates = ['AT-23456789ABCD', 'AT-3456789ABCDE'];
    let calls = 0;
    const repository: AccountIdentityRepository = {
      async provision(input) {
        calls += 1;
        if (calls === 1) {
          const collision = Object.assign(new Error('duplicate worklog_user_public_account_id_uq'), {
            code: '23505',
            constraint: 'worklog_user_public_account_id_uq',
          });
          throw collision;
        }
        return profile(input.publicAccountId);
      },
      async profile() {
        return null;
      },
    };
    const service = new AccountIdentityService(repository, () => candidates.shift()!);

    await expect(service.provision({ provider: 'LINE', subject: 'Uabc' }))
      .resolves.toMatchObject({ publicAccountId: 'AT-3456789ABCDE' });
    expect(calls).toBe(2);
  });

  it('does not retry unrelated persistence failures', async () => {
    let calls = 0;
    const repository: AccountIdentityRepository = {
      async provision() {
        calls += 1;
        throw new Error('DATABASE_UNAVAILABLE');
      },
      async profile() {
        return null;
      },
    };
    const service = new AccountIdentityService(repository, () => 'AT-23456789ABCD');

    await expect(service.provision({ provider: 'APPLE', subject: 'apple-subject' }))
      .rejects.toThrow('DATABASE_UNAVAILABLE');
    expect(calls).toBe(1);
  });
});