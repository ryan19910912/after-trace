import { useEffect, useRef, useState, type FormEvent } from "react";
import { CaptureRoot } from "./CaptureRoot";
import { installNavigation } from "./navigation";
import { installTaipeiDateDisplayPolicy } from "./time-display";
import { cancelLocalAi, releaseLocalAi } from "./local-ai";
import { localAiTool } from "./local-ai-tools";
import { WorklogApi } from "./worklog-api";
import {
  allRecords,
  allTasks,
  updateRecord,
  createTask,
  setTaskStatus,
  exportBackup,
  parseBackup,
  previewImport,
  importBackup,
  MAX_BACKUP_BYTES,
  type LocalRecord,
  type LocalTask,
  type Backup,
  type ImportPreview,
} from "./local-store";
import { localModelCacheInfo, clearLocalModelCache } from "./model-cache";
import { resetSpeechModelChoice } from "./speech-runtime";
import { getModelConfiguration } from "./model-config";
import { LocalAiStatus } from "./LocalAiStatus";
import "./app.css";
const api = new WorklogApi();
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失敗，請重試。";
const display = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
    : "未指定";
const localDate = (v: string | null) =>
  v
    ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
function useRefresh() {
  const [n, set] = useState(0);
  useEffect(() => {
    const f = () => set((v) => v + 1);
    window.addEventListener("aftertrace:local-change", f);
    window.addEventListener("focus", f);
    return () => {
      window.removeEventListener("aftertrace:local-change", f);
      window.removeEventListener("focus", f);
    };
  }, []);
  return n;
}
function Notice({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="banner success">
          {notice}
        </p>
      )}
    </>
  );
}
function useUnsavedGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const guard = (e: Event) => {
      if (!confirm("離開會捨棄尚未保存的修改，確定離開？")) e.preventDefault();
    };
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("aftertrace:before-navigate", guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("aftertrace:before-navigate", guard);
      window.removeEventListener("beforeunload", unload);
    };
  }, [active]);
}
function Records() {
  const refresh = useRefresh(),
    [records, setRecords] = useState<LocalRecord[]>([]),
    [query, setQuery] = useState(""),
    [trash, setTrash] = useState(false),
    [limit, setLimit] = useState(20),
    [editing, setEditing] = useState<LocalRecord | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<LocalRecord | null>(null);
  useUnsavedGuard(!!editing);
  useEffect(() => {
    let active = true;
    void allRecords()
      .then((r) => {
        if (active) setRecords(r);
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [refresh]);
  const filtered = records
    .filter(
      (r) =>
        r.status === (trash ? "DELETED" : "ACTIVE") &&
        (!query ||
          (r.rawText + " " + r.title)
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase())),
    )
    .sort(
      (a, b) =>
        (b.occurredAt ?? b.createdAt).localeCompare(
          a.occurredAt ?? a.createdAt,
        ) || b.id - a.id,
    );
  async function change(r: LocalRecord, status: "ACTIVE" | "DELETED") {
    if (
      busy ||
      !confirm(
        status === "DELETED"
          ? "移至已刪除紀錄？之後仍可還原。"
          : "還原這筆紀錄？",
      )
    )
      return;
    setBusy(true);
    try {
      await updateRecord(r.id, r.version, { ...r, status });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="我的紀錄"
        subtitle="只保存在此裝置，不會上傳或自動跨裝置同步。"
      />
      <Notice error={error} />
      <section className="card">
        <div className="actions">
          <a className="button" href="/capture">
            新增紀錄
          </a>
          <button
            className="ghost"
            onClick={() => {
              setTrash((v) => !v);
              setLimit(20);
            }}
          >
            {trash ? "返回一般紀錄" : "查看已刪除紀錄"}
          </button>
        </div>
        <label>
          搜尋本機紀錄
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(20);
            }}
            placeholder="標題或內容關鍵字"
          />
        </label>
      </section>
      <p className="muted">
        {trash ? "已刪除" : "一般"}紀錄，共 {filtered.length} 筆
      </p>
      <section className="stack">
        {filtered.slice(0, limit).map((r) => (
          <article key={r.uid} className="card record">
            <h2>{r.title || "未命名紀錄"}</h2>
            <p className="muted">
              紀錄編號 #{r.id} · 發生時間：{display(r.occurredAt)} · 版本{" "}
              {r.version}
            </p>
            <p className="record-text">{r.rawText}</p>
            <div className="actions">
              {!trash && (
                <button
                  disabled={busy}
                  className="ghost"
                  onClick={() => setEditing({ ...r })}
                >
                  修改紀錄
                </button>
              )}
              <button
                disabled={busy}
                className="ghost"
                onClick={() => setHistory(r)}
              >
                修改歷史
              </button>
              <button
                disabled={busy}
                className="ghost"
                onClick={() => void change(r, trash ? "ACTIVE" : "DELETED")}
              >
                {trash ? "還原紀錄" : "刪除紀錄"}
              </button>
            </div>
          </article>
        ))}
        {!filtered.length && (
          <div className="card">
            {query
              ? "找不到符合條件的紀錄。"
              : "目前沒有紀錄。你可以新增紀錄，或匯入備份。"}
          </div>
        )}
      </section>
      {filtered.length > limit && (
        <button className="ghost" onClick={() => setLimit((v) => v + 20)}>
          顯示更多紀錄
        </button>
      )}
      {editing && (
        <Dialog
          title="修改紀錄"
          onClose={() => {
            if (confirm("捨棄未保存的修改？")) setEditing(null);
          }}
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await updateRecord(editing.id, editing.version, editing);
                setEditing(null);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Notice error={error} />
            <label>
              標題
              <input
                maxLength={255}
                value={editing.title ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
              />
            </label>
            <label>
              內容
              <textarea
                aria-label="內容"
                maxLength={20000}
                rows={8}
                value={editing.rawText}
                onChange={(e) =>
                  setEditing({ ...editing, rawText: e.target.value })
                }
              />
            </label>
            <label>
              發生時間（選填）
              <input
                type="datetime-local"
                value={localDate(editing.occurredAt)}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    occurredAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </label>
            <button disabled={busy || !editing.rawText.trim()}>保存修改</button>
          </form>
        </Dialog>
      )}
      {history && (
        <Dialog title="修改歷史" onClose={() => setHistory(null)}>
          <p>目前為版本 {history.version}；以下是修改前的內容。</p>
          {history.history.length ? (
            history.history
              .slice()
              .reverse()
              .map((r) => (
                <article className="card" key={r.version}>
                  <h3>
                    版本 {r.version} ·{" "}
                    {r.status === "DELETED" ? "已刪除" : "一般"}
                  </h3>
                  <p>{display(r.updatedAt)}</p>
                  <h4>{r.title || "未命名紀錄"}</h4>
                  <p className="record-text">{r.rawText}</p>
                </article>
              ))
          ) : (
            <p>尚無修改歷史。</p>
          )}
        </Dialog>
      )}
    </>
  );
}
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-title">
      <p className="eyebrow">AFTERTRACE · LOCAL</p>
      <h1>{title}</h1>
      <p className="muted">{subtitle}</p>
    </header>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => prev?.focus();
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="dialog-heading">
        <h2>{title}</h2>
        <button className="ghost" onClick={onClose}>
          關閉
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Tasks() {
  const refresh = useRefresh(),
    [tasks, setTasks] = useState<LocalTask[]>([]),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [date, setDate] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useUnsavedGuard(!!(title.trim() || body.trim() || date));
  useEffect(() => {
    void allTasks()
      .then(setTasks)
      .catch((e) => setError(errorText(e)));
  }, [refresh]);
  return (
    <>
      <PageTitle
        title="本機待辦"
        subtitle="待辦只保存在此裝置。到期時間供列表查看，不會在背景推播。"
      />
      <Notice error={error} />
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await createTask({ title, body, dueAt: date || null });
            setTitle("");
            setBody("");
            setDate("");
            setError("");
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          待辦名稱
          <input
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          待辦內容
          <textarea
            aria-label="待辦內容"
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label>
          到期時間（選填）
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button disabled={busy || !title.trim()}>新增待辦</button>
      </form>
      <section className="stack">
        {tasks
          .sort(
            (a, b) =>
              (a.status === "OPEN" ? 0 : 1) - (b.status === "OPEN" ? 0 : 1) ||
              b.id - a.id,
          )
          .map((t) => (
            <article className="card" key={t.uid}>
              <h2>{t.title}</h2>
              <p>
                {t.status === "OPEN" ? "待完成" : "已完成"} · {display(t.dueAt)}
              </p>
              <p className="record-text">{t.body}</p>
              <button
                disabled={busy}
                className="ghost"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await setTaskStatus(
                      t.id,
                      t.version,
                      t.status === "OPEN" ? "DONE" : "OPEN",
                    );
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.status === "OPEN" ? "標記完成" : "重新開啟"}
              </button>
            </article>
          ))}
      </section>
    </>
  );
}
function BackupPage() {
  const [backup, setBackup] = useState<Backup | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [conflict, setConflict] = useState<"keep-local" | "keep-both">(
      "keep-local",
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [includeHistory, setIncludeHistory] = useState(true);
  const ticket = useRef(0);
  async function selectFile(file?: File) {
    const n = ++ticket.current;
    setBackup(null);
    setPreview(null);
    setError("");
    setNotice("");
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw Error("備份檔不能超過 20 MB。");
      const parsed = parseBackup(await file.text()),
        plan = await previewImport(parsed);
      if (n === ticket.current) {
        setBackup(parsed);
        setPreview(plan);
      }
    } catch (e) {
      if (n === ticket.current) setError(errorText(e));
    } finally {
      if (n === ticket.current) setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="備份與匯入"
        subtitle="備份是跨裝置搬移及資料還原的方式，不是自動同步。"
      />
      <Notice error={error} notice={notice} />
      <section className="card stack">
        <h2>匯出備份</h2>
        <p>
          包含紀錄、已刪除紀錄、修改歷史與待辦；不包含圖片、錄音、模型或登入資料。JSON
          檔未加密，請妥善保管。
        </p>
        <div className="two-columns">
          <label>
            匯出開始日期（選填）
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            匯出結束日期（選填）
            <input
              type="date"
              min={from || undefined}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setIncludeHistory(e.target.checked)}
          />
          包含修改歷史（取消勾選只備份目前版本）
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (from && to && from > to)
                throw Error("開始日期不能晚於結束日期。");
              const data = await exportBackup();
              const match = (r: {
                createdAt: string;
                occurredAt?: string | null;
              }) => {
                const date = localDate(r.occurredAt ?? r.createdAt).slice(
                  0,
                  10,
                );
                return (!from || date >= from) && (!to || date <= to);
              };
              data.records = data.records
                .filter(match)
                .map((r) => (includeHistory ? r : { ...r, history: [] }));
              data.tasks = data.tasks.filter(match);
              const text = JSON.stringify(data, null, 2);
              parseBackup(text);
              const url = URL.createObjectURL(
                  new Blob([text], { type: "application/json" }),
                ),
                a = document.createElement("a");
              a.href = url;
              a.download =
                "aftertrace-backup-" +
                new Date().toISOString().slice(0, 10) +
                ".json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
              localStorage.setItem(
                "aftertrace.last-backup",
                new Date().toISOString(),
              );
              setNotice(
                "已開始下載備份：" +
                  data.records.length +
                  " 筆紀錄、" +
                  data.tasks.length +
                  " 筆待辦。請確認檔案已保存。",
              );
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          匯出紀錄備份
        </button>
        <p className="muted">
          單檔上限 20 MB／10,000 筆。資料較多時可用日期分批匯出。
        </p>
      </section>
      <section className="card stack">
        <h2>匯入備份</h2>
        <p>
          只接受 AFTERTRACE JSON
          備份，會先驗證並預覽；不會清空目前資料。雲端舊版資料請先保留在留存版本，不要將資料庫匯出檔直接匯入。
        </p>
        <label>
          選擇備份檔
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              void selectFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {preview && backup && (
          <section className="import-preview" aria-label="匯入預覽">
            <h3>確認匯入內容</h3>
            <p>
              紀錄 {preview.records} 筆、待辦 {preview.tasks} 筆
            </p>
            <p>
              新增 {preview.added} 筆 · 重複 {preview.duplicates} 筆 · 衝突{" "}
              {preview.conflicts} 筆
            </p>
            <label>
              衝突處理
              <select
                value={conflict}
                disabled={busy}
                onChange={(e) => setConflict(e.target.value as typeof conflict)}
              >
                <option value="keep-local">保留本機版本，略過衝突</option>
                <option value="keep-both">保留兩份，匯入為獨立副本</option>
              </select>
            </label>
            <p className="muted">
              匯入時會重新檢查目前資料；另一個分頁的變更不會被直接覆蓋。
            </p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const plan = await importBackup(backup, conflict);
                    setNotice(
                      "匯入完成。新增 " +
                        plan.added +
                        " 筆、略過重複 " +
                        plan.duplicates +
                        " 筆、" +
                        (conflict === "keep-both" ? "保留兩份" : "略過") +
                        "衝突 " +
                        plan.conflicts +
                        " 筆。",
                    );
                    setBackup(null);
                    setPreview(null);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                確認匯入
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  ticket.current++;
                  setBackup(null);
                  setPreview(null);
                }}
              >
                取消匯入
              </button>
            </div>
          </section>
        )}
      </section>
    </>
  );
}
function Tools() {
  const [mode, setMode] = useState("summary"),
    [query, setQuery] = useState(""),
    [recordId, setRecordId] = useState(""),
    [instruction, setInstruction] = useState("整理語句，保留所有事實。"),
    [result, setResult] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState("");
  const controller = useRef<AbortController | null>(null);
  useUnsavedGuard(!!result && ["rewrite", "task-proposal"].includes(mode));
  useEffect(
    () => () => {
      controller.current?.abort();
      cancelLocalAi();
    },
    [],
  );
  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    controller.current = new AbortController();
    try {
      const r = await localAiTool(
        api,
        "local",
        "/" + mode,
        {
          sourceId: 1,
          query,
          text: query,
          timeZone: "Asia/Taipei",
          recordId: recordId ? Number(recordId) : undefined,
          instruction,
          from: "1900-01-01T00:00:00Z",
          to: "2200-01-01T00:00:00Z",
        },
        { signal: controller.current.signal },
      );
      setResult(r);
      setProposal(String(r.proposedText ?? ""));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="本機 AI 整理"
        subtitle="讀取此裝置的紀錄進行搜尋、摘要、改寫或產生待辦建議；建議不會自動保存。"
      />
      <Notice error={error} />
      <LocalAiStatus onCancel={() => controller.current?.abort()} />
      <form className="card stack" onSubmit={run}>
        <label>
          整理功能
          <select
            disabled={busy}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setResult(null);
            }}
          >
            <option value="summary">摘要紀錄</option>
            <option value="search">AI 搜尋</option>
            <option value="rewrite">改寫紀錄</option>
            <option value="related">相關紀錄</option>
            <option value="task-proposal">產生待辦建議</option>
          </select>
        </label>
        {["search", "task-proposal"].includes(mode) && (
          <label>
            需求內容
            <textarea
              aria-label="需求內容"
              required
              maxLength={2000}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {["rewrite", "related"].includes(mode) && (
          <label>
            紀錄編號
            <input
              required
              type="number"
              min="1"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
            />
          </label>
        )}
        {mode === "rewrite" && (
          <label>
            改寫要求
            <input
              maxLength={1000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
        )}
        <button disabled={busy}>產生 AI 建議</button>
      </form>
      {result && (
        <section className="card stack" aria-label="AI 建議結果">
          {result.status === "NO_RECORDS" ? (
            <p>目前沒有可整理的紀錄。</p>
          ) : mode === "rewrite" ? (
            <>
              <label>
                改寫建議
                <textarea
                  aria-label="改寫建議"
                  rows={8}
                  value={proposal}
                  maxLength={20000}
                  onChange={(e) => setProposal(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !proposal.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const current = await api.record(
                      "",
                      Number(result.recordId),
                    );
                    if (current.version !== result.expectedVersion)
                      throw Error("紀錄已變更，請重新產生建議。");
                    await updateRecord(current.id, current.version, {
                      ...current,
                      rawText: proposal,
                    });
                    setResult(null);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                確認套用改寫
              </button>
            </>
          ) : mode === "task-proposal" ? (
            <>
              <label>
                待辦名稱
                <input
                  maxLength={255}
                  value={String(result.title ?? "")}
                  onChange={(e) =>
                    setResult({ ...result, title: e.target.value })
                  }
                />
              </label>
              <label>
                待辦內容
                <textarea
                  aria-label="待辦內容"
                  value={String(result.body ?? "")}
                  maxLength={20000}
                  onChange={(e) =>
                    setResult({ ...result, body: e.target.value })
                  }
                />
              </label>
              <button
                disabled={busy || !String(result.title ?? "").trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await createTask({
                      title: String(result.title),
                      body: String(result.body ?? ""),
                    });
                    setResult(null);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                確認建立待辦
              </button>
            </>
          ) : mode === "summary" ? (
            <>
              <p className="record-text">{String(result.summary ?? "")}</p>
              <p className="muted">
                整理 {Number(result.recordCount ?? 0)} 筆
                {result.truncated ? "；僅處理前 400 筆，其他紀錄未納入。" : ""}
              </p>
            </>
          ) : (
            <>
              {((result.records as LocalRecord[]) ?? []).map((r) => (
                <article className="card" key={r.id}>
                  <h3>
                    #{r.id} {r.title || "未命名紀錄"}
                  </h3>
                  <p className="record-text">{r.rawText}</p>
                </article>
              ))}
              {!(result.records as LocalRecord[])?.length && (
                <p>沒有符合的紀錄。</p>
              )}
            </>
          )}
          <button
            className="ghost"
            disabled={busy}
            onClick={() => setResult(null)}
          >
            關閉建議
          </button>
        </section>
      )}
    </>
  );
}
function Settings() {
  const [info, setInfo] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void getModelConfiguration().then((c) =>
      setInfo(
        "文字／圖片：" +
          c.visionModel +
          "；語音優先：" +
          c.speechModel +
          "；備援：" +
          (c.speechFallbackModel ?? "未啟用"),
      ),
    );
  }, []);
  return (
    <>
      <PageTitle
        title="本機設定與說明"
        subtitle="免帳號、免登入。手機與電腦、不同瀏覽器各自保存資料。"
      />
      <Notice error={error} />
      <section className="card stack">
        <h2>資料與備份</h2>
        <p>
          清除網站資料、移除瀏覽器設定檔或裝置故障可能遺失紀錄。請定期匯出備份；我們沒有雲端副本，無法代為還原。
        </p>
        <a className="button" href="/backup">
          前往備份與匯入
        </a>
        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const storage = navigator.storage as StorageManager & {
                persist?: () => Promise<boolean>;
              };
              const granted = await storage.persist?.();
              setInfo(
                granted
                  ? "瀏覽器已允許持久儲存；仍請保留外部備份。"
                  : "瀏覽器未授予持久儲存，請定期備份。",
              );
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          申請較持久的本機儲存
        </button>
      </section>
      <section className="card stack">
        <h2>模型與快取</h2>
        <p className="break-word">{info}</p>
        <p>
          首次下載需連網及數百 MB 至數 GB
          空間；模型下載完整後可嘗試離線使用，仍取決於裝置 WebGPU
          與快取。語音改用 Whisper base Q8（約 80
          MB），本次試用不會自動下載其他語音模型。人名、金額等內容可能辨錯，請人工核對。
        </p>
        <div className="actions">
          <button
            className="ghost"
            disabled={busy}
            onClick={async () => {
              try {
                const r = await localModelCacheInfo();
                setInfo(
                  "模型快取 " +
                    r.files +
                    " 個檔案；網站使用約 " +
                    r.usedMiB +
                    " MiB，可用約 " +
                    r.availableMiB +
                    " MiB。",
                );
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            查看模型快取
          </button>
          <button
            className="ghost"
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "清除模型下載快取？紀錄與待辦不會刪除，下次 AI 需要重新下載。",
                )
              )
                return;
              setBusy(true);
              try {
                await clearLocalModelCache();
                setInfo("模型快取已清除，紀錄與待辦仍保留。");
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            清除模型快取
          </button>
          <button
            className="ghost"
            onClick={() => {
              resetSpeechModelChoice();
              setInfo("下次語音使用目前設定的 Whisper base。");
            }}
          >
            重設語音模型選擇
          </button>
        </div>
      </section>
      <section className="card stack">
        <h2>安裝與離線</h2>
        <p>
          Chrome／Edge 可從網址列安裝 App；iPhone 可在 Safari
          分享選單加入主畫面。首次開啟並完成網站快取後，可離線保存、搜尋、編輯與備份。背景提醒、群組及自動同步已移除。
        </p>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => {
            const data =
                localStorage.getItem("aftertrace.local-diagnostics") ?? "[]",
              url = URL.createObjectURL(
                new Blob([data], { type: "application/json" }),
              ),
              a = document.createElement("a");
            a.href = url;
            a.download = "aftertrace-local-diagnostics.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          }}
        >
          匯出本機診斷摘要
        </button>
        <p className="muted">
          診斷只含固定錯誤碼、模型選項、時間與事件
          ID，不含原文、圖片或錄音。不會自動送出。
        </p>
      </section>
    </>
  );
}
export function LocalApp() {
  const [route, setRoute] = useState(location.pathname),
    [dbError, setDbError] = useState(""),
    [update, setUpdate] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const receive = (e: Event) =>
      setUpdate((e as CustomEvent<ServiceWorker>).detail);
    window.addEventListener("aftertrace:update-ready", receive);
    return () => window.removeEventListener("aftertrace:update-ready", receive);
  }, []);
  useEffect(() => installNavigation(() => setRoute(location.pathname)), []);
  useEffect(() => {
    installTaipeiDateDisplayPolicy();
    void allRecords().catch((e) => setDbError(errorText(e)));
    const release = () => releaseLocalAi();
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);
  useEffect(() => {
    document.title =
      ({
        "/capture": "留下紀錄",
        "/backup": "備份與匯入",
        "/tasks": "本機待辦",
        "/ai-tools": "本機 AI 整理",
        "/settings": "本機設定",
      }[route] ?? "我的紀錄") + "｜AFTERTRACE";
    window.scrollTo(0, 0);
  }, [route]);
  const nav = [
    ["/", "紀錄"],
    ["/capture", "新增"],
    ["/tasks", "待辦"],
    ["/ai-tools", "AI 整理"],
    ["/backup", "備份"],
    ["/settings", "設定"],
  ];
  return (
    <>
      <header className="app-header">
        <a className="brand" href="/">
          <img src="/aftertrace-icon.svg" alt="" />
          AFTERTRACE <span>本機版</span>
        </a>
        <nav aria-label="主要導覽">
          {nav.map(([url, label]) => (
            <a
              key={url}
              href={url}
              aria-current={route === url ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {update && (
          <section className="banner success">
            <p>新版本已下載。更新會重新開啟頁面，請先保存草稿。</p>
            <button
              className="ghost"
              onClick={() => {
                if (
                  !window.dispatchEvent(
                    new Event("aftertrace:before-navigate", {
                      cancelable: true,
                    }),
                  )
                )
                  return;
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  () => location.reload(),
                  { once: true },
                );
                update.postMessage("ACTIVATE_UPDATE");
              }}
            >
              更新並重新開啟
            </button>
          </section>
        )}
        <p className="storage-notice">
          資料只在此裝置 · <a href="/backup">定期備份</a> · 不會自動同步
        </p>
        {dbError ? (
          <p role="alert" className="banner error">
            {dbError}
          </p>
        ) : (
          <div key={route}>
            {route === "/capture" ? (
              <CaptureRoot apiBaseUrl="" />
            ) : route === "/backup" ? (
              <BackupPage />
            ) : route === "/tasks" ? (
              <Tasks />
            ) : ["/ai-tools", "/ai-search", "/ai-task"].includes(route) ? (
              <Tools />
            ) : [
                "/settings",
                "/subscription",
                "/help",
                "/about",
                "/mobile-shortcut",
              ].includes(route) ? (
              <Settings />
            ) : ["/login", "/worklog", "/extension/connect"].includes(route) ? (
              <>
                <PageTitle
                  title="這裡不再需要登入"
                  subtitle="AFTERTRACE 已改為本機版，資料保存在目前裝置。"
                />
                <a className="button" href="/">
                  開始使用
                </a>
              </>
            ) : (
              <Records />
            )}
          </div>
        )}
      </main>
      <footer>AFTERTRACE · 用你的裝置，留下你的紀錄。</footer>
    </>
  );
}
