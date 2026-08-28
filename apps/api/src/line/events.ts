export type BufferedGroupMessage = {
  webhookEventId: string | null;
  lineGroupId: string;
  lineMessageId: string;
  quotedLineMessageId: string | null;
  lineUserId: string | null;
  messageType: string;
  textContent: string | null;
  charCount: number;
  quoteToken: string | null;
  lineTimestamp: Date;
  metadata: Record<string, unknown> | null;
};

export type GroupLifecycleEvent = {
  webhookEventId: string | null;
  lineGroupId: string;
  type: 'JOIN' | 'LEAVE';
  lineTimestamp: Date;
};

export type ParsedLineEvent =
  | { kind: 'MESSAGE'; message: BufferedGroupMessage }
  | { kind: 'LIFECYCLE'; event: GroupLifecycleEvent };

export type ParsedLineWebhook = {
  events: ParsedLineEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function messageTextAndMetadata(message: Record<string, unknown>): {
  textContent: string | null;
  metadata: Record<string, unknown> | null;
} {
  const type = asString(message.type);
  if (type === 'text') {
    return { textContent: asString(message.text), metadata: null };
  }

  if (type === 'location') {
    const title = asString(message.title);
    const address = asString(message.address);
    const textContent = [title, address].filter((value): value is string => Boolean(value)).join(' - ') || null;
    const latitude = asNumber(message.latitude);
    const longitude = asNumber(message.longitude);
    return {
      textContent,
      metadata: {
        ...(title ? { title } : {}),
        ...(address ? { address } : {}),
        ...(latitude !== null ? { latitude } : {}),
        ...(longitude !== null ? { longitude } : {}),
      },
    };
  }

  if (type === 'file') {
    const fileName = asString(message.fileName);
    const fileSize = asNumber(message.fileSize);
    return {
      textContent: null,
      metadata: {
        ...(fileName ? { fileName } : {}),
        ...(fileSize !== null ? { fileSize } : {}),
      },
    };
  }

  if (type === 'sticker') {
    const packageId = asString(message.packageId);
    const stickerId = asString(message.stickerId);
    const stickerResourceType = asString(message.stickerResourceType);
    return {
      textContent: null,
      metadata: {
        ...(packageId ? { packageId } : {}),
        ...(stickerId ? { stickerId } : {}),
        ...(stickerResourceType ? { stickerResourceType } : {}),
      },
    };
  }

  if (type === 'image' || type === 'video' || type === 'audio') {
    const contentProvider = isRecord(message.contentProvider) ? message.contentProvider : null;
    const providerType = contentProvider ? asString(contentProvider.type) : null;
    return {
      textContent: null,
      metadata: providerType ? { contentProviderType: providerType } : null,
    };
  }

  return { textContent: null, metadata: null };
}

const supportedMessageTypes = new Set([
  'text',
  'image',
  'video',
  'audio',
  'file',
  'location',
  'sticker',
]);

export function parseLineWebhook(payload: unknown): ParsedLineWebhook {
  const result: ParsedLineWebhook = { events: [] };
  if (!isRecord(payload) || !Array.isArray(payload.events)) return result;

  for (const rawEvent of payload.events) {
    if (!isRecord(rawEvent)) continue;

    const source = isRecord(rawEvent.source) ? rawEvent.source : null;
    if (!source || source.type !== 'group') continue;

    const lineGroupId = asString(source.groupId);
    if (!lineGroupId) continue;

    const timestampValue = asNumber(rawEvent.timestamp);
    const lineTimestamp = new Date(timestampValue ?? Date.now());
    const webhookEventId = asString(rawEvent.webhookEventId);
    const eventType = asString(rawEvent.type);

    if (eventType === 'join' || eventType === 'leave') {
      result.events.push({
        kind: 'LIFECYCLE',
        event: {
          webhookEventId,
          lineGroupId,
          type: eventType === 'join' ? 'JOIN' : 'LEAVE',
          lineTimestamp,
        },
      });
      continue;
    }

    if (eventType !== 'message' || !isRecord(rawEvent.message)) continue;

    const message = rawEvent.message;
    const messageType = asString(message.type);
    const lineMessageId = asString(message.id);
    if (!messageType || !supportedMessageTypes.has(messageType) || !lineMessageId) continue;

    const { textContent, metadata } = messageTextAndMetadata(message);
    result.events.push({
      kind: 'MESSAGE',
      message: {
        webhookEventId,
        lineGroupId,
        lineMessageId,
        quotedLineMessageId: asString(message.quotedMessageId),
        lineUserId: asString(source.userId),
        messageType,
        textContent,
        charCount: textContent?.length ?? 0,
        quoteToken: asString(message.quoteToken),
        lineTimestamp,
        metadata,
      },
    });
  }

  return result;
}
