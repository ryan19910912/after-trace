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
  externalBookingRef: string | null;
  lastSeenAt: string;
};

function apiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
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
