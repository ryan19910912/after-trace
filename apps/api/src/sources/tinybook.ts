import {
  AvailabilitySourceError,
  type AvailabilitySourceAdapter,
  type SourceAvailabilitySlot,
  type SourceBookableDateQuery,
  type SourceCourt,
  type SourceSport,
  type SourceVenue,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_BLOCK = /^\d{3,4}$/;
const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const BOOTSTRAP_CACHE_MILLISECONDS = 5 * 60 * 1000;

export const PICKLE_DAY_A11_PRODUCT_URL =
  'https://tinybot.cc/pickledaysocial/product/%E6%96%B0%E5%85%89a11%E5%B0%88%E5%8D%80-%E5%8C%B9%E5%85%8B%E7%90%83%E5%A0%B4%E7%A7%9F%E5%80%9F/';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type TinyBookVenueConfig = {
  externalVenueId: string;
  name: string;
  city: string;
  district: string;
  address: string;
  bookingUrl: string;
  sport: SourceSport;
  bookingHorizonHours: number;
  slotMinutes: number;
  pricePerSlot?: string;
  requireResources: boolean;
};

type BookingResource = {
  id: string;
  name: string;
};

type BookingBootstrap = {
  ajaxUrl: string;
  formFields: URLSearchParams;
  resources: BookingResource[];
};

type CachedBootstrap = {
  loadedAt: number;
  value: BookingBootstrap;
};

const TINYBOOK_VENUES: readonly TinyBookVenueConfig[] = [
  {
    externalVenueId: 'pickleday-a11',
    name: 'Pickle Day 新光 A11 4F',
    city: '臺北市',
    district: '信義區',
    address: '臺北市信義區松壽路11號4樓',
    bookingUrl: PICKLE_DAY_A11_PRODUCT_URL,
    sport: {
      externalCategoryId: 'pickle-day-a11-court-rental',
      code: 'pickleball',
      name: '匹克球',
    },
    bookingHorizonHours: 72,
    slotMinutes: 30,
    pricePerSlot: '699',
    requireResources: true,
  },
] as const;

export class TinyBookSourceError extends AvailabilitySourceError {
  constructor(message: string, code: string, status?: number) {
    super(message, code, status);
    this.name = 'TinyBookSourceError';
  }
}

/**
 * TinyBook currently renders its public court-rental products with the standard
 * WooCommerce Bookings front-end contract. The adapter only reads the same
 * anonymous product page + admin-ajax availability call used by the consumer
 * booking UI; it never logs in, adds to cart, books or pays.
 *
 * Venue/product entries are deliberately curated. TinyBook is a multi-tenant
 * platform, so discovering an arbitrary tenant is not permission to ingest it.
 * Add a venue only after its official public booking product and sport/location
 * have been verified.
 */
export class TinyBookAdapter implements AvailabilitySourceAdapter {
  readonly code = 'tinybook';
  readonly name = 'TinyBook 公開場地預約';
  readonly baseUrl = 'https://tinybot.cc';
  readonly minPollIntervalSeconds = 300;
  readonly ingestSportCodes = ['pickleball'] as const;

  private readonly bootstrapCache = new Map<string, CachedBootstrap>();

  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listVenues(): Promise<SourceVenue[]> {
    return TINYBOOK_VENUES.map((venue) => ({
      externalVenueId: venue.externalVenueId,
      name: venue.name,
      city: venue.city,
      district: venue.district,
      address: venue.address,
      bookingUrl: venue.bookingUrl,
    }));
  }

  async listSports(externalVenueId: string): Promise<SourceSport[]> {
    const venue = this.requireVenue(externalVenueId);
    return [{ ...venue.sport }];
  }

  async listBookableDates(input: SourceBookableDateQuery): Promise<string[]> {
    assertIsoDate(input.startDate, 'startDate');
    assertIsoDate(input.endDate, 'endDate');
    const venue = this.requireVenue(input.externalVenueId);
    this.assertSport(venue, input.sportCode);

    const requestedDates = datesInclusive(input.startDate, input.endDate);
    const now = this.now();
    const today = taipeiDate(now);
    const horizonDate = taipeiDate(new Date(now.getTime() + venue.bookingHorizonHours * 3_600_000));
    return requestedDates.filter((date) => date >= today && date <= horizonDate);
  }

  async listCourts(externalVenueId: string, sportCode: string): Promise<SourceCourt[]> {
    const venue = this.requireVenue(externalVenueId);
    this.assertSport(venue, sportCode);
    const bootstrap = await this.loadBootstrap(venue);
    return bootstrap.resources.map((resource) => ({
      externalCourtId: resource.id,
      name: resource.name,
    }));
  }

  async listAvailability(input: {
    externalVenueId: string;
    sportCode: string;
    externalCategoryId?: string;
    useDate: string;
  }): Promise<SourceAvailabilitySlot[]> {
    assertIsoDate(input.useDate, 'useDate');
    const venue = this.requireVenue(input.externalVenueId);
    this.assertSport(venue, input.sportCode);

    const bootstrap = await this.loadBootstrap(venue);
    const resources = bootstrap.resources.length > 0
      ? bootstrap.resources
      : [{ id: '0', name: venue.name }];

    if (venue.requireResources && bootstrap.resources.length === 0) {
      throw new TinyBookSourceError(
        `TinyBook booking product for ${venue.externalVenueId} no longer exposes bookable resources`,
        'MISSING_BOOKING_RESOURCES',
      );
    }

    const slots: SourceAvailabilitySlot[] = [];
    for (const resource of resources) {
      const html = await this.fetchTimeBlocks(venue, bootstrap, input.useDate, resource.id);
      const starts = parseAvailableTimeBlocks(html);
      for (const startTime of starts) {
        const endTime = addMinutes(startTime, venue.slotMinutes);
        if (!endTime) continue;
        slots.push({
          externalSlotKey: [venue.externalVenueId, resource.id, input.useDate, startTime, endTime].join('|'),
          externalVenueId: venue.externalVenueId,
          sportCode: venue.sport.code,
          externalCourtId: resource.id,
          courtName: resource.name,
          useDate: input.useDate,
          startTime,
          endTime,
          status: 'AVAILABLE',
          ...(venue.pricePerSlot ? { price: venue.pricePerSlot } : {}),
          externalBookingRef: `${venue.bookingUrl}#${encodeURIComponent(resource.id)}-${input.useDate}-${startTime}`,
        });
      }
    }

    return dedupeSlots(slots);
  }

  private requireVenue(externalVenueId: string): TinyBookVenueConfig {
    const venue = TINYBOOK_VENUES.find((candidate) => candidate.externalVenueId === externalVenueId);
    if (!venue) {
      throw new TinyBookSourceError(`Unknown TinyBook venue: ${externalVenueId}`, 'UNKNOWN_VENUE');
    }
    return venue;
  }

  private assertSport(venue: TinyBookVenueConfig, sportCode: string): void {
    if (sportCode !== venue.sport.code) {
      throw new TinyBookSourceError(
        `TinyBook venue ${venue.externalVenueId} does not expose sport ${sportCode}`,
        'UNSUPPORTED_SPORT',
      );
    }
  }

  private async loadBootstrap(venue: TinyBookVenueConfig): Promise<BookingBootstrap> {
    const cached = this.bootstrapCache.get(venue.externalVenueId);
    const now = this.now().getTime();
    if (cached && now - cached.loadedAt < BOOTSTRAP_CACHE_MILLISECONDS) return cached.value;

    const html = await this.requestText(venue.bookingUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const bootstrap = parseBookingBootstrap(html, venue.bookingUrl);
    if (venue.requireResources && bootstrap.resources.length === 0) {
      throw new TinyBookSourceError(
        `TinyBook booking product for ${venue.externalVenueId} returned no resource options`,
        'MISSING_BOOKING_RESOURCES',
      );
    }

    this.bootstrapCache.set(venue.externalVenueId, { loadedAt: now, value: bootstrap });
    return bootstrap;
  }

  private async fetchTimeBlocks(
    venue: TinyBookVenueConfig,
    bootstrap: BookingBootstrap,
    useDate: string,
    resourceId: string,
  ): Promise<string> {
    const [year, month, day] = useDate.split('-');
    const form = new URLSearchParams(bootstrap.formFields);
    form.set('wc_bookings_field_start_date_year', year);
    form.set('wc_bookings_field_start_date_month', month);
    form.set('wc_bookings_field_start_date_day', day);
    form.set('wc_bookings_field_resource', resourceId);

    // A11 is a customer-defined duration product whose minimum purchasable unit
    // is 30 minutes. Asking for one unit gives the product's actual start-slot
    // availability; longer bookings are still completed on the official page.
    form.set('wc_bookings_field_duration', '1');
    form.delete('wc_bookings_field_start_date_time');

    const body = new URLSearchParams({
      action: 'wc_bookings_get_blocks',
      form: form.toString(),
    });
    const html = await this.requestText(bootstrap.ajaxUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/html, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: venue.bookingUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });

    if (/^-?\d+$/.test(html.trim())) {
      throw new TinyBookSourceError('TinyBook booking endpoint returned a WordPress AJAX error code', 'INVALID_BLOCK_PAYLOAD');
    }
    return html;
  }

  private async requestText(url: string, init: RequestInit): Promise<string> {
    const delays = [500];
    let lastError: TinyBookSourceError | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, { ...init, redirect: 'follow' });
      } catch (cause) {
        lastError = new TinyBookSourceError(
          cause instanceof Error ? cause.message : 'TinyBook network request failed',
          'NETWORK_ERROR',
        );
        if (attempt === delays.length) throw lastError;
        await sleep(delays[attempt]);
        continue;
      }

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        lastError = new TinyBookSourceError(
          `TinyBook returned HTTP ${response.status}`,
          retryable ? 'SOURCE_RETRYABLE_HTTP' : 'SOURCE_HTTP_ERROR',
          response.status,
        );
        if (!retryable || attempt === delays.length) throw lastError;
        await sleep(delays[attempt]);
        continue;
      }

      return response.text();
    }

    throw lastError ?? new TinyBookSourceError('TinyBook request failed', 'SOURCE_REQUEST_FAILED');
  }
}

function parseBookingBootstrap(html: string, productUrl: string): BookingBootstrap {
  const formHtml = findBookingForm(html);
  const formFields = serializeDefaultFormFields(formHtml);
  const productId = firstNonBlank(
    formFields.get('add-to-cart'),
    findNamedControlValue(formHtml, 'add-to-cart'),
    findAttributeValue(formHtml, 'data-product_id'),
  );
  if (!productId || !/^\d+$/.test(productId)) {
    throw new TinyBookSourceError('TinyBook booking product id could not be read from the public form', 'INVALID_BOOKING_FORM');
  }
  formFields.set('add-to-cart', productId);

  const ajaxUrl = findBookingAjaxUrl(html, productUrl);
  const resources = parseSelectOptions(formHtml, 'wc_bookings_field_resource')
    .filter((resource) => resource.id !== '0' && resource.id !== '');

  return { ajaxUrl, formFields, resources };
}

function findBookingForm(html: string): string {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const bookingForm = forms.find((form) => form.includes('wc-bookings-booking-form'));
  if (!bookingForm) {
    throw new TinyBookSourceError('TinyBook public product no longer exposes a WooCommerce booking form', 'INVALID_BOOKING_FORM');
  }
  return bookingForm;
}

function serializeDefaultFormFields(formHtml: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const tag of formHtml.match(/<input\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const name = attributes.get('name');
    if (!name || attributes.has('disabled')) continue;
    const type = (attributes.get('type') ?? 'text').toLowerCase();
    if (['submit', 'button', 'file', 'image', 'reset'].includes(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !attributes.has('checked')) continue;
    params.append(name, decodeHtml(attributes.get('value') ?? ''));
  }

  for (const select of formHtml.match(/<select\b[\s\S]*?<\/select>/gi) ?? []) {
    const openTag = select.match(/^<select\b[^>]*>/i)?.[0];
    if (!openTag) continue;
    const attributes = parseAttributes(openTag);
    const name = attributes.get('name');
    if (!name || attributes.has('disabled')) continue;
    const options = parseOptions(select);
    const selected = options.find((option) => option.selected) ?? options[0];
    if (selected) params.append(name, selected.id);
  }
  return params;
}

function parseSelectOptions(formHtml: string, selectName: string): BookingResource[] {
  for (const select of formHtml.match(/<select\b[\s\S]*?<\/select>/gi) ?? []) {
    const openTag = select.match(/^<select\b[^>]*>/i)?.[0];
    if (!openTag) continue;
    if (parseAttributes(openTag).get('name') !== selectName) continue;
    return parseOptions(select).map(({ id, name }) => ({ id, name }));
  }
  return [];
}

function parseOptions(selectHtml: string): Array<BookingResource & { selected: boolean }> {
  const options: Array<BookingResource & { selected: boolean }> = [];
  const pattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selectHtml)) !== null) {
    const attributes = parseAttributes(`<option ${match[1]}>`);
    options.push({
      id: decodeHtml(attributes.get('value') ?? '').trim(),
      name: stripHtml(match[2]).trim(),
      selected: attributes.has('selected'),
    });
  }
  return options;
}

function findBookingAjaxUrl(html: string, productUrl: string): string {
  const marker = html.indexOf('booking_form_params');
  const scope = marker >= 0 ? html.slice(marker, marker + 8_000) : html;
  const match = scope.match(/["']ajax_url["']\s*:\s*"((?:\\.|[^"])*)"/i);
  if (match) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as string;
      return new URL(decoded, productUrl).toString();
    } catch {
      // Fall through to the standard WordPress sub-site path.
    }
  }

  const product = new URL(productUrl);
  const firstSegment = product.pathname.split('/').filter(Boolean)[0];
  const basePath = firstSegment ? `/${firstSegment}/` : '/';
  return new URL(`${basePath}wp-admin/admin-ajax.php`, product.origin).toString();
}

function findNamedControlValue(formHtml: string, controlName: string): string | null {
  const tags = formHtml.match(/<(?:input|button)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = parseAttributes(tag);
    if (attributes.get('name') !== controlName) continue;
    const value = attributes.get('value');
    if (value?.trim()) return decodeHtml(value).trim();
  }
  return null;
}

function findAttributeValue(html: string, attributeName: string): string | null {
  const tags = html.match(/<[^>]+>/g) ?? [];
  for (const tag of tags) {
    const value = parseAttributes(tag).get(attributeName);
    if (value?.trim()) return decodeHtml(value).trim();
  }
  return null;
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const content = tag.replace(/^<\/?[^\s>]+\s*/i, '').replace(/\/?\s*>$/, '');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseAvailableTimeBlocks(html: string): string[] {
  const times = new Set<string>();
  const tags = html.match(/<li\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = parseAttributes(tag);
    const classes = (attributes.get('class') ?? '').split(/\s+/);
    if (!classes.includes('block')) continue;
    const raw = attributes.get('data-block')?.trim();
    if (!raw || !TIME_BLOCK.test(raw)) continue;
    const padded = raw.padStart(4, '0');
    const hour = Number(padded.slice(0, 2));
    const minute = Number(padded.slice(2, 4));
    const formatted = formatTime(hour, minute);
    if (formatted) times.add(formatted);
  }

  // Some WooCommerce Bookings themes customize the <li> attributes but keep
  // the standard anchor data-value. Accept ISO-like values as a safe fallback.
  if (times.size === 0) {
    const pattern = /data-value=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const raw = decodeHtml(match[1]);
      const time = raw.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
      if (!time) continue;
      const formatted = formatTime(Number(time[1]), Number(time[2]));
      if (formatted) times.add(formatted);
    }
  }

  return [...times].sort();
}

function addMinutes(value: string, minutes: number): string | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match || !Number.isInteger(minutes) || minutes <= 0) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  if (total >= 24 * 60) return null;
  return formatTime(Math.floor(total / 60), total % 60);
}

function formatTime(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function taipeiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function datesInclusive(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (end < start) throw new TinyBookSourceError('endDate must not be before startDate', 'INVALID_DATE_RANGE');
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > 31) throw new TinyBookSourceError('TinyBook sync window must not exceed 31 days', 'INVALID_DATE_RANGE');
  return Array.from({ length: days }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

function dedupeSlots(slots: SourceAvailabilitySlot[]): SourceAvailabilitySlot[] {
  return [...new Map(slots.map((slot) => [slot.externalSlotKey, slot])).values()];
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function firstNonBlank(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return null;
}

function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value)) {
    throw new TinyBookSourceError(`${field} must use YYYY-MM-DD`, 'INVALID_DATE');
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
