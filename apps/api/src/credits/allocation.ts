export const COST_UNITS_PER_TWD = 100_000_000n;

export type CreditBucket = 'WELCOME' | 'AD' | 'PAID';
export const creditConsumptionOrder: readonly CreditBucket[] = ['WELCOME', 'AD', 'PAID'];

export type CreditBalance = {
  availableUnits: bigint;
  reservedUnits: bigint;
};

export type CreditBalances = Record<CreditBucket, CreditBalance>;

export type CreditAllocation = {
  bucket: CreditBucket;
  units: bigint;
};

export type CreditAllocationResult = {
  allocations: CreditAllocation[];
  covered: boolean;
  shortfallUnits: bigint;
};

export function parseTwdCostUnits(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) {
    throw new Error('TWD cost must be a non-negative decimal with at most 8 decimal places');
  }

  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * COST_UNITS_PER_TWD + BigInt(fraction.padEnd(8, '0'));
}

export function formatTwdCostUnits(units: bigint): string {
  if (units < 0n) throw new Error('TWD cost units must be non-negative');
  const whole = units / COST_UNITS_PER_TWD;
  const fraction = (units % COST_UNITS_PER_TWD).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

export function numberToTwdCostUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('TWD cost number must be finite and non-negative');
  }
  return parseTwdCostUnits(value.toFixed(8));
}

export function allocateConsumption(
  balances: CreditBalances,
  requiredUnits: bigint,
): CreditAllocationResult {
  if (requiredUnits < 0n) throw new Error('requiredUnits must be non-negative');

  let remaining = requiredUnits;
  const allocations: CreditAllocation[] = [];

  for (const bucket of creditConsumptionOrder) {
    if (remaining === 0n) break;
    const available = balances[bucket].availableUnits;
    if (available <= 0n) continue;

    const units = available < remaining ? available : remaining;
    allocations.push({ bucket, units });
    remaining -= units;
  }

  return {
    allocations,
    covered: remaining === 0n,
    shortfallUnits: remaining,
  };
}

export function allocatePaidReservation(
  paidBalance: CreditBalance,
  requiredUnits: bigint,
): CreditAllocationResult {
  if (requiredUnits < 0n) throw new Error('requiredUnits must be non-negative');
  const units = paidBalance.availableUnits < requiredUnits
    ? paidBalance.availableUnits
    : requiredUnits;
  const remaining = requiredUnits - units;

  return {
    allocations: units > 0n ? [{ bucket: 'PAID', units }] : [],
    covered: remaining === 0n,
    shortfallUnits: remaining,
  };
}
