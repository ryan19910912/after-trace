import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  worklogSourceInvites,
} from '../db/schema-worklog-product';

describe('Web/PWA product foundation schema', () => {
  it('does not require a LINE identity for a target Web/PWA user', () => {
    expect(worklogUsers.lineUserId.notNull).toBe(false);
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

  it('stores provider-neutral auth identities instead of requiring LINE identity', () => {
    expect(worklogAuthIdentities.userId.notNull).toBe(true);
    expect(worklogAuthIdentities.provider.notNull).toBe(true);
    expect(worklogAuthIdentities.subject.notNull).toBe(true);
  });

  it('stores only an invite token hash and requires authenticated membership separately', () => {
    expect(worklogSourceInvites.sourceId.notNull).toBe(true);
    expect(worklogSourceInvites.tokenHash.notNull).toBe(true);
    expect(worklogSourceInvites.createdByUserId.notNull).toBe(true);
    expect('token' in worklogSourceInvites).toBe(false);
    expect('rawToken' in worklogSourceInvites).toBe(false);
  });

  it('keeps the existing-database migration additive and idempotent', async () => {
    const migration = await readFile(join(process.cwd(), 'scripts/forward-compat.mjs'), 'utf8');

    expect(migration).toContain('ALTER COLUMN line_user_id DROP NOT NULL');
    expect(migration).toContain("CREATE TYPE public.worklog_source_member_role AS ENUM ('OWNER', 'MEMBER')");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS name varchar(255)');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false');
    expect(migration).toContain('monthly_provider_cost_cap_twd numeric(12,2)');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.worklog_auth_identities');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.worklog_source_invites');
  });
});