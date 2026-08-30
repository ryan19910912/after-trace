import { describe, expect, it } from 'vitest';
import { SourceAdapterRegistry } from './registry';
import { SourceSynchronizationService } from './sync-service';
import type {
  AvailabilitySyncRepository,
  PersistableAvailabilitySlot,
  PollTargetClaim,
  PollTargetContext,
} from './sync-repository';
import type { AvailabilitySourceAdapter, SourceAvailabilitySlot, SourceSport, SourceVenue } from './types';

class FakeRepository implements AvailabilitySyncRepository {
  readonly calls: string[] = [];
  readonly slots: SourceAvailabilitySlot[] = [];
  successAt: Date | null = null;
  failureCode: string | null = null;
  context: PollTargetContext | null = {
    pollTargetId: 99,
    sourceId: 1,
    sourceCode: 'fake',
    sourceMinPollIntervalSeconds: 60,
    venueId: 2,
    externalVenueId: 'V1',
    sportId: 3,
    sportCode: 'badminton',
    externalCategoryId: 'Badminton',
    intervalSeconds: 300,
  };

  async upsertSource(): Promise<number> { this.calls.push('source'); return 1; }
  async upsertSport(input: SourceSport): Promise<number> { this.calls.push(`sport:${input.code}`); return input.code === 'badminton' ? 3 : 4; }
  async upsertVenue(_sourceId: number, input: SourceVenue): Promise<number> { this.calls.push(`venue:${input.externalVenueId}`); return 2; }
  async deactivateMissingVenues(): Promise<void> { this.calls.push('deactivate-venues'); }
  async upsertVenueSport(_venueId: number, _sportId: number, externalCategoryId?: string): Promise<void> { this.calls.push(`venue-sport:${externalCategoryId}`); }
  async deactivateMissingVenueSports(): Promise<void> { this.calls.push('deactivate-venue-sports'); }
  async ensurePollTarget(): Promise<void> { this.calls.push('poll-target'); }
  async hasEnabledPollTargets(): Promise<boolean> { return true; }
  async claimDuePollTargets(): Promise<PollTargetClaim[]> { return []; }
  async getPollTargetContext(): Promise<PollTargetContext | null> { return this.context; }
  async upsertAvailabilitySlot(input: { slot: PersistableAvailabilitySlot }): Promise<void> {
    this.slots.push({ ...input.slot, externalVenueId: 'V1', sportCode: 'badminton' });
  }
  async markMissingSlotsUnknown(input: { seenExternalSlotKeys: string[] }): Promise<number> { return input.seenExternalSlotKeys.length === 0 ? 2 : 0; }
  async markPollTargetSuccess(input: { polledAt: Date }): Promise<boolean> { this.successAt = input.polledAt; return true; }
  async markPollTargetFailure(input: { errorCode: string }): Promise<boolean> { this.failureCode = input.errorCode; return true; }
}

function fakeAdapter(overrides: Partial<AvailabilitySourceAdapter> = {}): AvailabilitySourceAdapter {
  return {
    code: 'fake',
    name: 'Fake source',
    baseUrl: 'https://example.test',
    minPollIntervalSeconds: 60,
    async listVenues() {
      return [{ externalVenueId: 'V1', name: 'Venue 1', city: '臺北市', district: '大安區' }];
    },
    async listSports() {
      return [{ code: 'badminton', name: '羽球', externalCategoryId: 'Badminton' }];
    },
    async listBookableDates() {
      return ['2026-09-02'];
    },
    async listAvailability(input) {
      return [{
        externalSlotKey: `${input.externalVenueId}|${input.useDate}|A|18:00`,
        externalVenueId: input.externalVenueId,
        sportCode: input.sportCode,
        externalCourtId: 'A',
        courtName: 'Court A',
        useDate: input.useDate,
        startTime: '18:00',
        endTime: '19:00',
        status: 'AVAILABLE',
      }];
    },
    ...overrides,
  };
}

describe('SourceSynchronizationService', () => {
  it('syncs source metadata and creates poll targets from normalized venue sports', async () => {
    const repository = new FakeRepository();
    const service = new SourceSynchronizationService(repository, new SourceAdapterRegistry([fakeAdapter()]));

    const result = await service.syncMetadata('fake');

    expect(result).toEqual({ sourceCode: 'fake', venues: 1, venueSports: 1, pollTargets: 1 });
    expect(repository.calls).toContain('venue:V1');
    expect(repository.calls).toContain('sport:badminton');
    expect(repository.calls).toContain('poll-target');
  });

  it('keeps launch metadata badminton-first even when a source exposes additional categories', async () => {
    const repository = new FakeRepository();
    const adapter = fakeAdapter({
      async listSports() {
        return [
          { code: 'badminton', name: '羽球', externalCategoryId: 'Badminton' },
          { code: 'basketball', name: '籃球', externalCategoryId: 'Basketball' },
        ];
      },
    });
    const service = new SourceSynchronizationService(repository, new SourceAdapterRegistry([adapter]));

    const result = await service.syncMetadata('fake');

    expect(result.venueSports).toBe(1);
    expect(repository.calls).toContain('sport:badminton');
    expect(repository.calls).not.toContain('sport:basketball');
  });

  it('polls only bookable dates, clears stale dates and marks target healthy', async () => {
    const repository = new FakeRepository();
    const now = new Date('2026-08-31T20:00:00.000Z');
    const service = new SourceSynchronizationService(repository, new SourceAdapterRegistry([fakeAdapter()]), () => now);

    const result = await service.syncPollTarget({
      pollTargetId: 99,
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    });

    expect(result).toEqual({
      pollTargetId: 99,
      datesChecked: 3,
      bookableDates: 1,
      slotsSeen: 1,
      staleSlotsCleared: 4,
    });
    expect(repository.slots).toHaveLength(1);
    expect(repository.slots[0]?.useDate).toBe('2026-09-02');
    expect(repository.successAt).toEqual(now);
  });

  it('records poll failure health and preserves the source error for retry policy', async () => {
    const repository = new FakeRepository();
    const adapter = fakeAdapter({
      async listBookableDates() {
        throw new Error('upstream unavailable');
      },
    });
    const service = new SourceSynchronizationService(repository, new SourceAdapterRegistry([adapter]));

    await expect(service.syncPollTarget({
      pollTargetId: 99,
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    })).rejects.toThrow('upstream unavailable');
    expect(repository.failureCode).toBe('SOURCE_SYNC_FAILED');
  });
});
