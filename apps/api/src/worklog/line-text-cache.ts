export const WORKLOG_LINE_TEXT_CACHE_TTL_DAYS = 5;
export const WORKLOG_LINE_TEXT_CACHE_MAX_PER_GROUP = 1000;

export type CachedLineText = {
  lineMessageId: string;
  lineGroupId: string;
  lineUserId: string | null;
  text: string;
  lineTimestamp: Date;
  expiresAt: Date;
};

export interface WorklogLineTextCacheRepository {
  upsert(input: CachedLineText): Promise<void>;
  pruneGroup(lineGroupId: string, keepNewest: number, now: Date): Promise<void>;
  findActive(lineGroupId: string, lineMessageId: string, now: Date): Promise<CachedLineText | null>;
}

export class WorklogLineTextCacheService {
  constructor(private readonly repository: WorklogLineTextCacheRepository) {}

  async remember(input: {
    lineMessageId: string;
    lineGroupId: string;
    lineUserId: string | null;
    text: string;
    lineTimestamp: Date;
  }): Promise<void> {
    const text = input.text.trim();
    if (!text) return;
    const expiresAt = new Date(input.lineTimestamp.getTime() + WORKLOG_LINE_TEXT_CACHE_TTL_DAYS * 86_400_000);
    await this.repository.upsert({ ...input, text, expiresAt });
    await this.repository.pruneGroup(input.lineGroupId, WORKLOG_LINE_TEXT_CACHE_MAX_PER_GROUP, new Date());
  }

  async resolve(lineGroupId: string, quotedLineMessageId: string, now = new Date()): Promise<CachedLineText | null> {
    return this.repository.findActive(lineGroupId, quotedLineMessageId, now);
  }
}
