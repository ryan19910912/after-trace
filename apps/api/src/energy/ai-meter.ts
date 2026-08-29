export type AiEnergyMeterEnv = {
  ENERGY_UNITS_PER_TWD?: string;
};

export type AiEnergyMeter = {
  energyUnitsPerTwd: number;
};

export function resolveAiEnergyMeter(env: AiEnergyMeterEnv): AiEnergyMeter {
  const raw = env.ENERGY_UNITS_PER_TWD?.trim();
  if (!raw) {
    throw new Error('ENERGY_UNITS_PER_TWD is required before User Energy AI settlement can be enabled');
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('ENERGY_UNITS_PER_TWD must be a positive finite number');
  }
  return { energyUnitsPerTwd: value };
}

export function aiCostTwdToEnergyUnits(costTwd: string | number, meter: AiEnergyMeter): bigint {
  const cost = typeof costTwd === 'number' ? costTwd : Number(costTwd);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('AI costTwd must be a non-negative finite number');
  if (!Number.isFinite(meter.energyUnitsPerTwd) || meter.energyUnitsPerTwd <= 0) {
    throw new Error('energyUnitsPerTwd must be a positive finite number');
  }
  if (cost === 0) return 0n;
  const units = Math.ceil(cost * meter.energyUnitsPerTwd);
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error('AI Energy charge is outside safe integer range');
  }
  return BigInt(units);
}
