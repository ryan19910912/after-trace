export type WorklogSourceScopeType = 'PRIVATE' | 'GROUP';

export type SourceAiFundingSnapshot = {
  responsibleUserId: number | null;
  responsibleDisplayName: string | null;
};

export type SourceAiPointBalance = {
  availablePoints: number;
  reservedPoints: number;
};

export type SourceAiUsageAggregate = {
  customerPointsCharged: number;
  platformSubsidizedPoints: number;
};

export type SourceUsageSummary = {
  sourceId: number;
  scopeType: WorklogSourceScopeType;
  aiResponsibleUserId: number | null;
  aiResponsibleDisplayName: string | null;
  aiAvailablePoints: number;
  aiReservedPoints: number;
  aiUsedPoints: number;
  platformSubsidizedPoints: number;
  canManageFunding: boolean;
};

export interface WorklogUsageRepository {
  getGroupAiFunding(sourceId: number): Promise<SourceAiFundingSnapshot>;
  getSourcePointBalance(input: {
    ownerUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<SourceAiPointBalance>;
  sumSourceAiUsage(sourceId: number): Promise<SourceAiUsageAggregate>;
}

/**
 * Customer-facing usage is Source-scoped and grant-backed.
 *
 * It deliberately does not read subscription-period aggregate quota. PRIVATE uses the
 * current user as the funding owner. GROUP exposes only the current responsible user's
 * balance that is explicitly scoped to this Source; unrelated balances stay private.
 */
export class WorklogUsageService {
  constructor(private readonly repository: WorklogUsageRepository) {}

  async sourceUsage(input: {
    viewerUserId: number;
    sourceId: number;
    scopeType: WorklogSourceScopeType;
    at?: Date;
  }): Promise<SourceUsageSummary> {
    const viewerUserId = positiveInteger(input.viewerUserId, 'viewerUserId');
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const at = validDate(input.at ?? new Date(), 'at');

    const funding = input.scopeType === 'PRIVATE'
      ? { responsibleUserId: viewerUserId, responsibleDisplayName: null }
      : await this.repository.getGroupAiFunding(sourceId);

    const [balance, usage] = await Promise.all([
      funding.responsibleUserId === null
        ? Promise.resolve({ availablePoints: 0, reservedPoints: 0 })
        : this.repository.getSourcePointBalance({
            ownerUserId: funding.responsibleUserId,
            sourceId,
            at,
          }),
      this.repository.sumSourceAiUsage(sourceId),
    ]);

    return {
      sourceId,
      scopeType: input.scopeType,
      aiResponsibleUserId: funding.responsibleUserId,
      aiResponsibleDisplayName: funding.responsibleDisplayName,
      aiAvailablePoints: nonNegativeInteger(balance.availablePoints),
      aiReservedPoints: nonNegativeInteger(balance.reservedPoints),
      aiUsedPoints: nonNegativeInteger(usage.customerPointsCharged),
      platformSubsidizedPoints: nonNegativeInteger(usage.platformSubsidizedPoints),
      canManageFunding: funding.responsibleUserId === viewerUserId,
    };
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}
