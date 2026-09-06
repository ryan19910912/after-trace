import { describe, expect, it } from 'vitest';
import { diffValues } from './AdminDiagnostics';

describe('audit field diff', () => {
  it('marks unchanged fields green-compatible and changed fields red-compatible', () => {
    const rows = diffValues(
      { code: 'FREE', enabled: true, grant_points: 400000, capabilities: { voice: true } },
      { code: 'FREE', enabled: false, grant_points: 400000, capabilities: { voice: true } },
    );
    expect(rows.find((row) => row.field === 'code')?.changed).toBe(false);
    expect(rows.find((row) => row.field === 'grant_points')?.changed).toBe(false);
    expect(rows.find((row) => row.field === 'capabilities.voice')?.changed).toBe(false);
    expect(rows.find((row) => row.field === 'enabled')?.changed).toBe(true);
  });
});
