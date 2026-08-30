import type {
  AvailabilitySourceAdapter,
  SourceAvailabilitySlot,
  SourceBookableDateQuery,
  SourceSport,
  SourceVenue,
} from './types';

const DEFAULT_BASE_URL = 'https://booking-tpsc.sporetrofit.com';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export const TAIPEI_SPORTS_CENTER_VENUES: readonly SourceVenue[] = [
  { externalVenueId: 'JJSC', name: '中正運動中心', city: '臺北市', district: '中正區' },
  { externalVenueId: 'NHSC', name: '內湖運動中心', city: '臺北市', district: '內湖區' },
  { externalVenueId: 'BTSC', name: '北投運動中心', city: '臺北市', district: '北投區' },
  { externalVenueId: 'DASC', name: '大安運動中心', city: '臺北市', district: '大安區' },
  { externalVenueId: 'DTSC', name: '大同運動中心', city: '臺北市', district: '大同區' },
  { externalVenueId: 'SLSC', name: '士林運動中心', city: '臺北市', district: '士林區' },
  { externalVenueId: 'SSSC', name: '松山運動中心', city: '臺北市', district: '松山區' },
  { externalVenueId: 'WHSC', name: '萬華運動中心', city: '臺北市', district: '萬華區' },
  { externalVenueId: 'WSSC', name: '文山運動中心', city: '臺北市', district: '文山區' },
  { externalVenueId: 'XYSC', name: '信義運動中心', city: '臺北市', district: '信義區' },
  { externalVenueId: 'ZSSC', name: '中山運動中心', city: '臺北市', district: '中山區' },
] as const;

export const TAIPEI_SPORTS_CENTER_SPORTS: readonly SourceSport[] = [
  { externalCategoryId: 'Badminton', code: 'badminton', name: '羽球' },
  { externalCategoryId: 'Basketball', code: 'basketball', name: '籃球' },
  { externalCategoryId: 'Billiard', code: 'billiard', name: '撞球' },
  { externalCategoryId: 'Golf', code: 'golf', name: '高爾夫球' },
  { externalCategoryId: 'Squash', code: 'squash', name: '壁球' },
  { externalCategoryId: 'TableTennis', code: 'table-tennis', name: '桌球' },
] as const;

export class TaipeiSportsCenterSourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TaipeiSportsCenterSourceError';
  }
}

export class TaipeiSportsCenterAdapter implements AvailabilitySourceAdapter {
  readonly code = 'taipei-sports-center';
  readonly name = '臺北市運動中心預約系統';
  readonly minPollIntervalSeconds = 60;

  constructor(
    private readonly fetcher: Fetcher = fetch,
    readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async listVenues(): Promise<SourceVenue[]> {
    return TAIPEI_SPORTS_CENTER_VENUES.map((venue) => ({
      ...venue,
      bookingUrl: this.baseUrl,
    }));
  }

  async listSports(_externalVenueId: string): Promise<SourceSport[]> {
    return TAIPEI_SPORTS_CENTER_SPORTS.map((sport) => ({ ...sport }));
  }

  async listBookableDates(input: SourceBookableDateQuery): Promise<string[]> {
    assertIsoDate(input.startDate, 'startDate');
    assertIsoDate(input.endDate, 'endDate');
    const categoryId = this.resolveCategoryId(input.sportCode, input.externalCategoryId);
    const payload = await this.postForm('/Location/findAllowBookingCalendars', {
      LID: input.externalVenueId,
      categoryId,
      start: input.startDate,
      end: input.endDate,
    });
    const items = extractCollection(payload);
    const dates = new Set<string>();
    for (const item of items) {
      const raw = firstString(item, ['start', 'Start', 'UseDate', 'useDate', 'date']);
      if (!raw) continue;
      const date = raw.slice(0, 10);
      if (ISO_DATE.test(date)) dates.add(date);
    }
    return [...dates].sort();
  }

  async listAvailability(input: {
    externalVenueId: string;
    sportCode: string;
    externalCategoryId?: string;
    useDate: string;
  }): Promise<SourceAvailabilitySlot[]> {
    assertIsoDate(input.useDate, 'useDate');
    const categoryId = this.resolveCategoryId(input.sportCode, input.externalCategoryId);
    const query = new URLSearchParams({
      LID: input.externalVenueId,
      categoryId,
      useDate: input.useDate,
    });
    const payload = await this.postForm(`/Location/findAllowBookingList?${query.toString()}`, {
      rows: '200',
      page: '1',
      sord: 'asc',
    });
    const rows = extractCollection(payload);
    const parsed = rows.flatMap((row) => {
      const slot = this.parseSlot(row, input.externalVenueId, input.sportCode, categoryId, input.useDate);
      return slot ? [slot] : [];
    });
    if (rows.length > 0 && parsed.length === 0) {
      throw new TaipeiSportsCenterSourceError('Booking-list payload contained rows but none were parseable', 'INVALID_BOOKING_PAYLOAD');
    }
    return parsed;
  }

  private parseSlot(
    row: JsonRecord,
    externalVenueId: string,
    sportCode: string,
    categoryId: string,
    useDate: string,
  ): SourceAvailabilitySlot | null {
    const externalCourtId = firstString(row, ['LSID', 'CourtId', 'courtId', 'VenueId', 'venueId']);
    const courtName = firstString(row, ['LSIDName', 'CourtName', 'courtName', 'VenueName', 'venueName']);
    const startTime = parseTime(row.StartTime ?? row.startTime);
    const endTime = parseTime(row.EndTime ?? row.endTime);
    if (!externalCourtId || !startTime || !endTime) return null;

    const allowBooking = row.allowBooking;
    const status = allowBooking == null
      ? parseFallbackAvailability(row)
      : String(allowBooking).toUpperCase() === 'Y'
        ? 'AVAILABLE'
        : String(allowBooking).toUpperCase() === 'N'
          ? 'UNAVAILABLE'
          : 'UNKNOWN';
    const price = parsePrice(row.TotalPrice ?? row.Price ?? row.price ?? row.Fee ?? row.fee);
    const bookingRef = `${this.baseUrl}/Location/findAllowBookingList?${new URLSearchParams({
      LID: externalVenueId,
      categoryId,
      useDate,
    }).toString()}`;

    return {
      externalSlotKey: [externalVenueId, categoryId, useDate, externalCourtId, startTime, endTime].join('|'),
      externalVenueId,
      sportCode,
      externalCourtId,
      courtName: courtName ?? externalCourtId,
      useDate,
      startTime,
      endTime,
      status,
      ...(price ? { price } : {}),
      externalBookingRef: bookingRef,
    };
  }

  private resolveCategoryId(sportCode: string, explicit?: string): string {
    if (explicit?.trim()) return explicit.trim();
    const sport = TAIPEI_SPORTS_CENTER_SPORTS.find((candidate) => candidate.code === sportCode);
    if (!sport?.externalCategoryId) {
      throw new TaipeiSportsCenterSourceError(`Unsupported sport code: ${sportCode}`, 'UNSUPPORTED_SPORT');
    }
    return sport.externalCategoryId;
  }

  private async postForm(path: string, fields: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const body = new URLSearchParams(fields).toString();
    const delays = [250, 750];
    let lastError: TaipeiSportsCenterSourceError | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: `${this.baseUrl}/`,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body,
        });
      } catch (cause) {
        lastError = new TaipeiSportsCenterSourceError(
          cause instanceof Error ? cause.message : 'Source network request failed',
          'NETWORK_ERROR',
        );
        if (attempt === delays.length) throw lastError;
        await sleep(delays[attempt]);
        continue;
      }

      if (!response.ok) {
        const retryable = response.status === 302 || response.status === 429 || response.status >= 500;
        lastError = new TaipeiSportsCenterSourceError(
          `Source returned HTTP ${response.status}`,
          retryable ? 'SOURCE_RETRYABLE_HTTP' : 'SOURCE_HTTP_ERROR',
          response.status,
        );
        if (!retryable || attempt === delays.length) throw lastError;
        await sleep(delays[attempt]);
        continue;
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new TaipeiSportsCenterSourceError('Source returned a non-JSON success payload', 'INVALID_JSON');
      }
    }

    throw lastError ?? new TaipeiSportsCenterSourceError('Source request failed', 'SOURCE_REQUEST_FAILED');
  }
}

function extractCollection(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) {
    throw new TaipeiSportsCenterSourceError('Source payload is not an object or array', 'INVALID_PAYLOAD');
  }
  const nested = payload.rows ?? payload.data ?? payload.items;
  if (!Array.isArray(nested)) {
    throw new TaipeiSportsCenterSourceError('Source payload does not contain a supported collection', 'INVALID_PAYLOAD');
  }
  return nested.filter(isRecord);
}

function parseFallbackAvailability(row: JsonRecord): SourceAvailabilitySlot['status'] {
  const value = row.CanBook ?? row.canBook;
  if (value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'Y') return 'AVAILABLE';
  if (value === false || value === 0 || value === '0' || String(value).toUpperCase() === 'N') return 'UNAVAILABLE';
  return 'UNKNOWN';
}

function parseTime(value: unknown): string | null {
  if (isRecord(value)) {
    const hour = Number(value.Hours ?? value.hours);
    const minute = Number(value.Minutes ?? value.minutes ?? 0);
    return formatTime(hour, minute);
  }
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return formatTime(Number(match[1]), Number(match[2]));
}

function formatTime(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parsePrice(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match?.[0];
}

function firstString(record: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value)) {
    throw new TaipeiSportsCenterSourceError(`${field} must use YYYY-MM-DD`, 'INVALID_DATE');
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
