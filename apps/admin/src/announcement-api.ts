import { normalizeAdminApiTimestamps, type AdminApi, type Row } from './api';

export type AdminAnnouncementStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
export type AdminAnnouncementAudience = 'ALL_USERS' | 'FREE_USERS' | 'AI_SUBSCRIBERS' | 'SPECIFIC_USERS';
export type AdminAnnouncementMode = 'DRAFT' | 'SEND_NOW' | 'SCHEDULED';

export type AdminAnnouncementSummary = {
  id: number;
  status: AdminAnnouncementStatus;
  audience: AdminAnnouncementAudience;
  title: string;
  body: string;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  deepLink: string | null;
  scheduledAt: string | null;
  dispatchStartedAt: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  createdByActor: string | null;
  createdAt: string;
  updatedAt: string;
  recipientCount: number;
  unreadCount: number;
  pushSentCount: number;
  pushFailedCount: number;
};

export type AdminAnnouncementInput = {
  title: string;
  body: string;
  audience: AdminAnnouncementAudience;
  specificUserIds: number[];
  inAppEnabled: boolean;
  pushEnabled: boolean;
  deepLink: string | null;
  mode: AdminAnnouncementMode;
  scheduledAt: string | null;
};

export type AdminAnnouncementPreview = AdminAnnouncementInput;

export type AdminAnnouncementUserOption = {
  id: number;
  publicAccountId: string;
  displayName: string;
  planCode: string;
};

export class AdminAnnouncementApi {
  private sessionToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setSessionToken(token: string | null) {
    this.sessionToken = token?.trim() || null;
  }

  async announcements(limit = 100): Promise<AdminAnnouncementSummary[]> {
    const bounded = Number.isSafeInteger(limit) && limit > 0 && limit <= 200 ? limit : 100;
    return (await this.request<{ announcements: AdminAnnouncementSummary[] }>(
      `/notifications/announcements?limit=${bounded}`,
    )).announcements;
  }

  async announcement(id: number): Promise<AdminAnnouncementSummary> {
    return (await this.request<{ announcement: AdminAnnouncementSummary }>(
      `/notifications/announcements/${positiveId(id)}`,
    )).announcement;
  }

  async preview(input: AdminAnnouncementInput): Promise<AdminAnnouncementPreview> {
    return (await this.request<{ preview: AdminAnnouncementPreview }>('/notifications/announcements/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    })).preview;
  }

  async create(input: AdminAnnouncementInput): Promise<AdminAnnouncementSummary> {
    return (await this.request<{ announcement: AdminAnnouncementSummary }>('/notifications/announcements', {
      method: 'POST',
      body: JSON.stringify(input),
    })).announcement;
  }

  async send(id: number): Promise<AdminAnnouncementSummary> {
    return (await this.request<{ announcement: AdminAnnouncementSummary }>(
      `/notifications/announcements/${positiveId(id)}/send`,
      { method: 'POST' },
    )).announcement;
  }

  async cancel(id: number): Promise<AdminAnnouncementSummary> {
    return (await this.request<{ announcement: AdminAnnouncementSummary }>(
      `/notifications/announcements/${positiveId(id)}`,
      { method: 'DELETE' },
    )).announcement;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('Content-Type', 'application/json');
    if (this.sessionToken) headers.set('Authorization', `Bearer ${this.sessionToken}`);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin${path}`, { ...init, headers });
    const text = await response.text();
    let body: ({ ok?: boolean; error?: string } & T) | null = null;
    try {
      body = text ? JSON.parse(text) as { ok?: boolean; error?: string } & T : {} as { ok?: boolean; error?: string } & T;
    } catch {
      throw new Error(`ADMIN_API_INVALID_RESPONSE_${response.status}`);
    }
    const normalized = normalizeAdminApiTimestamps(body) as { ok?: boolean; error?: string } & T;
    if (!response.ok) throw new Error(normalized.error || `ADMIN_API_FAILED_${response.status}`);
    return normalized;
  }
}

export async function searchAnnouncementUsers(api: AdminApi, query: string): Promise<AdminAnnouncementUserOption[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const rows = await api.accountLookup(normalized);
  return rows.flatMap((row) => toUserOption(row));
}

function toUserOption(row: Row): AdminAnnouncementUserOption[] {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  return [{
    id,
    publicAccountId: String(row.public_account_id ?? row.publicAccountId ?? '').trim(),
    displayName: String(row.display_name ?? row.displayName ?? '').trim() || `使用者 #${id}`,
    planCode: String(row.plan_code ?? row.planCode ?? '').trim(),
  }];
}

function positiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_NOTIFICATION_ID');
  return value;
}
