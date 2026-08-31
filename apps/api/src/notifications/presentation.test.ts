import { describe, expect, it } from 'vitest';
import { claimFirstActionablePresentation } from './presentation';

describe('claimFirstActionablePresentation', () => {
  it('keeps scanning when stale candidates precede an actionable delivery', async () => {
    const queue = [
      { deliveryId: 101 },
      { deliveryId: 102 },
      { deliveryId: 103 },
    ];
    const checked: number[] = [];

    const result = await claimFirstActionablePresentation({
      claim: async () => queue.shift() ?? null,
      isActionable: async (deliveryId) => {
        checked.push(deliveryId);
        return deliveryId === 103;
      },
    });

    expect(result).toEqual({ deliveryId: 103 });
    expect(checked).toEqual([101, 102, 103]);
  });

  it('returns null immediately when there is no presentation candidate', async () => {
    let claims = 0;
    const result = await claimFirstActionablePresentation({
      claim: async () => {
        claims += 1;
        return null;
      },
      isActionable: async () => true,
    });

    expect(result).toBeNull();
    expect(claims).toBe(1);
  });

  it('caps stale draining so one Service Worker request cannot loop forever', async () => {
    let nextId = 1;
    const checked: number[] = [];
    const result = await claimFirstActionablePresentation({
      claim: async () => ({ deliveryId: nextId++ }),
      isActionable: async (deliveryId) => {
        checked.push(deliveryId);
        return false;
      },
      maxClaims: 3,
    });

    expect(result).toBeNull();
    expect(checked).toEqual([1, 2, 3]);
    expect(nextId).toBe(4);
  });
});
