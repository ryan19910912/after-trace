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
  useDate: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  price?: string;
  externalBookingRef?: string;
};

export type AvailabilitySourceAdapter = {
  readonly code: string;
  listVenues(): Promise<SourceVenue[]>;
  listSports(externalVenueId: string): Promise<SourceSport[]>;
  listCourts?(externalVenueId: string, sportCode: string): Promise<SourceCourt[]>;
  listAvailability(input: {
    externalVenueId: string;
    sportCode: string;
    externalCategoryId?: string;
    useDate: string;
  }): Promise<SourceAvailabilitySlot[]>;
};
