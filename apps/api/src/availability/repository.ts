import { and, asc, eq, gt, gte, lte, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { availabilitySlots, courts, sources, sports, venueSports, venues } from '../db/schema';
import { taipeiDate, taipeiTime } from '../time/taipei';
import type { AvailabilitySearchQuery } from './query';

export class DrizzleAvailabilityRepository {
  constructor(private readonly database: Database) {}

  async listSports() {
    return this.database
      .selectDistinct({ id: sports.id, code: sports.code, name: sports.name })
      .from(sports)
      .innerJoin(venueSports, eq(venueSports.sportId, sports.id))
      .innerJoin(venues, eq(venues.id, venueSports.venueId))
      .innerJoin(sources, eq(sources.id, venues.sourceId))
      .where(and(
        eq(sports.active, true),
        eq(venueSports.active, true),
        eq(venues.active, true),
        eq(sources.active, true),
      ))
      .orderBy(asc(sports.name));
  }

  async listVenues(sportCode?: string) {
    if (!sportCode) {
      return this.database
        .select({ id: venues.id, name: venues.name, city: venues.city, district: venues.district, bookingUrl: venues.bookingUrl })
        .from(venues)
        .innerJoin(sources, eq(sources.id, venues.sourceId))
        .where(and(eq(venues.active, true), eq(sources.active, true)))
        .orderBy(asc(venues.district), asc(venues.name));
    }

    return this.database
      .selectDistinct({ id: venues.id, name: venues.name, city: venues.city, district: venues.district, bookingUrl: venues.bookingUrl })
      .from(venues)
      .innerJoin(sources, eq(sources.id, venues.sourceId))
      .innerJoin(venueSports, eq(venueSports.venueId, venues.id))
      .innerJoin(sports, eq(sports.id, venueSports.sportId))
      .where(and(
        eq(sources.active, true),
        eq(venues.active, true),
        eq(venueSports.active, true),
        eq(sports.active, true),
        eq(sports.code, sportCode),
      ))
      .orderBy(asc(venues.district), asc(venues.name));
  }

  async search(input: AvailabilitySearchQuery, now = new Date()) {
    const today = taipeiDate(now);
    const currentTime = taipeiTime(now);
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
      .innerJoin(sources, eq(sources.id, availabilitySlots.sourceId))
      .innerJoin(venues, eq(venues.id, availabilitySlots.venueId))
      .innerJoin(sports, eq(sports.id, availabilitySlots.sportId))
      .innerJoin(
        venueSports,
        and(
          eq(venueSports.venueId, availabilitySlots.venueId),
          eq(venueSports.sportId, availabilitySlots.sportId),
        ),
      )
      .leftJoin(courts, eq(courts.id, availabilitySlots.courtId))
      .where(
        and(
          eq(availabilitySlots.status, 'AVAILABLE'),
          // Availability is a current-state surface. Historical rows may remain
          // for state/audit continuity after the moving polling horizon advances.
          // On today's Taipei date, a slot is no longer actionable once its
          // start time has arrived, even if an upstream row still says AVAILABLE.
          or(
            gt(availabilitySlots.useDate, today),
            and(eq(availabilitySlots.useDate, today), gt(availabilitySlots.startTime, currentTime)),
          ),
          eq(sources.active, true),
          eq(venues.active, true),
          eq(sports.active, true),
          eq(venueSports.active, true),
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
