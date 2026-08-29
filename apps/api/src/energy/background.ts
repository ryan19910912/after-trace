export type BackgroundParticipant = {
  lineUserId: string;
  normalizedCharCount: number;
  availableEnergyUnits: bigint;
};

export type EligibleBackgroundParticipant = BackgroundParticipant & {
  contributionUnits: bigint;
};

export type BackgroundPreflight =
  | { status: 'SKIP_NO_ELIGIBLE_PARTICIPANT'; participants: [] }
  | { status: 'READY'; participants: BackgroundParticipant[] };

function validParticipant(participant: BackgroundParticipant): boolean {
  return (
    participant.lineUserId.trim().length > 0 &&
    Number.isSafeInteger(participant.normalizedCharCount) &&
    participant.normalizedCharCount > 0 &&
    participant.availableEnergyUnits > 0n
  );
}

export function backgroundPreflight(
  participants: readonly BackgroundParticipant[],
): BackgroundPreflight {
  const eligible = participants.filter(validParticipant).map((participant) => ({
    ...participant,
    lineUserId: participant.lineUserId.trim(),
  }));
  return eligible.length === 0
    ? { status: 'SKIP_NO_ELIGIBLE_PARTICIPANT', participants: [] }
    : { status: 'READY', participants: eligible };
}

export type BackgroundChargeShare = {
  lineUserId: string;
  allocatedUnits: bigint;
  userChargeUnits: bigint;
  platformSubsidyUnits: bigint;
};

export function allocateBackgroundCharge(
  participants: readonly BackgroundParticipant[],
  actualCostUnits: bigint,
): BackgroundChargeShare[] {
  if (actualCostUnits < 0n) throw new Error('actualCostUnits must be non-negative');
  const preflight = backgroundPreflight(participants);
  if (preflight.status !== 'READY') return [];

  const totalChars = preflight.participants.reduce(
    (sum, participant) => sum + BigInt(participant.normalizedCharCount),
    0n,
  );

  let allocated = 0n;
  return preflight.participants.map((participant, index) => {
    const isLast = index === preflight.participants.length - 1;
    const proportional = isLast
      ? actualCostUnits - allocated
      : (actualCostUnits * BigInt(participant.normalizedCharCount)) / totalChars;
    allocated += proportional;

    const userChargeUnits =
      participant.availableEnergyUnits < proportional
        ? participant.availableEnergyUnits
        : proportional;
    return {
      lineUserId: participant.lineUserId,
      allocatedUnits: proportional,
      userChargeUnits,
      platformSubsidyUnits: proportional - userChargeUnits,
    };
  });
}

export function eligibleMemorySubjects(
  participants: readonly BackgroundParticipant[],
): string[] {
  const preflight = backgroundPreflight(participants);
  return preflight.status === 'READY'
    ? preflight.participants.map((participant) => participant.lineUserId)
    : [];
}
