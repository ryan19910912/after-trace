import { describe, it, expect } from "vitest";
import { parseBackup } from "./local-store";
const now = "2026-10-30T12:00:00.000Z",
  record = {
    uid: "94b70b35-d389-40c1-b1b8-d91c43094b92",
    title: "測試",
    rawText: "原始內容",
    occurredAt: null,
    status: "ACTIVE",
    version: 1,
    updatedAt: now,
    createdAt: now,
    history: [],
  };
const backup = () => ({
  format: "AFTERTRACE_BACKUP",
  version: 1,
  exportedAt: now,
  records: [structuredClone(record)],
  tasks: [],
});
const parse = (v: unknown) => parseBackup(JSON.stringify(v));
describe("portable backup validation", () => {
  it("round-trips text, deletion status and stable UUID without local IDs", () => {
    const b = backup();
    b.records[0].status = "DELETED";
    expect(parse(b)).toEqual(b);
  });
  it("accepts an empty backup without inventing data", () => {
    const b = backup();
    b.records = [];
    expect(parse(b).records).toHaveLength(0);
  });
  it("rejects malformed JSON and unknown format versions", () => {
    expect(() => parseBackup("{bad")).toThrow("JSON");
    expect(() => parse({ ...backup(), version: 2 })).toThrow("版本");
  });
  it("rejects arbitrary account/media fields", () => {
    expect(() => parse({ ...backup(), token: "secret" })).toThrow("未知欄位");
    const b = backup();
    Object.assign(b.records[0], { image: "private" });
    expect(() => parse(b)).toThrow();
  });
  it("rejects duplicate UUIDs and invalid UUIDs before import", () => {
    const b = backup();
    b.records.push(structuredClone(record));
    expect(() => parse(b)).toThrow("重複 ID");
    b.records.pop();
    b.records[0].uid = "not-id";
    expect(() => parse(b)).toThrow();
  });
  it("rejects oversized and blank record content", () => {
    const b = backup();
    b.records[0].rawText = " ";
    expect(() => parse(b)).toThrow();
    b.records[0].rawText = "x".repeat(20001);
    expect(() => parse(b)).toThrow();
  });
  it("rejects broken history ordering", () => {
    const b = backup();
    Object.assign(b.records[0], {
      history: [
        {
          title: null,
          rawText: "舊內容",
          occurredAt: null,
          status: "ACTIVE",
          version: 2,
          updatedAt: now,
        },
      ],
    });
    expect(() => parse(b)).toThrow("歷史版本");
  });
  it("validates task statuses and dates", () => {
    const b = {
      ...backup(),
      tasks: [
        {
          uid: crypto.randomUUID(),
          title: "待辦",
          body: "內容",
          dueAt: null,
          status: "OPEN",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    expect(parse(b).tasks).toHaveLength(1);
    b.tasks[0].status = "INVALID";
    expect(() => parse(b)).toThrow("待辦");
  });
  it("keeps user markup as plain data for React text rendering", () => {
    const b = backup();
    b.records[0].rawText = "<script>alert(1)</script>";
    expect(parse(b).records[0].rawText).toBe(b.records[0].rawText);
  });
});
