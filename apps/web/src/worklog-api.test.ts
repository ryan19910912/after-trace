import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorklogApi } from './worklog-api';

const api = new WorklogApi('https://api.example.test');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorklogApi target Web/PWA contract', () => {
  it('preserves null occurredAt from manual Record responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      records: [{
        id: 10,
        sourceId: 2,
        entityId: null,
        title: null,
        authorUserId: 1,
        authorDisplayName: 'Ryan',
        inputType: 'TEXT',
        rawText: '只有內容也能建立',
        occurredAt: null,
        status: 'ACTIVE',
        version: 1,
        deletedAt: null,
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
      }],
      page: { limit: 50, offset: 0, hasMore: false, nextOffset: null },
    })));

    const result = await api.personalRecords('session');

    expect(result.records[0]?.occurredAt).toBeNull();
    expect(result.records[0]?.title).toBeNull();
  });

  it('preserves nullable event dates in revision history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      revisions: [{
        id: 20,
        recordId: 10,
        version: 2,
        editorUserId: 1,
        editorDisplayName: 'Ryan',
        channel: 'PWA_MANUAL',
        previousRawText: 'before',
        newRawText: 'after',
        previousOccurredAt: null,
        newOccurredAt: '2026-09-07T01:00:00.000Z',
        previousEntityId: null,
        previousTitle: null,
        newEntityId: null,
        newTitle: null,
        previousStatus: 'ACTIVE',
        newStatus: 'ACTIVE',
        createdAt: '2026-09-07T01:01:00.000Z',
      }],
    })));

    const revisions = await api.recordRevisions('session', 10);

    expect(revisions[0]?.previousOccurredAt).toBeNull();
    expect(revisions[0]?.newOccurredAt).toBe('2026-09-07T01:00:00.000Z');
  });

  it('maps AFTERTRACE-native group surfaces without requiring a LINE group id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      surfaces: {
        personal: { sourceId: 1 },
        groups: [{ sourceId: 2, name: '晴空案團隊', role: 'OWNER', legacyLineGroupId: null }],
      },
    })));

    const surfaces = await api.surfaces('session');

    expect(surfaces.groups).toEqual([{ sourceId: 2, name: '晴空案團隊', role: 'OWNER', legacyLineGroupId: null }]);
  });

  it('sends an explicit null event date for content-only manual create', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      record: {
        id: 11,
        sourceId: 1,
        entityId: null,
        title: null,
        authorUserId: 1,
        authorDisplayName: null,
        inputType: 'TEXT',
        rawText: 'content only',
        occurredAt: null,
        status: 'ACTIVE',
        version: 1,
        deletedAt: null,
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.createRecord('session', { type: 'PERSONAL', sourceId: 1 }, { rawText: 'content only', occurredAt: null });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ rawText: 'content only', occurredAt: null });
  });

  it('returns a one-time raw invite token only from invite creation response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      invite: {
        id: 30,
        sourceId: 2,
        expiresAt: null,
        maxUses: 1,
        useCount: 0,
        revokedAt: null,
        createdAt: '2026-09-07T00:00:00.000Z',
      },
      inviteToken: 'raw-token',
    }, 201)));

    const result = await api.createGroupInvite('session', 2, { maxUses: 1 });

    expect(result.invite.maxUses).toBe(1);
    expect(result.inviteToken).toBe('raw-token');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
