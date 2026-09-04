export type WorklogInputType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
export type WorklogRecordStatus = 'ACTIVE' | 'DELETED';

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
  occurredAt: string;
  status: WorklogRecordStatus;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorklogEntity = {
  id: number;
  name: string;
  entityType: string | null;
  status: string;
  aliases: string[];
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
  previousOccurredAt: string;
  newOccurredAt: string;
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
  entityId?: number;
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type FundingGrant = {
  id: number;
  type: string;
  status: string;
  originalPoints: number;
  remainingPoints: number;
  effectiveAt: string;
  expiresAt: string | null;
  capPoints: number | null;
  usedPoints: number;
  reservedPoints: number;
  enabled: boolean;
  sourceAvailablePoints: number;
};

export type PersonalFunding = {
  sourceId: number;
  userId: number;
  availablePoints: number;
  reservedPoints: number;
  usedPoints: number;
  platformSubsidizedPoints: number;
  grants: FundingGrant[];
};

export type GroupFunding = {
  sourceId: number;
  responsibleUser: { id: number; displayName: string | null } | null;
  responsibleUserActive: boolean;
  availablePoints: number;
  reservedPoints: number;
  usedPoints: number;
  platformSubsidizedPoints: number;
  canManage: boolean;
  grants: FundingGrant[];
};

export type WorklogConfirmationCandidate = {
  entityId: number;
  name: string;
  matchedVia: 'ENTITY' | 'ALIAS' | 'FUZZY';
};

export type WorklogConfirmation = {
  id: number;
  sourceId: number;
  recordId: number;
  confirmationType: 'ALIAS_MATCH' | 'RECORD_TITLE' | 'ENTITY_MATCH';
  candidateEntityId: number | null;
  candidateTitle: string | null;
  proposedName: string | null;
  reason: string | null;
  operation: 'CREATE_TITLE' | 'LINE_AI_EDIT';
  proposedRawText: string | null;
  occurredAt: string;
  recordOccurredAt: string;
  expectedRecordVersion: number;
  candidates: WorklogConfirmationCandidate[];
  recordRawText: string;
  expiresAt: string | null;
  createdAt: string;
};

export type WorklogConfirmationDecision =
  | { action: 'USE_EXISTING'; entityId: number }
  | { action: 'CREATE_TITLE'; title?: string }
  | { action: 'REJECT' };

export type WorklogSurfaces = {
  personal: { sourceId: number } | null;
  groups: Array<{ sourceId: number; lineGroupId: string }>;
};

export type WebEntryContext =
  | { type: 'GROUP'; lineGroupId: string }
  | { type: 'PRIVATE'; userId: number; sourceId: number };

export type EntryExchange = {
  sessionToken: string;
  lineUserId: string;
  entryContext: WebEntryContext;
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

export type RecordScope =
  | { type: 'PERSONAL'; sourceId: number }
  | { type: 'GROUP'; sourceId: number };

export type ManualRecordInput = {
  entityId?: number;
  title?: string;
  rawText: string;
  occurredAt: string;
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
    // Defer navigation so the current promise rejects normally and React cleanup can run.
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

  async surfaces(sessionToken: string) {
    return (await json<{ surfaces: WorklogSurfaces }>(
      await this.request(sessionToken, '/api/v1/worklog/surfaces'),
      '紀錄範圍載入失敗',
    )).surfaces;
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

  async entities(sessionToken: string, scope: RecordScope, query?: string): Promise<WorklogEntity[]> {
    const path = scope.type === 'PERSONAL'
      ? '/api/v1/worklog/entities/personal'
      : `/api/v1/worklog/entities/group/${scope.sourceId}`;
    const suffix = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    const body = await json<{ entities: Array<Record<string, unknown>> }>(
      await this.request(sessionToken, `${path}${suffix}`),
      '紀錄標題載入失敗',
    );
    return body.entities.map(entityFromApi);
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
    input: { expectedVersion: number; rawText?: string; occurredAt?: string },
  ) {
    const body = await json<{ record: Record<string, unknown> }>(
      await this.request(sessionToken, `/api/v1/worklog/records/${recordId}`, this.body('PATCH', input)),
      '更新紀錄失敗',
    );
    return recordFromApi(body.record);
  }

  async moveRecord(
    sessionToken: string,
    recordId: number,
    input: { expectedVersion: number; entityId?: number; title?: string },
  ) {
    const body = await json<{ record: Record<string, unknown> }>(
      await this.request(sessionToken, `/api/v1/worklog/records/${recordId}/move`, this.body('POST', input)),
      '移動紀錄失敗',
    );
    return recordFromApi(body.record);
  }

  async batchMoveRecords(
    sessionToken: string,
    records: Array<{ id: number; expectedVersion: number }>,
    target: { entityId?: number; title?: string },
  ) {
    return json<{ updatedCount: number }>(
      await this.request(sessionToken, '/api/v1/worklog/records/batch-move', this.body('POST', { records, ...target })),
      '批次移動失敗',
    );
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

  async personalFunding(sessionToken: string): Promise<PersonalFunding> {
    const body = await json<{ funding: Record<string, unknown> }>(
      await this.request(sessionToken, '/api/v1/worklog/funding/personal'),
      '個人 AI 點數載入失敗',
    );
    return personalFundingFromApi(body.funding);
  }

  async groupFunding(sessionToken: string, sourceId: number): Promise<GroupFunding> {
    const body = await json<{ funding: Record<string, unknown> }>(
      await this.request(sessionToken, `/api/v1/worklog/funding/group/${sourceId}`),
      '群組 AI 點數載入失敗',
    );
    return groupFundingFromApi(body.funding);
  }

  async configureGroupGrant(
    sessionToken: string,
    sourceId: number,
    grantId: number,
    input: { enabled: boolean; capPoints: number | null },
  ): Promise<GroupFunding> {
    const body = await json<{ funding: Record<string, unknown> }>(
      await this.request(
        sessionToken,
        `/api/v1/worklog/funding/group/${sourceId}/grants/${grantId}`,
        this.body('PUT', input),
      ),
      '群組 AI 點數設定失敗',
    );
    return groupFundingFromApi(body.funding);
  }

  async pendingConfirmations(sessionToken: string, scope: RecordScope): Promise<WorklogConfirmation[]> {
    const path = scope.type === 'PERSONAL'
      ? '/api/v1/worklog/confirmations/personal'
      : `/api/v1/worklog/confirmations/group/${scope.sourceId}`;
    const body = await json<{ confirmations: Array<Record<string, unknown>> }>(
      await this.request(sessionToken, path),
      '待確認紀錄載入失敗',
    );
    return body.confirmations.map(confirmationFromApi);
  }

  async resolveConfirmation(
    sessionToken: string,
    scope: RecordScope,
    confirmationId: number,
    decision: WorklogConfirmationDecision,
  ) {
    const path = scope.type === 'PERSONAL'
      ? `/api/v1/worklog/confirmations/personal/${confirmationId}/resolve`
      : `/api/v1/worklog/confirmations/group/${scope.sourceId}/${confirmationId}/resolve`;
    return json<{ resolution: Record<string, unknown> }>(
      await this.request(sessionToken, path, this.body('POST', decision)),
      '待確認紀錄處理失敗',
    );
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
    const response = await this.request(sessionToken, '/api/v1/subscription/plans');
    const value = await json<{
      currentPlanCode: string;
      checkoutEnabled: boolean;
      plans: SubscriptionPlan[];
    }>(response, '方案載入失敗');
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
    if (filters.entityId) params.set('entityId', String(filters.entityId));
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
    inputType: String(raw.input_type ?? raw.inputType) as WorklogInputType,
    rawText: String(raw.raw_text ?? raw.rawText ?? ''),
    occurredAt: String(raw.occurred_at ?? raw.occurredAt),
    status: String(raw.status) as WorklogRecordStatus,
    version: Number(raw.version),
    deletedAt: nullableString(raw.deleted_at ?? raw.deletedAt),
    createdAt: String(raw.created_at ?? raw.createdAt),
    updatedAt: String(raw.updated_at ?? raw.updatedAt),
  };
}

function entityFromApi(raw: Record<string, unknown>): WorklogEntity {
  return {
    id: Number(raw.id),
    name: String(raw.name),
    entityType: nullableString(raw.entity_type ?? raw.entityType),
    status: String(raw.status),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
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
    previousOccurredAt: String(raw.previous_occurred_at ?? raw.previousOccurredAt),
    newOccurredAt: String(raw.new_occurred_at ?? raw.newOccurredAt),
    previousEntityId: nullableNumber(raw.previous_entity_id ?? raw.previousEntityId),
    previousTitle: nullableString(raw.previous_title ?? raw.previousTitle),
    newEntityId: nullableNumber(raw.new_entity_id ?? raw.newEntityId),
    newTitle: nullableString(raw.new_title ?? raw.newTitle),
    previousStatus: String(raw.previous_status ?? raw.previousStatus) as WorklogRecordStatus,
    newStatus: String(raw.new_status ?? raw.newStatus) as WorklogRecordStatus,
    createdAt: String(raw.created_at ?? raw.createdAt),
  };
}

function personalFundingFromApi(raw: Record<string, unknown>): PersonalFunding {
  return {
    sourceId: Number(raw.sourceId),
    userId: Number(raw.userId),
    availablePoints: nonNegativeNumber(raw.availablePoints),
    reservedPoints: nonNegativeNumber(raw.reservedPoints),
    usedPoints: nonNegativeNumber(raw.usedPoints),
    platformSubsidizedPoints: nonNegativeNumber(raw.platformSubsidizedPoints),
    grants: Array.isArray(raw.grants)
      ? raw.grants.map((value) => fundingGrantFromApi(value as Record<string, unknown>))
      : [],
  };
}

function groupFundingFromApi(raw: Record<string, unknown>): GroupFunding {
  const responsible = raw.responsibleUser;
  const responsibleUser = responsible && typeof responsible === 'object' && !Array.isArray(responsible)
    ? {
        id: Number((responsible as Record<string, unknown>).id),
        displayName: nullableString((responsible as Record<string, unknown>).displayName),
      }
    : null;
  return {
    sourceId: Number(raw.sourceId),
    responsibleUser,
    responsibleUserActive: Boolean(raw.responsibleUserActive),
    availablePoints: nonNegativeNumber(raw.availablePoints),
    reservedPoints: nonNegativeNumber(raw.reservedPoints),
    usedPoints: nonNegativeNumber(raw.usedPoints),
    platformSubsidizedPoints: nonNegativeNumber(raw.platformSubsidizedPoints),
    canManage: Boolean(raw.canManage),
    grants: Array.isArray(raw.grants)
      ? raw.grants.map((value) => fundingGrantFromApi(value as Record<string, unknown>))
      : [],
  };
}

function fundingGrantFromApi(raw: Record<string, unknown>): FundingGrant {
  return {
    id: Number(raw.id),
    type: String(raw.type ?? ''),
    status: String(raw.status ?? ''),
    originalPoints: nonNegativeNumber(raw.original_points ?? raw.originalPoints),
    remainingPoints: nonNegativeNumber(raw.remaining_points ?? raw.remainingPoints),
    effectiveAt: String(raw.effective_at ?? raw.effectiveAt ?? ''),
    expiresAt: nullableString(raw.expires_at ?? raw.expiresAt),
    capPoints: nullableNumber(raw.cap_points ?? raw.capPoints),
    usedPoints: nonNegativeNumber(raw.scope_used_points ?? raw.usedPoints),
    reservedPoints: nonNegativeNumber(raw.scope_reserved_points ?? raw.reservedPoints),
    enabled: Boolean(raw.scope_enabled ?? raw.enabled),
    sourceAvailablePoints: nonNegativeNumber(raw.source_available_points ?? raw.sourceAvailablePoints),
  };
}

function confirmationFromApi(raw: Record<string, unknown>): WorklogConfirmation {
  const operation = String(raw.operation ?? 'CREATE_TITLE') === 'LINE_AI_EDIT' ? 'LINE_AI_EDIT' : 'CREATE_TITLE';
  return {
    id: Number(raw.id),
    sourceId: Number(raw.sourceId ?? raw.source_id),
    recordId: Number(raw.recordId ?? raw.record_id),
    confirmationType: String(raw.confirmationType ?? raw.confirmation_type) as WorklogConfirmation['confirmationType'],
    candidateEntityId: nullableNumber(raw.candidateEntityId ?? raw.candidate_entity_id),
    candidateTitle: nullableString(raw.candidateTitle ?? raw.candidate_title),
    proposedName: nullableString(raw.proposedName ?? raw.proposed_name),
    reason: nullableString(raw.reason),
    operation,
    proposedRawText: operation === 'LINE_AI_EDIT' ? nullableString(raw.proposedRawText ?? raw.proposed_raw_text) : null,
    occurredAt: String(raw.occurredAt ?? raw.occurred_at),
    recordOccurredAt: String(raw.recordOccurredAt ?? raw.record_occurred_at ?? raw.occurredAt ?? raw.occurred_at),
    expectedRecordVersion: Number(raw.expectedRecordVersion ?? raw.expected_record_version),
    candidates: Array.isArray(raw.candidates)
      ? raw.candidates.map((value) => {
          const candidate = value as Record<string, unknown>;
          return {
            entityId: Number(candidate.entityId ?? candidate.entity_id),
            name: String(candidate.name ?? ''),
            matchedVia: String(candidate.matchedVia ?? candidate.matched_via) as WorklogConfirmationCandidate['matchedVia'],
          };
        })
      : [],
    recordRawText: String(raw.recordRawText ?? raw.record_raw_text ?? ''),
    expiresAt: nullableString(raw.expiresAt ?? raw.expires_at),
    createdAt: String(raw.createdAt ?? raw.created_at),
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
