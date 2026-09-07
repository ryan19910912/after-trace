import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = join(process.cwd(), 'src/worklog/drizzle-subscription-lifecycle.ts');

describe('subscription lifecycle ordering SQL', () => {
  it('keeps paid periods monotonic and prevents stale period Grants', async () => {
    const source = await readFile(SOURCE, 'utf8');

    expect(source).toContain('EXCLUDED.updated_at >= worklog_user_subscriptions.updated_at');
    expect(source).toContain('EXCLUDED.current_period_start >= worklog_user_subscriptions.current_period_start');
    expect(source).toMatch(/FROM subscription_upsert\s+CROSS JOIN plan_row/);
    expect(source).not.toMatch(/FROM event_insert\s+CROSS JOIN plan_row/);
  });

  it('guards cancellation ordering and persists stale processing state', async () => {
    const source = await readFile(SOURCE, 'utf8');

    expect(source).toContain('subscription_row.updated_at <= ${event.occurredAt}');
    expect(source).toContain("'IGNORED_STALE'");
    expect(source).toContain("processing_result = CASE");
  });
});
