import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type WorklogAnomalySeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type WorklogAnomalyInput = {
  category: string;
  severity?: WorklogAnomalySeverity;
  errorCode?: string | null;
  summary: string;
  userId?: number | null;
  sourceId?: number | null;
  lineMessageId?: string | null;
  requestRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface WorklogAnomalyPort {
  record(input: WorklogAnomalyInput): Promise<void>;
}

export class DrizzleWorklogAnomalyRepository implements WorklogAnomalyPort {
  constructor(private readonly db: Database) {}

  async record(input: WorklogAnomalyInput): Promise<void> {
    const metadataJson = JSON.stringify(input.metadata ?? {});
    await this.db.execute(sql`
      INSERT INTO worklog_anomaly_events (
        category,
        severity,
        status,
        error_code,
        summary,
        user_id,
        source_id,
        line_message_id,
        request_ref,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        ${text(input.category, 128, 'WORKLOG_RUNTIME')},
        ${input.severity ?? 'ERROR'},
        'OPEN',
        ${nullableText(input.errorCode, 128)},
        ${text(input.summary, 2000, 'Worklog runtime failure')},
        ${positiveOrNull(input.userId)},
        ${positiveOrNull(input.sourceId)},
        ${nullableText(input.lineMessageId, 64)},
        ${nullableText(input.requestRef, 255)},
        ${metadataJson}::jsonb,
        NOW(),
        NOW()
      )
    `);
  }
}

export async function recordAnomalySafely(
  port: WorklogAnomalyPort | undefined,
  input: WorklogAnomalyInput,
): Promise<void> {
  if (!port) return;
  try {
    await port.record(input);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'worklog_anomaly_persist_failed',
      category: input.category,
      errorCode: input.errorCode ?? null,
      message: error instanceof Error ? error.message : 'unknown error',
    }));
  }
}

export function anomalyErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const value = (error as { code: string }).code.trim();
    if (value) return value.slice(0, 128);
  }
  return fallback.slice(0, 128);
}

export function anomalyErrorSummary(error: unknown, fallback: string): string {
  const value = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  return (value || fallback).slice(0, 2000);
}

function text(value: string, max: number, fallback: string): string {
  const normalized = value.trim();
  return (normalized || fallback).slice(0, max);
}

function nullableText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}
