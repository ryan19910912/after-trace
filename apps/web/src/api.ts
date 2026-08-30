export type SportOption = { id: number; code: string; name: string };
export type VenueOption = {
  id: number;
  name: string;
  city: string;
  district: string | null;
  bookingUrl: string | null;
};
export type AvailabilitySlot = {
  slotId: number;
  venueId: number;
  venueName: string;
  district: string | null;
  sportCode: string;
  sportName: string;
  courtName: string | null;
  useDate: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  price: string | null;
  bookingUrl: string | null;
  lastSeenAt: string;
};

export type WatchRule = {
  id: number;
  sportId: number;
  sportCode: string;
  sportName: string;
  enabled: boolean;
  venueIds: number[];
  dateFrom: string | null;
  dateTo: string | null;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
  city: string;
  district: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWatchRule = {
  sport: string;
  enabled?: boolean;
  venueIds?: number[];
  dateFrom?: string | null;
  dateTo?: string | null;
  daysOfWeek?: number[];
  startTime?: string | null;
  endTime?: string | null;
  city?: string;
  district?: string | null;
};

export type PushConfig = {
  configured: boolean;
  applicationServerKey: string | null;
};

function apiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function getJson<T>(url: string): Promise<T> {
  return readJson<T>(await fetch(url, { headers: { Accept: 'application/json' } }));
}

async function authedJson<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return readJson<T>(await fetch(url, { ...init, headers }));
}

export async function fetchSports(baseUrl: string) {
  const body = await getJson<{ ok: true; sports: SportOption[] }>(apiUrl(baseUrl, '/api/v1/sports'));
  return body.sports;
}

export async function fetchVenues(baseUrl: string, sport?: string) {
  const params = new URLSearchParams();
  if (sport) params.set('sport', sport);
  const suffix = params.size ? `?${params.toString()}` : '';
  const body = await getJson<{ ok: true; venues: VenueOption[] }>(apiUrl(baseUrl, `/api/v1/venues${suffix}`));
  return body.venues;
}

export async function searchAvailability(
  baseUrl: string,
  input: {
    sport?: string;
    venueId?: number;
    district?: string;
    date?: string;
    start?: string;
    end?: string;
  },
) {
  const params = new URLSearchParams();
  if (input.sport) params.set('sport', input.sport);
  if (input.venueId) params.set('venueId', String(input.venueId));
  if (input.district) params.set('district', input.district);
  if (input.date) params.set('date', input.date);
  if (input.start) params.set('start', input.start);
  if (input.end) params.set('end', input.end);
  const body = await getJson<{ ok: true; slots: AvailabilitySlot[] }>(
    apiUrl(baseUrl, `/api/v1/availability?${params.toString()}`),
  );
  return body.slots;
}

export async function bootstrapAnonymousIdentity(baseUrl: string, existingToken: string | null) {
  async function request(token: string | null) {
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(apiUrl(baseUrl, '/api/v1/session/anonymous'), { method: 'POST', headers });
  }

  let response = await request(existingToken);
  if (response.status === 401 && existingToken) response = await request(null);
  const body = await readJson<{ ok: true; token: string; created: boolean }>(response);
  return body.token;
}

export async function fetchWatchRules(baseUrl: string, token: string) {
  const body = await authedJson<{ ok: true; watchRules: WatchRule[] }>(
    apiUrl(baseUrl, '/api/v1/watch-rules'),
    token,
  );
  return body.watchRules;
}

export async function createWatchRule(
  baseUrl: string,
  token: string,
  idempotencyKey: string,
  input: CreateWatchRule,
) {
  const body = await authedJson<{ ok: true; watchRule: WatchRule }>(
    apiUrl(baseUrl, '/api/v1/watch-rules'),
    token,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
  return body.watchRule;
}

export async function updateWatchRule(
  baseUrl: string,
  token: string,
  watchRuleId: number,
  patch: Partial<Omit<CreateWatchRule, 'sport'>>,
) {
  const body = await authedJson<{ ok: true; watchRule: WatchRule }>(
    apiUrl(baseUrl, `/api/v1/watch-rules/${watchRuleId}`),
    token,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return body.watchRule;
}

export async function deleteWatchRule(baseUrl: string, token: string, watchRuleId: number) {
  await authedJson<{ ok: true }>(
    apiUrl(baseUrl, `/api/v1/watch-rules/${watchRuleId}`),
    token,
    { method: 'DELETE' },
  );
}

export async function fetchPushConfig(baseUrl: string): Promise<PushConfig> {
  const body = await getJson<{ ok: true } & PushConfig>(apiUrl(baseUrl, '/api/v1/push/config'));
  return { configured: body.configured, applicationServerKey: body.applicationServerKey };
}

export async function registerPushSubscription(
  baseUrl: string,
  token: string,
  subscription: PushSubscriptionJSON,
) {
  const body = await authedJson<{ ok: true; subscription: { id: number; active: boolean } }>(
    apiUrl(baseUrl, '/api/v1/push/subscription'),
    token,
    { method: 'POST', body: JSON.stringify(subscription) },
  );
  return body.subscription;
}

export async function deactivatePushSubscription(baseUrl: string, token: string, endpoint: string) {
  await authedJson<{ ok: true }>(
    apiUrl(baseUrl, '/api/v1/push/subscription'),
    token,
    { method: 'DELETE', body: JSON.stringify({ endpoint }) },
  );
}
