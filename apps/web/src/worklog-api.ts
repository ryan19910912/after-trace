export type WorklogInputType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
export type WorklogRecordStatus = 'ACTIVE' | 'DELETED';
export type NativeGroupRole = 'OWNER' | 'MEMBER';

const WEB_SESSION_KEY = 'aftertrace.worklog.session';
const WEB_SCOPE_KEY = 'aftertrace.worklog.scope';

export type WorklogRecord = {
  id: number;
  sourceId: number;
  entityId: number | null;
  title: string | null;
  authorUserId: number | null;
  authorDisplayName: string | null;
  inputType: WorklogInputType;
  rawText: string;
  occurredAt: string | null;
  status: WorklogRecordStatus;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorklogRecordRevision = {
  id: number;
  recordId: number;
  version: number;
  editorUserId: number | null;
  editorDisplayName: string | null;
  channel: string;
  previousRawText: string;
  newRawText: string;
  previousOccurredAt: string | null;
  newOccurredAt: string | null;
  previousEntityId: number | null;
  previousTitle: string | null;
  newEntityId: number | null;
  newTitle: string | null;
  previousStatus: WorklogRecordStatus;
  newStatus: WorklogRecordStatus;
  createdAt: string;
};

export type RecordPage = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type RecordFilters = {
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type WorklogGroupSurface = {
  sourceId: number;
  name: string;
  role: NativeGroupRole;
  legacyLineGroupId: string | null;
};

export type WorklogSurfaces = {
  personal: { sourceId: number } | null;
  groups: WorklogGroupSurface[];
};

/** Migration-only deep-link context retained while old LINE entry links still exist. */
export type WebEntryContext =
  | { type: 'GROUP'; lineGroupId: string }
  | { type: 'PRIVATE'; userId: number; sourceId: number };

export type EntryExchange = {
  sessionToken: string;
  lineUserId?: string;
  entryContext: WebEntryContext;
};

export type RecordScope =
  | { type: 'PERSONAL'; sourceId: number }
  | { type: 'GROUP'; sourceId: number };

export type ManualRecordInput = {
  rawText: string;
  occurredAt?: string | null;
  /** Legacy compatibility only. New free/manual clients do not require a title. */
  title?: string | null;
  /** Legacy compatibility only. New free/manual clients do not require an Entity. */
  entityId?: number;
};

export type NativeGroupSummary = {
  sourceId: number;
  name: string;
  role: NativeGroupRole;
};

export type NativeGroupInvite = {
  id: number;
  sourceId: number;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedNativeGroupInvite = {
  invite: NativeGroupInvite;
  inviteToken: string;
};

export type SubscriptionPlan = {
  code: string;
  display_name: string;
  price_twd: string;
  rank: number;
  subscription_period_points: number;
  one_time_initial_points?: number;
  capabilities: Record<string, unknown>;
  current: boolean;
};

export type SubscriptionPlans = {
  currentPlanCode: string;
  checkoutEnabled: boolean;
  plans: SubscriptionPlan[];
};

export type CheckoutIntent = {
  id: string;
  plan_code: string;
  status: string;
  checkout_url: string | null;
  created_at: string;
  checkoutEnabled: boolean;
  providerConfigured: boolean;
  message?: string;
};

async function json<T>(response: Response, fallback: string): Promise<T & { error?: string }> {
  const text = await response.text();
  let body: T & { error?: string };
  try {
    body = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string };
  } catch {
    throw new Error(`${fallback} (${response.status})`);
  }
  if (!response.ok) {
    const error = body.error || `${fallback} (${response.status})`;
    if (response.status === 401 && /^(?:INVALID_WEB_SESSION|WEB_SESSION_REQUIRED)$/.test(error)) {
      recoverExpiredWebSession();
    }
    if (response.status === 409 && error === 'RECORD_VERSION_CONFLICT') {
      recoverRecordVersionConflict();
    }
    throw new Error(error);
  }
  return body;
}

function recoverExpiredWebSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(WEB_SESSION_KEY);
    window.localStorage.removeItem(WEB_SCOPE_KEY);
  } finally {
    window.setTimeout(() => window.location.reload(), 0);
  }
}

function recoverRecordVersionConflict(): void {
  if (typeof window === 'undefined') return;
  window.alert('這筆紀錄已被其他人更新。AFTERTRACE 將重新載入最新版，請確認後再修改。');
  window.setTimeout(() => window.location.reload(), 0);
}

export class WorklogApi {
  constructor(private readonly baseUrl: string) {}

  private base(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  /** Migration-era authentication entry. Target auth will replace this without changing Web domain APIs. */
  lineLoginUrl() {
    return this.base('/api/v1/auth/line/start');
  }

  async exchangeEntry(token: string) {
    return json<EntryExchange>(await fetch(this.base('/api/v1/auth/entry/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }), '登入連結驗證失敗');
  }

  async surfaces(sessionToken: string): Promise<WorklogSurfaces> {
    const body = await json<{ surfaces: Record<string, unknown> }>(
      await this.request(sessionToken, '/api/v1/worklog/surfaces'),
      '紀錄範圍載入失敗',
    );
    return surfacesFromApi(body.surfaces);
  }

  async personalRecords(
    sessionToken: string,
    filters: RecordFilters = {},
  ): Promise<{ records: WorklogRecord[]; page: RecordPage }> {
    return this.recordPage(sessionToken, '/api/v1/worklog/records/personal', filters, '個人紀錄載入失敗');
  }

  async groupRecords(
    sessionToken: string,
    sourceId: number,
    filters: RecordFilters = {},
  ): Promise<{ records: WorklogRecord[]; page: RecordPage }> {
    return this.recordPage(sessionToken, `/api/v1/worklog/records/group/${sourceId}`, filters, '群組紀錄載入失敗');
  }

  async deletedRecords(
    sessionToken: string,
    scope: RecordScope,
    filters: RecordFilters = {},
  ): Promise<{ records: WorklogRecord[]; page: RecordPage }> {
    const path = scope.type === 'PERSONAL'
      ? '/api/v1/worklog/records/personal/deleted'
      : `/api/v1/worklog/records/group/${scope.sourceId}/deleted`;
    return this.recordPage(sessionToken, path, filters, '回收桶載入失敗');
  }

  async createRecord(sessionToken: string, scope: RecordScope, input: ManualRecordInput) {
    const path = scope.type === 'PERSONAL'
      ? '/api/v1/worklog/records/personal'
      : `/api/v1/worklog/records/group/${scope.sourceId}`;
    const body = await json<{ record: Record<string, unknown> }>(
      await this.request(sessionToken, path, this.body('POST', input)),
      '新增紀錄失敗',
    );
    return recordFromApi(body.record);
  }

  async updateRecord(
    sessionToken: string,
    recordId: number,
    input: { expectedVersion: number; rawText?: string; occurredAt?: string | null },
  ) {
    const body = await json<{ record: Record<string, unknown> }>(
      await this.request(sessionToken, `/api/v1/worklog/records/${recordId}`, this.body('PATCH', input)),
      '更新紀錄失敗',
    );
    return recordFromApi(body.record);
  }

  async deleteRecord(sessionToken: string, recordId: number, expectedVersion: number) {
    const body = await json<{ record: Record<string, unknown> }>(
      await this.request(
        sessionToken,
        `/api/v1/worklog/records/${recordId}`,
        this.body('DELETE', { expectedVersion }),
      ),
      '刪除紀錄失敗',
    );
    return recordFromApi(body.record);
  }

  async restoreRecord(sessionToken: string, recordId: number, expectedVersion: number) {
    const body = await json<{ record: Record<string, unknown> }>(
      await this.request(
        sessionToken,
        `/api/v1/worklog/records/${recordId}/restore`,
        this.body('POST', { expectedVersion }),
      ),
      '還原紀錄失敗',
    );
    return recordFromApi(body.record);
  }

  async recordRevisions(sessionToken: string, recordId: number): Promise<WorklogRecordRevision[]> {
    const body = await json<{ revisions: Array<Record<string, unknown>> }>(
      await this.request(sessionToken, `/api/v1/worklog/records/${recordId}/revisions`),
      '編輯紀錄載入失敗',
    );
    return body.revisions.map(revisionFromApi);
  }

  async groups(sessionToken: string): Promise<NativeGroupSummary[]> {
    const body = await json<{ groups: Array<Record<string, unknown>> }>(
      await this.request(sessionToken, '/api/v1/groups'),
      '群組載入失敗',
    );
    return body.groups.map(nativeGroupFromApi);
  }

  async createGroup(sessionToken: string, name: string): Promise<NativeGroupSummary> {
    const body = await json<{ group: Record<string, unknown> }>(
      await this.request(sessionToken, '/api/v1/groups', this.body('POST', { name })),
      '建立群組失敗',
    );
    return nativeGroupFromApi(body.group);
  }

  async createGroupInvite(
    sessionToken: string,
    sourceId: number,
    input: { expiresAt?: string | null; maxUses?: number | null } = {},
  ): Promise<CreatedNativeGroupInvite> {
    const body = await json<{ invite: Record<string, unknown>; inviteToken: string }>(
      await this.request(sessionToken, `/api/v1/groups/${sourceId}/invites`, this.body('POST', input)),
      '建立邀請失敗',
    );
    return { invite: nativeGroupInviteFromApi(body.invite), inviteToken: String(body.inviteToken) };
  }

  async revokeGroupInvite(sessionToken: string, sourceId: number, inviteId: number): Promise<void> {
    await json(
      await this.request(sessionToken, `/api/v1/groups/${sourceId}/invites/${inviteId}`, { method: 'DELETE' }),
      '撤銷邀請失敗',
    );
  }

  async joinGroup(sessionToken: string, inviteToken: string): Promise<{ status: 'JOINED' | 'ALREADY_MEMBER'; group: NativeGroupSummary }> {
    const body = await json<{ status: 'JOINED' | 'ALREADY_MEMBER'; group: Record<string, unknown> }>(
      await this.request(sessionToken, '/api/v1/groups/join', this.body('POST', { token: inviteToken })),
      '加入群組失敗',
    );
    return { status: body.status, group: nativeGroupFromApi(body.group) };
  }

  async submitFeedback(
    sessionToken: string,
    text: string,
    context: Record<string, string | number>,
  ) {
    await json(
      await this.request(sessionToken, '/api/v1/worklog/feedback', this.body('POST', { text, context })),
      '意見送出失敗',
    );
  }

  async subscriptionPlans(sessionToken: string): Promise<SubscriptionPlans> {
    const value = await json<SubscriptionPlans>(
      await this.request(sessionToken, '/api/v1/subscription/plans'),
      '方案載入失敗',
    );
    return {
      currentPlanCode: value.currentPlanCode,
      checkoutEnabled: value.checkoutEnabled,
      plans: value.plans,
    };
  }

  async createCheckoutIntent(
    sessionToken: string,
    planCode: string,
    requestKey: string,
  ): Promise<CheckoutIntent> {
    return (await json<{ intent: CheckoutIntent }>(
      await this.request(
        sessionToken,
        '/api/v1/subscription/checkout-intents',
        this.body('POST', { planCode, requestKey }),
      ),
      '付款流程建立失敗',
    )).intent;
  }

  private async recordPage(
    sessionToken: string,
    path: string,
    filters: RecordFilters,
    fallback: string,
  ) {
    const params = new URLSearchParams();
    if (filters.query?.trim()) params.set('q', filters.query.trim());
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    const suffix = params.toString() ? `?${params}` : '';
    const body = await json<{ records: Record<string, unknown>[]; page: RecordPage }>(
      await this.request(sessionToken, `${path}${suffix}`),
      fallback,
    );
    return { records: body.records.map(recordFromApi), page: body.page };
  }

  private body(method: string, value: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    };
  }

  private request(sessionToken: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(this.base(path), { ...init, headers });
  }
}

function recordFromApi(raw: Record<string, unknown>): WorklogRecord {
  return {
    id: Number(raw.id),
    sourceId: Number(raw.source_id ?? raw.sourceId),
    entityId: nullableNumber(raw.entity_id ?? raw.entityId),
    title: nullableString(raw.title),
    authorUserId: nullableNumber(raw.author_user_id ?? raw.authorUserId),
    authorDisplayName: nullableString(raw.author_display_name ?? raw.authorDisplayName),
    inputType: String(raw.input_type ?? raw.inputType ?? 'TEXT') as WorklogInputType,
    rawText: String(raw.raw_text ?? raw.rawText ?? raw.content ?? ''),
    occurredAt: nullableString(raw.occurred_at ?? raw.occurredAt),
    status: String(raw.status) as WorklogRecordStatus,
    version: Number(raw.version),
    deletedAt: nullableString(raw.deleted_at ?? raw.deletedAt),
    createdAt: String(raw.created_at ?? raw.createdAt),
    updatedAt: String(raw.updated_at ?? raw.updatedAt),
  };
}

function revisionFromApi(raw: Record<string, unknown>): WorklogRecordRevision {
  return {
    id: Number(raw.id),
    recordId: Number(raw.record_id ?? raw.recordId),
    version: Number(raw.version),
    editorUserId: nullableNumber(raw.editor_user_id ?? raw.editorUserId),
    editorDisplayName: nullableString(raw.editor_display_name ?? raw.editorDisplayName),
    channel: String(raw.channel),
    previousRawText: String(raw.previous_raw_text ?? raw.previousRawText ?? ''),
    newRawText: String(raw.new_raw_text ?? raw.newRawText ?? ''),
    previousOccurredAt: nullableString(raw.previous_occurred_at ?? raw.previousOccurredAt),
    newOccurredAt: nullableString(raw.new_occurred_at ?? raw.newOccurredAt),
    previousEntityId: nullableNumber(raw.previous_entity_id ?? raw.previousEntityId),
    previousTitle: nullableString(raw.previous_title ?? raw.previousTitle),
    newEntityId: nullableNumber(raw.new_entity_id ?? raw.newEntityId),
    newTitle: nullableString(raw.new_title ?? raw.newTitle),
    previousStatus: String(raw.previous_status ?? raw.previousStatus) as WorklogRecordStatus,
    newStatus: String(raw.new_status ?? raw.newStatus) as WorklogRecordStatus,
    createdAt: String(raw.created_at ?? raw.createdAt),
  };
}

function surfacesFromApi(raw: Record<string, unknown>): WorklogSurfaces {
  const personalRaw = raw.personal;
  const personal = personalRaw && typeof personalRaw === 'object' && !Array.isArray(personalRaw)
    ? { sourceId: Number((personalRaw as Record<string, unknown>).sourceId ?? (personalRaw as Record<string, unknown>).source_id) }
    : null;
  const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
  return {
    personal,
    groups: groupsRaw.map((value) => {
      const group = value as Record<string, unknown>;
      return {
        sourceId: Number(group.sourceId ?? group.source_id),
        name: String(group.name ?? '未命名群組'),
        role: (String(group.role) === 'OWNER' ? 'OWNER' : 'MEMBER') as NativeGroupRole,
        legacyLineGroupId: nullableString(group.legacyLineGroupId ?? group.legacy_line_group_id ?? group.lineGroupId ?? group.line_group_id),
      };
    }),
  };
}

function nativeGroupFromApi(raw: Record<string, unknown>): NativeGroupSummary {
  return {
    sourceId: Number(raw.sourceId ?? raw.source_id),
    name: String(raw.name ?? ''),
    role: (String(raw.role) === 'OWNER' ? 'OWNER' : 'MEMBER') as NativeGroupRole,
  };
}

function nativeGroupInviteFromApi(raw: Record<string, unknown>): NativeGroupInvite {
  return {
    id: Number(raw.id),
    sourceId: Number(raw.sourceId ?? raw.source_id),
    expiresAt: nullableString(raw.expiresAt ?? raw.expires_at),
    maxUses: nullableNumber(raw.maxUses ?? raw.max_uses),
    useCount: Number(raw.useCount ?? raw.use_count ?? 0),
    revokedAt: nullableString(raw.revokedAt ?? raw.revoked_at),
    createdAt: String(raw.createdAt ?? raw.created_at),
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
