export type RecordStatus = "ACTIVE" | "DELETED";
export type Snapshot = {
  title: string | null;
  rawText: string;
  occurredAt: string | null;
  status: RecordStatus;
  version: number;
  updatedAt: string;
};
export type LocalRecord = Snapshot & {
  id: number;
  uid: string;
  createdAt: string;
  history: Snapshot[];
};
export type LocalTask = {
  id: number;
  uid: string;
  title: string;
  body: string;
  dueAt: string | null;
  status: "OPEN" | "DONE";
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Backup = {
  format: "AFTERTRACE_BACKUP";
  version: 1;
  exportedAt: string;
  records: Omit<LocalRecord, "id">[];
  tasks: Omit<LocalTask, "id">[];
};
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const channel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("aftertrace-local-changes")
    : undefined;
if (channel)
  channel.onmessage = () =>
    window.dispatchEvent(new Event("aftertrace:local-change"));
let pending: Promise<IDBDatabase> | undefined;
function database() {
  return (pending ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(Error("此瀏覽器無法開啟本機資料庫，請使用一般瀏覽模式。"));
      return;
    }
    const r = indexedDB.open("aftertrace-local", 1);
    r.onupgradeneeded = () => {
      for (const name of ["records", "tasks"]) {
        const s = r.result.createObjectStore(name, {
          keyPath: "id",
          autoIncrement: true,
        });
        s.createIndex("uid", "uid", { unique: true });
        s.createIndex("updatedAt", "updatedAt");
      }
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        pending = undefined;
      };
      resolve(r.result);
    };
    r.onerror = () => {
      pending = undefined;
      reject(Error("無法開啟本機資料庫；請檢查瀏覽器權限與可用空間。"));
    };
    r.onblocked = () => {
      pending = undefined;
      reject(Error("請先關閉其他 AFTERTRACE 分頁，再重新整理。"));
    };
  }));
}
const read = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function transaction<T>(
  names: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await database(),
    tx = db.transaction(names, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error("本機寫入失敗，資料未變更。"));
    tx.onerror = () => {};
  });
  try {
    const value = await work(tx);
    await done;
    if (mode === "readwrite") {
      window.dispatchEvent(new Event("aftertrace:local-change"));
      channel?.postMessage("changed");
    }
    return value;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already completed/aborted. */
    }
    await done.catch(() => {});
    if (error instanceof DOMException && error.name === "QuotaExceededError")
      throw Error("本機空間不足，內容尚未保存。請先匯出備份，再釋放裝置空間。");
    throw error;
  }
}
export async function allRecords() {
  return transaction(
    ["records"],
    "readonly",
    (tx) => read(tx.objectStore("records").getAll()) as Promise<LocalRecord[]>,
  );
}
export async function allTasks() {
  return transaction(
    ["tasks"],
    "readonly",
    (tx) => read(tx.objectStore("tasks").getAll()) as Promise<LocalTask[]>,
  );
}
export function snapshot(r: LocalRecord): Snapshot {
  return {
    title: r.title,
    rawText: r.rawText,
    occurredAt: r.occurredAt,
    status: r.status,
    version: r.version,
    updatedAt: r.updatedAt,
  };
}
function recordInput(input: {
  title?: string | null;
  rawText: string;
  occurredAt?: string | null;
}) {
  if (
    typeof input.rawText !== "string" ||
    !input.rawText.trim() ||
    input.rawText.length > 20000
  )
    throw Error("內容需為 1 至 20,000 字。");
  if (
    input.title != null &&
    (typeof input.title !== "string" || input.title.length > 255)
  )
    throw Error("標題最多 255 字。");
  if (input.occurredAt && !validDate(input.occurredAt))
    throw Error("發生時間格式不正確。");
  return {
    title: input.title?.trim() || null,
    rawText: input.rawText.trim(),
    occurredAt: input.occurredAt
      ? new Date(input.occurredAt).toISOString()
      : null,
  };
}
export async function createRecord(input: {
  title?: string | null;
  rawText: string;
  occurredAt?: string | null;
}) {
  const data = recordInput(input),
    now = new Date().toISOString();
  return transaction(["records"], "readwrite", async (tx) => {
    const r = {
      ...data,
      uid: crypto.randomUUID(),
      status: "ACTIVE" as const,
      version: 1,
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    const id = Number(await read(tx.objectStore("records").add(r)));
    return { ...r, id };
  });
}
export async function updateRecord(
  id: number,
  version: number,
  input: {
    title?: string | null;
    rawText: string;
    occurredAt?: string | null;
    status?: RecordStatus;
  },
) {
  const data = recordInput(input);
  return transaction(["records"], "readwrite", async (tx) => {
    const store = tx.objectStore("records"),
      old = (await read(store.get(id))) as LocalRecord | undefined;
    if (!old) throw Error("找不到紀錄。");
    if (old.version !== version)
      throw Error("紀錄已在其他分頁更新，請重新整理後再修改。");
    const next = {
      ...old,
      ...data,
      status: input.status ?? old.status,
      version: old.version + 1,
      updatedAt: new Date().toISOString(),
      history: [...old.history, snapshot(old)],
    };
    await read(store.put(next));
    return next;
  });
}
export async function createTask(input: {
  title: string;
  body?: string;
  dueAt?: string | null;
}) {
  if (
    !input.title.trim() ||
    input.title.length > 255 ||
    (input.body?.length ?? 0) > 20000 ||
    (input.dueAt && !validDate(input.dueAt))
  )
    throw Error("請填寫有效的待辦名稱與時間。");
  return transaction(["tasks"], "readwrite", async (tx) => {
    const now = new Date().toISOString(),
      r = {
        uid: crypto.randomUUID(),
        title: input.title.trim(),
        body: input.body ?? "",
        dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
        status: "OPEN" as const,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    const id = Number(await read(tx.objectStore("tasks").add(r)));
    return { ...r, id };
  });
}
export async function setTaskStatus(
  id: number,
  version: number,
  status: "OPEN" | "DONE",
) {
  return transaction(["tasks"], "readwrite", async (tx) => {
    const s = tx.objectStore("tasks"),
      old = (await read(s.get(id))) as LocalTask | undefined;
    if (!old || old.version !== version)
      throw Error("待辦已變更，請重新整理。");
    const next = {
      ...old,
      status,
      version: version + 1,
      updatedAt: new Date().toISOString(),
    };
    await read(s.put(next));
    return next;
  });
}
const portable = <T extends { id: number }>(value: T) => {
  const { id: _, ...rest } = value;
  return rest;
};
export async function exportBackup(): Promise<Backup> {
  return transaction(["records", "tasks"], "readonly", async (tx) => {
    const [records, tasks] = await Promise.all([
      read(tx.objectStore("records").getAll()) as Promise<LocalRecord[]>,
      read(tx.objectStore("tasks").getAll()) as Promise<LocalTask[]>,
    ]);
    return {
      format: "AFTERTRACE_BACKUP",
      version: 1,
      exportedAt: new Date().toISOString(),
      records: records.map(portable),
      tasks: tasks.map(portable),
    };
  });
}
const validDate = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const uid = (v: unknown) =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("備份格式不正確。");
  return v as Record<string, unknown>;
}
function exact(v: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(v).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in v))
  )
    throw Error("備份欄位不完整或含未知欄位。");
}
function parseSnapshot(value: unknown): Snapshot {
  const v = object(value);
  exact(v, [
    "title",
    "rawText",
    "occurredAt",
    "status",
    "version",
    "updatedAt",
  ]);
  recordInput(v as Snapshot);
  if (
    (v.title !== null && typeof v.title !== "string") ||
    !["ACTIVE", "DELETED"].includes(String(v.status)) ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1 ||
    !validDate(v.updatedAt) ||
    (v.occurredAt !== null && !validDate(v.occurredAt))
  )
    throw Error("紀錄欄位格式不正確。");
  return {
    title: v.title as string | null,
    rawText: v.rawText as string,
    occurredAt: v.occurredAt as string | null,
    status: v.status as RecordStatus,
    version: Number(v.version),
    updatedAt: v.updatedAt,
  };
}
export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw Error("備份檔不能超過 20 MB，請拆分備份或使用較小的檔案。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Error("這不是有效的 JSON 備份檔。");
  }
  const v = object(parsed);
  exact(v, ["format", "version", "exportedAt", "records", "tasks"]);
  if (
    v.format !== "AFTERTRACE_BACKUP" ||
    v.version !== 1 ||
    !validDate(v.exportedAt) ||
    !Array.isArray(v.records) ||
    !Array.isArray(v.tasks) ||
    v.records.length + v.tasks.length > 10000
  )
    throw Error("不支援此備份版本或資料筆數過多（上限 10,000 筆）。");
  const records = v.records.map((value) => {
    const r = object(value);
    exact(r, [
      "uid",
      "createdAt",
      "title",
      "rawText",
      "occurredAt",
      "status",
      "version",
      "updatedAt",
      "history",
    ]);
    if (
      !uid(r.uid) ||
      !validDate(r.createdAt) ||
      !Array.isArray(r.history) ||
      r.history.length > 10000
    )
      throw Error("紀錄 ID 或歷史格式不正確。");
    const current = parseSnapshot(
        Object.fromEntries(
          [
            "title",
            "rawText",
            "occurredAt",
            "status",
            "version",
            "updatedAt",
          ].map((k) => [k, r[k]]),
        ),
      ),
      history = r.history.map(parseSnapshot);
    if (
      history.some(
        (s, i) =>
          s.version >= current.version ||
          (i > 0 && s.version <= history[i - 1].version),
      )
    )
      throw Error("歷史版本順序不正確。");
    return {
      ...current,
      uid: r.uid as string,
      createdAt: r.createdAt,
      history,
    };
  });
  const tasks = v.tasks.map((value) => {
    const t = object(value);
    exact(t, [
      "uid",
      "title",
      "body",
      "dueAt",
      "status",
      "version",
      "createdAt",
      "updatedAt",
    ]);
    if (
      !uid(t.uid) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 255 ||
      typeof t.body !== "string" ||
      t.body.length > 20000 ||
      (t.dueAt !== null && !validDate(t.dueAt)) ||
      !["OPEN", "DONE"].includes(String(t.status)) ||
      !Number.isSafeInteger(t.version) ||
      Number(t.version) < 1 ||
      !validDate(t.createdAt) ||
      !validDate(t.updatedAt)
    )
      throw Error("待辦資料格式不正確。");
    return t as unknown as Omit<LocalTask, "id">;
  });
  for (const list of [records, tasks])
    if (new Set(list.map((r) => r.uid)).size !== list.length)
      throw Error("備份含重複 ID，未匯入任何資料。");
  return {
    format: "AFTERTRACE_BACKUP",
    version: 1,
    exportedAt: v.exportedAt,
    records,
    tasks,
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const contentKey = (value: object) =>
  canonical(
    Object.fromEntries(
      Object.entries(value).filter(([k]) => k !== "uid" && k !== "id"),
    ),
  );
function normalizedRecord(r: Omit<LocalRecord, "id">) {
  return {
    ...snapshot(r as LocalRecord),
    uid: r.uid,
    createdAt: r.createdAt,
    history: r.history,
  };
}
function equal(
  a: Omit<LocalRecord, "id"> | Omit<LocalTask, "id">,
  b: typeof a,
  kind: string,
) {
  return same(
    kind === "records" ? normalizedRecord(a as LocalRecord) : a,
    kind === "records" ? normalizedRecord(b as LocalRecord) : b,
  );
}
export type ImportPreview = {
  added: number;
  duplicates: number;
  conflicts: number;
  records: number;
  tasks: number;
};
async function mergePlan(
  tx: IDBTransaction,
  backup: Backup,
  apply: boolean,
  conflict: "keep-local" | "keep-both",
) {
  const summary: ImportPreview = {
    added: 0,
    duplicates: 0,
    conflicts: 0,
    records: backup.records.length,
    tasks: backup.tasks.length,
  };
  for (const kind of ["records", "tasks"] as const) {
    const store = tx.objectStore(kind),
      existing = (await read(store.getAll())) as (LocalRecord | LocalTask)[],
      knownContent = new Set(existing.map(contentKey));
    for (const incoming of backup[kind]) {
      const old = (await read(store.index("uid").get(incoming.uid))) as
        | LocalRecord
        | LocalTask
        | undefined;
      if (!old) {
        summary.added++;
        if (apply) await read(store.add(incoming));
      } else if (
        equal(
          portable(old) as Omit<LocalRecord, "id"> | Omit<LocalTask, "id">,
          incoming,
          kind,
        )
      )
        summary.duplicates++;
      else if (knownContent.has(contentKey(incoming))) {
        summary.duplicates++;
      } else {
        summary.conflicts++;
        if (apply && conflict === "keep-both") {
          await read(store.add({ ...incoming, uid: crypto.randomUUID() }));
          knownContent.add(contentKey(incoming));
        }
      }
    }
  }
  return summary;
}
export function previewImport(backup: Backup) {
  return transaction(["records", "tasks"], "readonly", (tx) =>
    mergePlan(tx, backup, false, "keep-local"),
  );
}
export function importBackup(
  backup: Backup,
  conflict: "keep-local" | "keep-both",
) {
  const valid = parseBackup(JSON.stringify(backup));
  return transaction(["records", "tasks"], "readwrite", (tx) =>
    mergePlan(tx, valid, true, conflict),
  );
}
