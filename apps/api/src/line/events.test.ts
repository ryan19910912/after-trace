import { describe, expect, it } from 'vitest';
import { parseLineWebhook, parseOaWebhook } from './events';

describe('parseLineWebhook', () => {
  it('keeps supported group messages with source and reply metadata', () => {
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
            quotedMessageId: 'msg-original',
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

    expect(parsed.events).toHaveLength(1);
    const parsedEvent = parsed.events[0];
    expect(parsedEvent.kind).toBe('MESSAGE');
    if (parsedEvent.kind !== 'MESSAGE') throw new Error('Expected message event');
    expect(parsedEvent.message).toMatchObject({
      webhookEventId: 'evt-1',
      lineGroupId: 'group-1',
      lineMessageId: 'msg-1',
      quotedLineMessageId: 'msg-original',
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

    const locationEvent = parsed.events[0];
    const fileEvent = parsed.events[1];
    if (locationEvent.kind !== 'MESSAGE' || fileEvent.kind !== 'MESSAGE') {
      throw new Error('Expected message events');
    }

    expect(locationEvent.message).toMatchObject({
      textContent: '咖啡店 - 台北市信義區',
      metadata: { title: '咖啡店', address: '台北市信義區', latitude: 25.03, longitude: 121.56 },
    });
    expect(fileEvent.message).toMatchObject({
      textContent: null,
      metadata: { fileName: 'plan.pdf', fileSize: 1024 },
    });
  });

  it('parses lifecycle events and preserves original webhook event order', () => {
    const parsed = parseLineWebhook({
      events: [
        {
          type: 'message',
          timestamp: 1_700_000_000_000,
          source: { type: 'group', groupId: 'group-1' },
          message: { id: 'msg-before-leave', type: 'text', text: 'before' },
        },
        {
          type: 'leave',
          webhookEventId: 'leave-1',
          timestamp: 1_700_000_001_000,
          source: { type: 'group', groupId: 'group-1' },
        },
        {
          type: 'message',
          timestamp: 1_700_000_002_000,
          source: { type: 'group', groupId: 'group-1' },
          message: { id: 'msg-after-leave', type: 'text', text: 'after' },
        },
      ],
    });

    expect(parsed.events.map((event) => event.kind)).toEqual(['MESSAGE', 'LIFECYCLE', 'MESSAGE']);
    const lifecycle = parsed.events[1];
    if (lifecycle.kind !== 'LIFECYCLE') throw new Error('Expected lifecycle event');
    expect(lifecycle.event.type).toBe('LEAVE');
  });
});

describe('parseOaWebhook', () => {
  it('parses follow, private message and unfollow in original order', () => {
    const parsed = parseOaWebhook({
      events: [
        {
          type: 'follow',
          webhookEventId: 'follow-1',
          timestamp: 1_700_000_000_000,
          source: { type: 'user', userId: 'user-oa' },
        },
        {
          type: 'message',
          webhookEventId: 'message-1',
          replyToken: 'reply-1',
          timestamp: 1_700_000_001_000,
          source: { type: 'user', userId: 'user-oa' },
          message: {
            id: 'private-1',
            type: 'text',
            text: '@AFTERTRACE 王先生今天收五千',
            quotedMessageId: 'quoted-1',
            quoteToken: 'quote-1',
          },
        },
        {
          type: 'unfollow',
          webhookEventId: 'unfollow-1',
          timestamp: 1_700_000_002_000,
          source: { type: 'user', userId: 'user-oa' },
        },
        {
          type: 'message',
          source: { type: 'group', groupId: 'group-ignored', userId: 'user-oa' },
          message: { id: 'group-1', type: 'text', text: '@AFTERTRACE ignored here' },
        },
      ],
    });

    expect(parsed.events.map((event) => event.kind)).toEqual([
      'OA_LIFECYCLE',
      'PRIVATE_MESSAGE',
      'OA_LIFECYCLE',
    ]);

    const follow = parsed.events[0];
    const message = parsed.events[1];
    const unfollow = parsed.events[2];
    if (follow.kind !== 'OA_LIFECYCLE' || message.kind !== 'PRIVATE_MESSAGE' || unfollow.kind !== 'OA_LIFECYCLE') {
      throw new Error('Expected OA lifecycle/message events');
    }
    expect(follow.event).toMatchObject({ lineUserId: 'user-oa', type: 'FOLLOW' });
    expect(message.message).toMatchObject({
      webhookEventId: 'message-1',
      replyToken: 'reply-1',
      lineUserId: 'user-oa',
      lineMessageId: 'private-1',
      quotedLineMessageId: 'quoted-1',
      messageType: 'text',
      textContent: '@AFTERTRACE 王先生今天收五千',
      quoteToken: 'quote-1',
    });
    expect(unfollow.event).toMatchObject({ lineUserId: 'user-oa', type: 'UNFOLLOW' });
  });

  it('keeps private attachment metadata but not binary data', () => {
    const parsed = parseOaWebhook({
      events: [
        {
          type: 'message',
          timestamp: 1_700_000_000_000,
          source: { type: 'user', userId: 'user-oa' },
          message: { id: 'file-private', type: 'file', fileName: 'estimate.pdf', fileSize: 2048 },
        },
      ],
    });

    const event = parsed.events[0];
    if (event.kind !== 'PRIVATE_MESSAGE') throw new Error('Expected private message');
    expect(event.message.metadata).toEqual({ fileName: 'estimate.pdf', fileSize: 2048 });
  });
});
