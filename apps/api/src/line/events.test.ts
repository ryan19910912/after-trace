import { describe, expect, it } from 'vitest';
import { parseLineWebhook } from './events';

describe('parseLineWebhook', () => {
  it('keeps supported group messages with source metadata', () => {
    const parsed = parseLineWebhook({
      events: [
        {
          type: 'message',
          webhookEventId: 'evt-1',
          timestamp: 1_700_000_000_000,
          source: { type: 'group', groupId: 'group-1', userId: 'user-1' },
          message: {
            id: 'msg-1',
            type: 'text',
            text: 'Amy 不吃香菜',
            quoteToken: 'quote-1',
          },
        },
        {
          type: 'message',
          timestamp: 1_700_000_000_000,
          source: { type: 'user', userId: 'user-2' },
          message: { id: 'msg-2', type: 'text', text: 'private' },
        },
      ],
    });

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      webhookEventId: 'evt-1',
      lineGroupId: 'group-1',
      lineMessageId: 'msg-1',
      lineUserId: 'user-1',
      messageType: 'text',
      textContent: 'Amy 不吃香菜',
      charCount: 8,
      quoteToken: 'quote-1',
    });
  });

  it('stores attachment/location metadata without binary content', () => {
    const parsed = parseLineWebhook({
      events: [
        {
          type: 'message',
          timestamp: 1_700_000_000_000,
          source: { type: 'group', groupId: 'group-1' },
          message: {
            id: 'loc-1',
            type: 'location',
            title: '咖啡店',
            address: '台北市信義區',
            latitude: 25.03,
            longitude: 121.56,
          },
        },
        {
          type: 'message',
          timestamp: 1_700_000_000_000,
          source: { type: 'group', groupId: 'group-1' },
          message: { id: 'file-1', type: 'file', fileName: 'plan.pdf', fileSize: 1024 },
        },
      ],
    });

    expect(parsed.messages[0]).toMatchObject({
      textContent: '咖啡店 - 台北市信義區',
      metadata: { title: '咖啡店', address: '台北市信義區', latitude: 25.03, longitude: 121.56 },
    });
    expect(parsed.messages[1]).toMatchObject({
      textContent: null,
      metadata: { fileName: 'plan.pdf', fileSize: 1024 },
    });
  });

  it('parses group join and leave lifecycle events', () => {
    const parsed = parseLineWebhook({
      events: [
        {
          type: 'join',
          webhookEventId: 'join-1',
          timestamp: 1_700_000_000_000,
          source: { type: 'group', groupId: 'group-1' },
        },
        {
          type: 'leave',
          webhookEventId: 'leave-1',
          timestamp: 1_700_000_001_000,
          source: { type: 'group', groupId: 'group-1' },
        },
      ],
    });

    expect(parsed.lifecycleEvents.map((event) => event.type)).toEqual(['JOIN', 'LEAVE']);
  });
});
