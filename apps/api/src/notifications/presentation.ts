export type ClaimedPresentation = {
  deliveryId: number;
};

/**
 * A single bare Web Push wake can race with several durable deliveries queued
 * for the same browser endpoint. A stale delivery must not consume that wake
 * and prevent a later actionable delivery from being presented.
 *
 * claim() intentionally consumes each candidate before the current-truth check;
 * when a candidate is stale we keep scanning within the same browser wake.
 * The repository bounds its own candidate query and this helper adds a second
 * hard cap so a corrupted/stale queue cannot keep a Service Worker request open.
 */
export async function claimFirstActionablePresentation<T extends ClaimedPresentation>(input: {
  claim(): Promise<T | null>;
  isActionable(deliveryId: number): Promise<boolean>;
  maxClaims?: number;
}): Promise<T | null> {
  const maxClaims = Math.max(1, Math.min(10, Math.trunc(input.maxClaims ?? 5)));

  for (let attempt = 0; attempt < maxClaims; attempt += 1) {
    const candidate = await input.claim();
    if (!candidate) return null;
    if (await input.isActionable(candidate.deliveryId)) return candidate;
  }

  return null;
}
