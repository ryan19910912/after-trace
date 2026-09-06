import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogHistoryFilters } from './history-navigation';

export type WorklogHistoryMatch = {
  id: number;
  title: string | null;
  rawText: string;
  occurredAt: string;
};

export type WorklogHistoryQueryResult = {
  total: number;
  records: WorklogHistoryMatch[];
  filters: WorklogHistoryFilters;
  title: string | null;
  query: string | null;
};

type EntityNameRow = { id: string | number; name: string };
type MatchRow = {
  id: string | number;
  title: string | null;
  raw_text: string;
  occurred_at: Date | string;
};

/**
 * Provider-free retrieval for LINE history answers.
 * Authorization must be completed before this service receives sourceId.
 */
export class WorklogHistoryQueryService {
  constructor(private readonly db: Database) {}

  async query(sourceId: number, input: WorklogHistoryFilters, limit = 5): Promise<WorklogHistoryQueryResult> {
    const safeSourceId = positiveInteger(sourceId, 'sourceId');
    const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)));
    const originalQuery = input.query?.trim() || null;
    const entity = originalQuery ? await this.resolveMentionedEntity(safeSourceId, originalQuery) : null;
    const query = semanticQuery(originalQuery, entity?.name ?? null);
    const entityId = input.entityId ?? entity?.id ?? null;
    const from = input.from ? validDate(input.from, 'from') : null;
    const to = input.to ? validDate(input.to, 'to') : null;

    const result = await this.db.execute(sql`
      WITH matched AS (
        SELECT
          record.id,
          entity.name AS title,
          record.raw_text,
          record.occurred_at
        FROM worklog_records AS record
        LEFT JOIN worklog_entities AS entity ON entity.id = record.entity_id
        LEFT JOIN worklog_record_ai_normalizations AS normalization ON normalization.record_id = record.id
        WHERE record.source_id = ${safeSourceId}
          AND record.status = 'ACTIVE'
          AND (${entityId}::bigint IS NULL OR record.entity_id = ${entityId})
          AND (${from}::timestamptz IS NULL OR record.occurred_at >= ${from})
          AND (${to}::timestamptz IS NULL OR record.occurred_at < ${to})
          AND (
            ${query}::text IS NULL
            OR record.raw_text ILIKE '%' || ${query} || '%'
            OR COALESCE(entity.name, '') ILIKE '%' || ${query} || '%'
            OR EXISTS (
              SELECT 1
              FROM worklog_entity_aliases AS alias
              WHERE alias.entity_id = record.entity_id
                AND alias.alias ILIKE '%' || ${query} || '%'
            )
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(record.search_terms, '[]'::jsonb)) AS term(value)
              WHERE term.value ILIKE '%' || ${query} || '%'
            )
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(normalization.result_json -> 'searchTerms') = 'array'
                    THEN normalization.result_json -> 'searchTerms'
                  WHEN jsonb_typeof(normalization.result_json -> 'search_terms') = 'array'
                    THEN normalization.result_json -> 'search_terms'
                  ELSE '[]'::jsonb
                END
              ) AS ai_term(value)
              WHERE ai_term.value ILIKE '%' || ${query} || '%'
            )
          )
      ), counted AS (
        SELECT COUNT(*)::integer AS total FROM matched
      )
      SELECT matched.id::text AS id,
             matched.title,
             matched.raw_text,
             matched.occurred_at,
             counted.total
      FROM matched CROSS JOIN counted
      ORDER BY matched.occurred_at DESC, matched.id DESC
      LIMIT ${safeLimit}
    `);

    const rows = result.rows as Array<MatchRow & { total?: number | string }>;
    const total = rows.length > 0 ? Number(rows[0]?.total ?? rows.length) : await this.countEmptyAware({
      sourceId: safeSourceId,
      entityId,
      query,
      from,
      to,
    });

    return {
      total,
      records: rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        rawText: row.raw_text,
        occurredAt: new Date(row.occurred_at).toISOString(),
      })),
      filters: {
        ...(entityId ? { entityId } : {}),
        ...(query ? { query } : {}),
        ...(input.from ? { from: input.from } : {}),
        ...(input.to ? { to: input.to } : {}),
      },
      title: entity?.name ?? null,
      query,
    };
  }

  private async resolveMentionedEntity(sourceId: number, query: string): Promise<{ id: number; name: string } | null> {
    const result = await this.db.execute(sql`
      SELECT entity.id::text AS id, entity.name
      FROM worklog_entities AS entity
      WHERE entity.source_id = ${sourceId}
        AND entity.status = 'ACTIVE'
        AND (
          position(lower(entity.name) in lower(${query})) > 0
          OR EXISTS (
            SELECT 1 FROM worklog_entity_aliases AS alias
            WHERE alias.entity_id = entity.id
              AND position(lower(alias.alias) in lower(${query})) > 0
          )
        )
      ORDER BY length(entity.name) DESC, entity.id ASC
      LIMIT 1
    `);
    const row = result.rows[0] as EntityNameRow | undefined;
    return row ? { id: Number(row.id), name: row.name } : null;
  }

  private async countEmptyAware(input: {
    sourceId: number;
    entityId: number | null;
    query: string | null;
    from: Date | null;
    to: Date | null;
  }): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*)::integer AS total
      FROM worklog_records AS record
      LEFT JOIN worklog_entities AS entity ON entity.id = record.entity_id
      LEFT JOIN worklog_record_ai_normalizations AS normalization ON normalization.record_id = record.id
      WHERE record.source_id = ${input.sourceId}
        AND record.status = 'ACTIVE'
        AND (${input.entityId}::bigint IS NULL OR record.entity_id = ${input.entityId})
        AND (${input.from}::timestamptz IS NULL OR record.occurred_at >= ${input.from})
        AND (${input.to}::timestamptz IS NULL OR record.occurred_at < ${input.to})
        AND (
          ${input.query}::text IS NULL
          OR record.raw_text ILIKE '%' || ${input.query} || '%'
          OR COALESCE(entity.name, '') ILIKE '%' || ${input.query} || '%'
          OR EXISTS (
            SELECT 1 FROM worklog_entity_aliases AS alias
            WHERE alias.entity_id = record.entity_id AND alias.alias ILIKE '%' || ${input.query} || '%'
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(record.search_terms, '[]'::jsonb)) AS term(value)
            WHERE term.value ILIKE '%' || ${input.query} || '%'
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(normalization.result_json -> 'searchTerms') = 'array' THEN normalization.result_json -> 'searchTerms'
                WHEN jsonb_typeof(normalization.result_json -> 'search_terms') = 'array' THEN normalization.result_json -> 'search_terms'
                ELSE '[]'::jsonb
              END
            ) AS ai_term(value)
            WHERE ai_term.value ILIKE '%' || ${input.query} || '%'
          )
        )
    `);
    return Number((result.rows[0] as { total?: number | string } | undefined)?.total ?? 0);
  }
}

export function formatHistoryReply(result: WorklogHistoryQueryResult, url: string | null): string {
  const subject = result.title ? `「${result.title}」` : '符合條件的';
  const query = result.query ? `與「${result.query}」相關的` : '';
  const header = result.total === 0
    ? `目前沒有找到${subject}${query}紀錄。`
    : `找到 ${result.total} 筆${subject}${query}紀錄，以下是最近 ${Math.min(5, result.records.length)} 筆：`;
  const lines = result.records.map((record, index) => {
    const date = taipeiDate(record.occurredAt);
    return `${index + 1}. ${date}｜${compact(record.rawText, 140)}`;
  });
  if (url) lines.push(`查看更多紀錄：\n${url}`);
  return [header, ...lines].join('\n');
}

function semanticQuery(value: string | null, entityName: string | null): string | null {
  if (!value) return null;
  let query = value;
  if (entityName) query = query.replace(new RegExp(escapeRegExp(entityName), 'ig'), ' ');
  query = query
    .replace(/[？?！!。,.，、:：]/g, ' ')
    .replace(/(?:目前|現在|最近|當前)/g, ' ')
    .replace(/(?:進度|狀況|情況|狀態)/g, ' ')
    .replace(/(?:如何|怎樣|怎麼樣|怎麼|呢|嗎)/g, ' ')
    .replace(/(?:請|麻煩)?(?:幫我)?(?:查詢|查询|查一下|查看|看看|搜尋|搜索|找一下|找找|查|找)/g, ' ')
    .replace(/(?:有哪些紀錄|有什麼紀錄|哪些紀錄|紀錄|記錄|歷史|資料)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  query = query.replace(/^(?:的|有|是)\s*/, '').replace(/\s*(?:的|有|是)$/g, '').trim();
  return query ? query.slice(0, 200) : null;
}

function taipeiDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function validDate(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
