import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./routes.ts', import.meta.url)), 'utf8');

describe('PWA record route stale-version ordering', () => {
  it('rejects a stale manual edit before the no-op success path', () => {
    const block = routeBlock("app.patch('/records/:recordId'", "app.post('/records/:recordId/move'");
    expectBefore(
      block,
      "if (expectedVersion !== current.version) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);",
      "if (nextText === current.rawText && nextOccurredAt.getTime() === current.occurredAt.getTime())",
    );
  });

  it('rejects a stale single move before resolving or creating a target title', () => {
    const block = routeBlock("app.post('/records/:recordId/move'", "app.post('/records/batch-move'");
    expectBefore(
      block,
      "if (expectedVersion !== current.version) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);",
      'const entity = await resolveManualEntity',
    );
  });

  it('rejects any stale batch member before resolving or creating the target title', () => {
    const block = routeBlock("app.post('/records/batch-move'", "app.delete('/records/:recordId'");
    expectBefore(
      block,
      "if (snapshots.some((row) => expected.get(row.id) !== row.version))",
      'const entity = await resolveManualEntity',
    );
  });
});

function routeBlock(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function expectBefore(block: string, earlier: string, later: string): void {
  const earlierIndex = block.indexOf(earlier);
  const laterIndex = block.indexOf(later);
  expect(earlierIndex).toBeGreaterThanOrEqual(0);
  expect(laterIndex).toBeGreaterThanOrEqual(0);
  expect(earlierIndex).toBeLessThan(laterIndex);
}
