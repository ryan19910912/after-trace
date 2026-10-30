import {
  allRecords,
  createRecord,
  updateRecord,
  type LocalRecord,
} from "./local-store";
export type WorklogRecord = LocalRecord & {
  sourceId: number;
  entityId: null;
  authorUserId: null;
  authorDisplayName: null;
  inputType: "TEXT";
  deletedAt: string | null;
};
export type RecordScope = { type: "PERSONAL" | "GROUP"; sourceId: number };
export type WorklogSurfaces = {
  personal: { sourceId: number };
  groups: { sourceId: number; name: string }[];
};
export type RecordFilters = {
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};
const adapt = (r: LocalRecord): WorklogRecord => ({
  ...r,
  sourceId: 1,
  entityId: null,
  authorUserId: null,
  authorDisplayName: null,
  inputType: "TEXT",
  deletedAt: r.status === "DELETED" ? r.updatedAt : null,
});
export class WorklogApi {
  constructor(readonly baseUrl = "") {}
  async surfaces(_unused?: string): Promise<WorklogSurfaces> {
    return { personal: { sourceId: 1 }, groups: [] };
  }
  async record(_unused: string, id: number) {
    const r = (await allRecords()).find(
      (r) => r.id === id && r.status === "ACTIVE",
    );
    if (!r) throw Error("找不到紀錄。");
    return adapt(r);
  }
  async personalRecords(_unused: string, filters: RecordFilters = {}) {
    const records = (await allRecords())
      .filter(
        (r) =>
          r.status === "ACTIVE" &&
          (!filters.query ||
            (r.rawText + " " + (r.title ?? ""))
              .toLocaleLowerCase()
              .includes(filters.query.toLocaleLowerCase())) &&
          (!filters.from || (r.occurredAt ?? r.createdAt) >= filters.from) &&
          (!filters.to || (r.occurredAt ?? r.createdAt) <= filters.to),
      )
      .sort(
        (a, b) =>
          (b.occurredAt ?? b.createdAt).localeCompare(
            a.occurredAt ?? a.createdAt,
          ) || b.id - a.id,
      );
    const limit = filters.limit ?? 20,
      offset = filters.offset ?? 0;
    return {
      records: records.slice(offset, offset + limit).map(adapt),
      page: {
        hasMore: records.length > offset + limit,
        limit,
        offset,
        nextOffset: records.length > offset + limit ? offset + limit : null,
      },
    };
  }
  async groupRecords(
    _unused: string,
    _source: number,
    filters: RecordFilters = {},
  ) {
    return this.personalRecords("", filters);
  }
  async createRecord(
    _unused: string,
    _scope: RecordScope,
    input: {
      title?: string | null;
      rawText: string;
      occurredAt?: string | null;
    },
  ) {
    return adapt(await createRecord(input));
  }
  async updateRecord(
    _unused: string,
    id: number,
    version: number,
    input: {
      title?: string | null;
      rawText: string;
      occurredAt?: string | null;
    },
  ) {
    return adapt(await updateRecord(id, version, input));
  }
}
