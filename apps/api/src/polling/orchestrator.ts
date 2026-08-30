import type { SourceSynchronizationService } from '../sources/sync-service';
import type { AvailabilitySyncRepository, PollTargetClaim } from '../sources/sync-repository';

const DEFAULT_SOURCE_CODE = 'taipei-sports-center';
const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_HORIZON_DAYS = 14;

export type PollingRunResult = {
  bootstrappedMetadata: boolean;
  claimed: number;
  succeeded: number;
  failed: number;
};

type PollingRepository = Pick<AvailabilitySyncRepository, 'hasEnabledPollTargets' | 'claimDuePollTargets'>;
type PollingSynchronizer = Pick<SourceSynchronizationService, 'syncMetadata' | 'syncPollTarget'>;

export class PollingOrchestrator {
  constructor(
    private readonly repository: PollingRepository,
    private readonly synchronizer: PollingSynchronizer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(input: {
    sourceCode?: string;
    batchSize?: number;
    leaseSeconds?: number;
    horizonDays?: number;
  } = {}): Promise<PollingRunResult> {
    const sourceCode = input.sourceCode ?? DEFAULT_SOURCE_CODE;
    let bootstrappedMetadata = false;

    if (!(await this.repository.hasEnabledPollTargets())) {
      await this.synchronizer.syncMetadata(sourceCode);
      bootstrappedMetadata = true;
    }

    const claimedAt = this.now();
    const claims = await this.repository.claimDuePollTargets({
      claimedAt,
      leaseSeconds: clampInteger(input.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 60, 900),
      limit: clampInteger(input.batchSize ?? DEFAULT_BATCH_SIZE, 1, 6),
    });
    if (claims.length === 0) {
      return { bootstrappedMetadata, claimed: 0, succeeded: 0, failed: 0 };
    }

    const startDate = taipeiDate(claimedAt);
    const horizonDays = clampInteger(input.horizonDays ?? DEFAULT_HORIZON_DAYS, 1, 31);
    const endDate = addIsoDays(startDate, horizonDays - 1);
    const settled = await Promise.allSettled(
      claims.map((claim) => this.syncClaim(claim, startDate, endDate)),
    );
    const succeeded = settled.filter((result) => result.status === 'fulfilled').length;

    return {
      bootstrappedMetadata,
      claimed: claims.length,
      succeeded,
      failed: claims.length - succeeded,
    };
  }

  private async syncClaim(claim: PollTargetClaim, startDate: string, endDate: string): Promise<void> {
    await this.synchronizer.syncPollTarget({
      pollTargetId: claim.pollTargetId,
      claimedAt: claim.claimedAt,
      startDate,
      endDate,
    });
  }
}

export function taipeiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to resolve Asia/Taipei date');
  return `${year}-${month}-${day}`;
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
