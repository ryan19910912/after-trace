import { describe, expect, it, vi } from 'vitest';
import { TaipeiSportsCenterAdapter } from './taipei-sports-center';

describe('TaipeiSportsCenterAdapter', () => {
  it('parses bookable calendar dates and sends form-encoded source parameters', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toContain('LID=DASC');
      expect(init?.body).toContain('categoryId=Badminton');
      return new Response(JSON.stringify([
        { title: '開放預約', start: '2026-09-01', allDay: true },
        { title: '開放預約', start: '2026-09-02T00:00:00' },
        { title: 'duplicate', start: '2026-09-02' },
      ]));
    });
    const adapter = new TaipeiSportsCenterAdapter(fetcher);

    const dates = await adapter.listBookableDates({
      externalVenueId: 'DASC',
      sportCode: 'badminton',
      externalCategoryId: 'Badminton',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    });

    expect(dates).toEqual(['2026-09-01', '2026-09-02']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('normalizes court, time, status, price and official booking reference', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      rows: [
        {
          LSID: 'DA4FBadmintonA',
          LSIDName: '4F羽球A',
          StartTime: { Hours: 18, Minutes: 0 },
          EndTime: { Hours: 19, Minutes: 0 },
          allowBooking: 'Y',
          TotalPrice: 300,
        },
        {
          LSID: 'DA4FBadmintonB',
          LSIDName: '4F羽球B',
          StartTime: '19:00:00',
          EndTime: '20:00:00',
          allowBooking: 'N',
          TotalPrice: 'NT$ 350',
        },
      ],
    })));
    const adapter = new TaipeiSportsCenterAdapter(fetcher);

    const slots = await adapter.listAvailability({
      externalVenueId: 'DASC',
      sportCode: 'badminton',
      externalCategoryId: 'Badminton',
      useDate: '2026-09-01',
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      externalCourtId: 'DA4FBadmintonA',
      courtName: '4F羽球A',
      startTime: '18:00',
      endTime: '19:00',
      status: 'AVAILABLE',
      price: '300',
    });
    expect(slots[1]?.status).toBe('UNAVAILABLE');
    expect(slots[1]?.price).toBe('350');
    expect(slots[0]?.externalSlotKey).toBe('DASC|Badminton|2026-09-01|DA4FBadmintonA|18:00|19:00');
    expect(slots[0]?.externalBookingRef).toContain('LID=DASC');
  });

  it('rejects a successful non-JSON response instead of treating it as empty availability', async () => {
    const adapter = new TaipeiSportsCenterAdapter(async () => new Response('<html>login</html>'));

    await expect(adapter.listAvailability({
      externalVenueId: 'DASC',
      sportCode: 'badminton',
      useDate: '2026-09-01',
    })).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });
});
