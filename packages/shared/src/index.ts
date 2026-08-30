export const availabilityStatusValues = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type AvailabilityStatus = (typeof availabilityStatusValues)[number];

export const bookingChannelValues = ['WEB', 'APP', 'PHONE', 'ONSITE'] as const;
export type BookingChannel = (typeof bookingChannelValues)[number];

export const notificationChannelValues = ['WEB_PUSH', 'EMAIL'] as const;
export type NotificationChannel = (typeof notificationChannelValues)[number];

export type AvailabilitySearchItem = {
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
  status: AvailabilityStatus;
  price: string | null;
  bookingUrl: string | null;
  externalBookingRef: string | null;
  lastSeenAt: string;
};
