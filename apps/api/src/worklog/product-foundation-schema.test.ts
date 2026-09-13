import { describe, expect, it } from 'vitest';
import {
  worklogSourceMembers,
  worklogSources,
  worklogSubscriptionPlans,
  worklogUsers,
} from '../db/schema-worklog';
import {
  worklogAuthIdentities,
  worklogSourceInvites,
  worklogUserPublicAccounts,
} from '../db/schema-worklog-product';
import {
  WORKLOG_AUTH_PROVIDERS,
  WORKLOG_PLAN_TYPES,
  WORKLOG_SOURCE_MEMBER_ROLES,
} from './domain-values';

describe('Web/PWA product foundation schema', () => {
  it('keeps the core user provider-neutral with no legacy LINE identity column', () => {
    expect('lineUserId' in worklogUsers).toBe(false);
    expect('isOaFriend' in worklogUsers).toBe(false);
  });

  it('supports Google, LINE and Apple as provider-neutral login bindings in application rules', () => {
    expect(WORKLOG_AUTH_PROVIDERS).toEqual(['GOOGLE', 'LINE', 'APPLE']);
    expect(worklogAuthIdentities.userId.notNull).toBe(true);
    expect(worklogAuthIdentities.provider.notNull).toBe(true);
    expect(worklogAuthIdentities.provider.dataType).toBe('string');
    expect(worklogAuthIdentities.subject.notNull).toBe(true);
  });

  it('keeps the customer-facing account id separate from provider identity and DB sequence', () => {
    expect(worklogUserPublicAccounts.userId.notNull).toBe(true);
    expect(worklogUserPublicAccounts.publicAccountId.notNull).toBe(true);
    expect(worklogUserPublicAccounts.publicAccountId.dataType).toBe('string');
  });

  it('supports native named GROUP sources and explicit member roles without LINE group identity', () => {
    expect(worklogSources.name.notNull).toBe(false);
    expect(worklogSources.createdByUserId.notNull).toBe(false);
    expect('lineGroupId' in worklogSources).toBe(false);
    expect(WORKLOG_SOURCE_MEMBER_ROLES).toEqual(['OWNER', 'MEMBER']);
    expect(worklogSourceMembers.role.notNull).toBe(true);
    expect(worklogSourceMembers.role.default).toBe('MEMBER');
    expect(worklogSourceMembers.role.dataType).toBe('string');
  });

  it('allows only FREE and recurring SUBSCRIPTION plan types in application rules', () => {
    expect(WORKLOG_PLAN_TYPES).toEqual(['FREE', 'SUBSCRIPTION']);
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
