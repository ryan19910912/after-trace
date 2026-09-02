import { describe, expect, it } from 'vitest';
import { canonicalCustomerId } from './drizzle-workspace-management';

describe('workspace customer/project link canonicalization', () => {
  it('uses the project customer when the project is already assigned to one', () => {
    expect(canonicalCustomerId(11, 22)).toBe(22);
    expect(canonicalCustomerId(null, 22)).toBe(22);
  });

  it('keeps an explicitly selected customer when the project has no customer', () => {
    expect(canonicalCustomerId(11, null)).toBe(11);
    expect(canonicalCustomerId(null, null)).toBeNull();
  });
});
