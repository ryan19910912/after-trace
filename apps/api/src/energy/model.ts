export type EnergyBucket = 'FREE' | 'SUBSCRIPTION' | 'AD' | 'PAID';

export type EnergyLot = {
  id: number;
  bucket: EnergyBucket;
  availableUnits: bigint;
  reservedUnits: bigint;
  expiresAt: Date | null;
};

export type EnergyAllocation = {
  lotId: number;
  bucket: EnergyBucket;
  units: bigint;
};

export type EnergyAllocationResult = {
  allocations: EnergyAllocation[];
  covered: boolean;
  shortfallUnits: bigint;
};

const PERMANENT_BUCKET_PRIORITY: Record<'FREE' | 'PAID', number> = {
  FREE: 0,
  PAID: 1,
};

export function isUsableEnergyLot(lot: EnergyLot, at: Date): boolean {
  return lot.availableUnits > 0n && (lot.expiresAt === null || lot.expiresAt.getTime() > at.getTime());
}

export function orderEnergyLots(lots: readonly EnergyLot[], at: Date): EnergyLot[] {
  return lots
    .filter((lot) => isUsableEnergyLot(lot, at))
    .slice()
    .sort((left, right) => {
      const leftExpiring = left.expiresAt !== null;
      const rightExpiring = right.expiresAt !== null;
      if (leftExpiring && rightExpiring) {
        const expiry = left.expiresAt!.getTime() - right.expiresAt!.getTime();
        if (expiry !== 0) return expiry;
        return left.id - right.id;
      }
      if (leftExpiring) return -1;
      if (rightExpiring) return 1;

      const leftPriority = PERMANENT_BUCKET_PRIORITY[left.bucket as 'FREE' | 'PAID'];
      const rightPriority = PERMANENT_BUCKET_PRIORITY[right.bucket as 'FREE' | 'PAID'];
      return leftPriority - rightPriority || left.id - right.id;
    });
}

export function allocateUserEnergy(
  lots: readonly EnergyLot[],
  requiredUnits: bigint,
  at: Date,
): EnergyAllocationResult {
  if (requiredUnits < 0n) throw new Error('requiredUnits must be non-negative');
  let remaining = requiredUnits;
  const allocations: EnergyAllocation[] = [];

  for (const lot of orderEnergyLots(lots, at)) {
    if (remaining === 0n) break;
    const units = lot.availableUnits < remaining ? lot.availableUnits : remaining;
    if (units <= 0n) continue;
    allocations.push({ lotId: lot.id, bucket: lot.bucket, units });
    remaining -= units;
  }

  return { allocations, covered: remaining === 0n, shortfallUnits: remaining };
}

export function hasProactiveCapability(lots: readonly EnergyLot[], at: Date): boolean {
  return lots.some(
    (lot) =>
      isUsableEnergyLot(lot, at) &&
      (lot.bucket === 'SUBSCRIPTION' || lot.bucket === 'PAID'),
  );
}

export function adExpiry(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}
