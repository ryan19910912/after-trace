import { describe, expect, it } from 'vitest';
import {
  worklogSourceMemberRoleEnum,
  worklogSourceMembers,
  worklogSources,
  worklogSubscriptionPlans,
  worklogUsers,
} from '../db/schema-worklog';
import {
  worklogAuthIdentities,
  worklogAuthProviderEnum,
  worklogSourceInvites,
  worklogUserPublicAccounts,
} from '../db/schema-worklog-product';

describe('Web/PWA product foundation schema', () => {
  it('does not require a LINE identity for a target Web/PWA user', () => {
    expect(worklogUsers.lineUserId.notNull).toBe(false);
  });

  it('supports Google, LINE and Apple as provider-neutral login bindings', () => {
    expect(worklogAuthProviderEnum.enumValues).toEqual(['GOOGLE', 'LINE', 'APPLE']);
    expect(worklogAuthIdentities.userId.notNull).toBe(true);
    expect(worklogAuthIdentities.provider.notNull).toBe(true);
    expect(worklogAuthIdentities.subject.notNull).toBe(true);
  });

  it('keeps the customer-facing account id separate from provider identity and DB sequence', () => {
    expect(worklogUserPublicAccounts.userId.notNull).toBe(true);
    expect(worklogUserPublicAccounts.publicAccountId.notNull).toBe(true);
    expect(worklogUserPublicAccounts.publicAccountId.dataType).toBe('string');
  });

  it('supports native named GROUP sources and explicit member roles', () => {
    expect(worklogSources.name.notNull).toBe(false);
    expect(worklogSources.createdByUserId.notNull).toBe(false);
    expect(worklogSourceMemberRoleEnum.enumValues).toEqual(['OWNER', 'MEMBER']);
    expect(worklogSourceMembers.role.notNull).toBe(true);
    expect(worklogSourceMembers.role.default).toBe('MEMBER');
  });

  it('keeps paid AI plan caps explicit and fail-closed-capable', () => {
    expect(worklogSubscriptionPlans.aiEnabled.notNull).toBe(true);
    expect(worklogSubscriptionPlans.aiEnabled.default).toBe(false);
    expect(worklogSubscriptionPlans.monthlyAiPointCap.notNull).toBe(false);
    expect(worklogSubscriptionPlans.monthlyProviderCostCapTwd.notNull).toBe(false);
    expect(worklogSubscriptionPlans.perRequestAiPointCap.notNull).toBe(false);
  });

  it('stores only an invite token hash and requires authenticated membership separately', () => {
    expect(worklogSourceInvites.sourceId.notNull).toBe(true);
    expect(worklogSourceInvites.tokenHash.notNull).toBe(true);
    expect(worklogSourceInvites.createdByUserId.notNull).toBe(true);
    expect('token' in worklogSourceInvites).toBe(false);
    expect('rawToken' in worklogSourceInvites).toBe(false);
  });
});