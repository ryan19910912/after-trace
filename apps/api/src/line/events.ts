export type BufferedGroupMessage = {
  webhookEventId: string | null;
  replyToken?: string | null;
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

export type BufferedPrivateMessage = {
  webhookEventId: string | null;
  replyToken?: string | null;
  lineUserId: string;
  lineMessageId: string;
  quotedLineMessageId: string | null;
  messageType: string;
  textContent: string | null;
  charCount: number;
  quoteToken: string | null;
  lineTimestamp: Date;
  metadata: Record<string, unknown> | null;
};

export type GroupLifecycleEvent = {
  webhookEventId: string | null;
  replyToken?: string | null;
  lineGroupId: string;
  type: 'JOIN' | 'LEAVE' | 'MEMBER_JOINED' | 'MEMBER_LEFT';
  lineUserIds: string[];
  lineTimestamp: Date;
};

export type OaLifecycleEvent = {
  webhookEventId: string | null;
  replyToken?: string | null;
  lineUserId: string;
  type: 'FOLLOW' | 'UNFOLLOW';
  lineTimestamp: Date;
};

export type ParsedLineEvent =
  | { kind: 'MESSAGE'; message: BufferedGroupMessage }
  | { kind: 'LIFECYCLE'; event: GroupLifecycleEvent };
export type ParsedLineWebhook = { events: ParsedLineEvent[] };
export type ParsedOaEvent =
  | { kind: 'PRIVATE_MESSAGE'; message: BufferedPrivateMessage }
  | { kind: 'OA_LIFECYCLE'; event: OaLifecycleEvent };
export type ParsedOaWebhook = { events: ParsedOaEvent[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function asString(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function asNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function lineMemberIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.members)) return [];
  return value.members.flatMap((member) => {
    if (!isRecord(member) || member.type !== 'user') return [];
    const id = asString(member.userId);
    return id ? [id] : [];
  });
}

function messageTextAndMetadata(message: Record<string, unknown>): { textContent: string | null; metadata: Record<string, unknown> | null } {
  const type = asString(message.type);
  if (type === 'text') return { textContent: asString(message.text), metadata: null };
  if (type === 'location') {
    const title = asString(message.title);
    const address = asString(message.address);
    const textContent = [title, address].filter((value): value is string => Boolean(value)).join(' - ') || null;
    const latitude = asNumber(message.latitude);
    const longitude = asNumber(message.longitude);
    return { textContent, metadata: {
      ...(title ? { title } : {}), ...(address ? { address } : {}),
      ...(latitude !== null ? { latitude } : {}), ...(longitude !== null ? { longitude } : {}),
    } };
  }
  if (type === 'file') {
    const fileName = asString(message.fileName);
    const fileSize = asNumber(message.fileSize);
    return { textContent: null, metadata: { ...(fileName ? { fileName } : {}), ...(fileSize !== null ? { fileSize } : {}) } };
  }
  if (type === 'sticker') {
    const packageId = asString(message.packageId);
    const stickerId = asString(message.stickerId);
    const stickerResourceType = asString(message.stickerResourceType);
    return { textContent: null, metadata: {
      ...(packageId ? { packageId } : {}), ...(stickerId ? { stickerId } : {}), ...(stickerResourceType ? { stickerResourceType } : {}),
    } };
  }
  if (type === 'image' || type === 'video' || type === 'audio') {
    const contentProvider = isRecord(message.contentProvider) ? message.contentProvider : null;
    const providerType = contentProvider ? asString(contentProvider.type) : null;
    return { textContent: null, metadata: providerType ? { contentProviderType: providerType } : null };
  }
  return { textContent: null, metadata: null };
}

const supportedMessageTypes = new Set(['text', 'image', 'video', 'audio', 'file', 'location', 'sticker']);
function eventTimestamp(rawEvent: Record<string, unknown>): Date {
  const timestampValue = asNumber(rawEvent.timestamp);
  return new Date(timestampValue ?? Date.now());
}

/** Parses LINE group events for the Worklog group boundary. */
export function parseLineWebhook(payload: unknown): ParsedLineWebhook {
  const result: ParsedLineWebhook = { events: [] };
  if (!isRecord(payload) || !Array.isArray(payload.events)) return result;
  for (const rawEvent of payload.events) {
    if (!isRecord(rawEvent)) continue;
    const source = isRecord(rawEvent.source) ? rawEvent.source : null;
    if (!source || source.type !== 'group') continue;
    const lineGroupId = asString(source.groupId);
    if (!lineGroupId) continue;
    const lineTimestamp = eventTimestamp(rawEvent);
    const webhookEventId = asString(rawEvent.webhookEventId);
    const replyToken = asString(rawEvent.replyToken);
    const eventType = asString(rawEvent.type);
    if (eventType === 'join' || eventType === 'leave') {
      const actorUserId = eventType === 'join' ? asString(source.userId) : null;
      result.events.push({ kind: 'LIFECYCLE', event: {
        webhookEventId,
        replyToken,
        lineGroupId,
        type: eventType === 'join' ? 'JOIN' : 'LEAVE',
        lineUserIds: actorUserId ? [actorUserId] : [],
        lineTimestamp,
      } });
      continue;
    }
    if (eventType === 'memberJoined' || eventType === 'memberLeft') {
      const lineUserIds = lineMemberIds(eventType === 'memberJoined' ? rawEvent.joined : rawEvent.left);
      if (lineUserIds.length > 0) result.events.push({ kind: 'LIFECYCLE', event: {
        webhookEventId, replyToken, lineGroupId,
        type: eventType === 'memberJoined' ? 'MEMBER_JOINED' : 'MEMBER_LEFT', lineUserIds, lineTimestamp,
      } });
      continue;
    }
    if (eventType !== 'message' || !isRecord(rawEvent.message)) continue;
    const message = rawEvent.message;
    const messageType = asString(message.type);
    const lineMessageId = asString(message.id);
    if (!messageType || !supportedMessageTypes.has(messageType) || !lineMessageId) continue;
    const { textContent, metadata } = messageTextAndMetadata(message);
    result.events.push({ kind: 'MESSAGE', message: {
      webhookEventId, replyToken, lineGroupId, lineMessageId,
      quotedLineMessageId: asString(message.quotedMessageId), lineUserId: asString(source.userId),
      messageType, textContent, charCount: textContent?.length ?? 0,
      quoteToken: asString(message.quoteToken), lineTimestamp, metadata,
    } });
  }
  return result;
}

/** Parses LINE OA one-to-one events for the Worklog personal-source boundary. */
export function parseOaWebhook(payload: unknown): ParsedOaWebhook {
  const result: ParsedOaWebhook = { events: [] };
  if (!isRecord(payload) || !Array.isArray(payload.events)) return result;
  for (const rawEvent of payload.events) {
    if (!isRecord(rawEvent)) continue;
    const source = isRecord(rawEvent.source) ? rawEvent.source : null;
    if (!source || source.type !== 'user') continue;
    const lineUserId = asString(source.userId);
    if (!lineUserId) continue;
    const lineTimestamp = eventTimestamp(rawEvent);
    const webhookEventId = asString(rawEvent.webhookEventId);
    const replyToken = asString(rawEvent.replyToken);
    const eventType = asString(rawEvent.type);
    if (eventType === 'follow' || eventType === 'unfollow') {
      result.events.push({ kind: 'OA_LIFECYCLE', event: {
        webhookEventId, replyToken, lineUserId, type: eventType === 'follow' ? 'FOLLOW' : 'UNFOLLOW', lineTimestamp,
      } });
      continue;
    }
    if (eventType !== 'message' || !isRecord(rawEvent.message)) continue;
    const message = rawEvent.message;
    const messageType = asString(message.type);
    const lineMessageId = asString(message.id);
    if (!messageType || !supportedMessageTypes.has(messageType) || !lineMessageId) continue;
    const { textContent, metadata } = messageTextAndMetadata(message);
    result.events.push({ kind: 'PRIVATE_MESSAGE', message: {
      webhookEventId, replyToken, lineUserId, lineMessageId,
      quotedLineMessageId: asString(message.quotedMessageId), messageType, textContent,
      charCount: textContent?.length ?? 0, quoteToken: asString(message.quoteToken), lineTimestamp, metadata,
    } });
  }
  return result;
}
