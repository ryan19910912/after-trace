import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Database } from '../db/client';
import { availabilitySlots, courts, sports, venueSports, venues } from '../db/schema';
import type { AvailabilitySearchQuery } from './query';

export class DrizzleAvailabilityRepository {
  constructor(private readonly database: Database) {}

  async listSports() {
    return this.database
      .select({ id: sports.id, code: sports.code, name: sports.name })
      .from(sports)
      .where(eq(sports.active, true))
      .orderBy(asc(sports.name));
  }

  async listVenues(sportCode?: string) {
    if (!sportCode) {
      return this.database
        .select({ id: venues.id, name: venues.name, city: venues.city, district: venues.district, bookingUrl: venues.bookingUrl })
        .from(venues)
        .where(eq(venues.active, true))
        .orderBy(asc(venues.district), asc(venues.name));
    }

    return this.database
      .selectDistinct({ id: venues.id, name: venues.name, city: venues.city, district: venues.district, bookingUrl: venues.bookingUrl })
      .from(venues)
      .innerJoin(venueSports, eq(venueSports.venueId, venues.id))
      .innerJoin(sports, eq(sports.id, venueSports.sportId))
      .where(and(eq(venues.active, true), eq(venueSports.active, true), eq(sports.active, true), eq(sports.code, sportCode)))
      .orderBy(asc(venues.district), asc(venues.name));
  }

  async search(input: AvailabilitySearchQuery) {
    return this.database
      .select({
        slotId: availabilitySlots.id,
        venueId: venues.id,
        venueName: venues.name,
        district: venues.district,
        sportCode: sports.code,
        sportName: sports.name,
        courtName: courts.name,
        useDate: availabilitySlots.useDate,
        startTime: availabilitySlots.startTime,
        endTime: availabilitySlots.endTime,
        status: availabilitySlots.status,
        price: availabilitySlots.price,
        bookingUrl: venues.bookingUrl,
        lastSeenAt: availabilitySlots.lastSeenAt,
      })
      .from(availabilitySlots)
      .innerJoin(venues, eq(venues.id, availabilitySlots.venueId))
      .innerJoin(sports, eq(sports.id, availabilitySlots.sportId))
      .leftJoin(courts, eq(courts.id, availabilitySlots.courtId))
      .where(
        and(
          eq(availabilitySlots.status, 'AVAILABLE'),
          eq(venues.active, true),
          eq(sports.active, true),
          input.sport ? eq(sports.code, input.sport) : undefined,
          input.venueId ? eq(venues.id, input.venueId) : undefined,
          input.district ? eq(venues.district, input.district) : undefined,
          input.date ? eq(availabilitySlots.useDate, input.date) : undefined,
          input.start ? gte(availabilitySlots.startTime, input.start) : undefined,
          input.end ? lte(availabilitySlots.endTime, input.end) : undefined,
        ),
      )
      .orderBy(asc(availabilitySlots.useDate), asc(availabilitySlots.startTime), asc(venues.name))
      .limit(input.limit);
  }
}
