export class AvailabilitySourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AvailabilitySourceError';
  }
}

export type SourceVenue = {
  externalVenueId: string;
  name: string;
  city: string;
  district?: string;
  address?: string;
  bookingUrl?: string;
};

export type SourceSport = {
  externalCategoryId?: string;
  code: string;
  name: string;
};

export type SourceCourt = {
  externalCourtId: string;
  name: string;
};

export type SourceAvailabilitySlot = {
  externalSlotKey: string;
  externalVenueId: string;
  sportCode: string;
  externalCourtId?: string;
  courtName?: string;
  useDate: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  price?: string;
  externalBookingRef?: string;
};

export type SourceBookableDateQuery = {
  externalVenueId: string;
  sportCode: string;
  externalCategoryId?: string;
  startDate: string;
  endDate: string;
};

export type AvailabilitySourceAdapter = {
  readonly code: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly minPollIntervalSeconds: number;
  /**
   * Optional product-ingestion override for a source whose discoverable sport
   * catalog is broader than the subset AFTERTRACE can safely normalize today.
   * When omitted, the generic slot-sport allowlist is used.
   */
  readonly ingestSportCodes?: readonly string[];
  listVenues(): Promise<SourceVenue[]>;
  listSports(externalVenueId: string): Promise<SourceSport[]>;
  listBookableDates?(input: SourceBookableDateQuery): Promise<string[]>;
  listCourts?(externalVenueId: string, sportCode: string): Promise<SourceCourt[]>;
  listAvailability(input: {
    externalVenueId: string;
    sportCode: string;
    externalCategoryId?: string;
    useDate: string;
  }): Promise<SourceAvailabilitySlot[]>;
};
