import { describe, expect, it } from 'vitest';
import {
  ADMIN_CAPABILITY_DEFINITIONS,
  defaultAdminCapabilities,
  validateAdminCapabilities,
} from './capabilities';

describe('Admin capability contract', () => {
  it('does not expose retired AI subscription capability gates', () => {
    expect(ADMIN_CAPABILITY_DEFINITIONS.map((definition) => definition.key)).toEqual(['export']);
    expect(defaultAdminCapabilities()).toEqual({ export: false });
  });

  it('ignores retired pre-Grant AI capability keys instead of reviving them', () => {
    expect(validateAdminCapabilities({
      privateOaRecording: false,
      aiTextRecording: false,
      aiMediaIngestion: false,
      export: false,
    })).toEqual({ export: false });
  });

  it('keeps unshipped export fail-closed', () => {
    expect(() => validateAdminCapabilities({ export: true })).toThrow('CAPABILITY_NOT_SHIPPED_export');
  });
});
