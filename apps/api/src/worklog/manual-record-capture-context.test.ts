import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client';
import {
  createManualRecordRoutes,
  type ManualRecordRouteRepository,
  type ManualRecordView,
} from './manual-record-routes';

const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

function createdRecord(captureContext: ManualRecordView['captureContext']): ManualRecordView {
  return {
    id: 81,
    sourceId: 10,
    entityId: null,
    title: null,
    authorUserId: 7,
    authorDisplayName: 'Ryan',
    inputType: 'TEXT',
    rawText: '選取的內容',
    captureContext,
    occurredAt: null,
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    createdAt: '2026-09-07T12:00:00.000Z',
    updatedAt: '2026-09-07T12:00:00.000Z',
  };
}

function app(repository: ManualRecordRouteRepository) {
  return createManualRecordRoutes({
    databaseFactory: () => ({}) as Database,
    verifySession: async () => ({ type: 'WEB_SESSION', userId: 7, lineUserId: '', expiresAt: 4_000_000_000 }),
    resolveSessionUserId: async () => 7,
    repositoryFactory: () => repository,
  });
}

describe('manual Record capture context route', () => {
  it('derives Chrome client identity and forwards bounded page context into durable Record creation', async () => {
    const create = vi.fn(async (input: Parameters<ManualRecordRouteRepository['create']>[0]) => createdRecord(input.captureContext));
    const repository = {
      personalSourceId: async () => 10,
      legacyEntity: async () => null,
      create,
    } as unknown as ManualRecordRouteRepository;

    const response = await app(repository).request('https://api.example.test/records/personal', {
      method: 'POST',
      headers: {
        Origin: extensionOrigin,
        Authorization: 'Bearer aftertrace-session',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rawText: '選取的內容',
        occurredAt: null,
        captureContext: {
          page: {
            title: 'Example page',
            url: 'https://example.test/article?id=9',
          },
        },
      }),
    }, env);

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 10,
      actorUserId: 7,
      rawText: '選取的內容',
      captureContext: {
        client: 'CHROME_EXTENSION',
        page: {
          title: 'Example page',
          url: 'https://example.test/article?id=9',
        },
      },
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      record: {
        id: 81,
        captureContext: {
          client: 'CHROME_EXTENSION',
          page: { title: 'Example page', url: 'https://example.test/article?id=9' },
        },
      },
    });
  });

  it('rejects extension capture metadata when a normal Web client tries to spoof it', async () => {
    const create = vi.fn();
    const repository = {
      personalSourceId: async () => 10,
      legacyEntity: async () => null,
      create,
    } as unknown as ManualRecordRouteRepository;

    const response = await app(repository).request('https://api.example.test/records/personal', {
      method: 'POST',
      headers: {
        Origin: env.WEB_APP_ORIGIN,
        Authorization: 'Bearer aftertrace-session',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rawText: '一般 Web 紀錄',
        captureContext: { page: { title: 'Spoof', url: 'https://example.test/' } },
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_CAPTURE_CONTEXT' });
    expect(create).not.toHaveBeenCalled();
  });
});
