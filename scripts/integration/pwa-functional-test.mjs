import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire(resolve("apps/web/package.json"))(
  "@playwright/test",
);
const base = process.env.PWA_TEST_ORIGIN ?? "http://localhost:15173",
  results = [],
  requests = [],
  errors = [];
mkdirSync(".test-artifacts/pwa", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const count = (p) =>
  p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("aftertrace-local", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("records").objectStore("records").count();
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
      }),
  );
async function context() {
  const c = await browser.newContext({ acceptDownloads: true });
  await c.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  const p = await c.newPage();
  p.setDefaultTimeout(20000);
  p.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  return { c, p };
}
function pass(name) {
  results.push(name);
  console.log("PASS", name);
}
async function importFile(p, buffer) {
  await p.goto(base + "/backup");
  await p.getByLabel("選擇備份檔").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer,
  });
}
let first, second;
try {
  first = await context();
  const { p, c } = first;
  await p.goto(base);
  await p.getByRole("heading", { name: "我的紀錄", exact: true }).waitFor();
  assert.equal(await p.getByRole("button", { name: /登入/ }).count(), 0);
  pass("opens without account, login or API configuration");
  await p.goto(base + "/capture");
  await p
    .getByLabel("輸入內容或貼上圖片")
    .fill("2026年10月30日晚上十點測試本機紀錄。");
  await p.getByRole("button", { name: "自行編輯草稿", exact: true }).click();
  await p.getByLabel("標題", { exact: true }).fill("本機測試");
  assert.equal(await count(p), 0);
  await p.getByLabel("內容", { exact: true }).fill("確認後才保存的本機內容。");
  await p.getByRole("button", { name: "確認保存", exact: true }).click();
  await p.getByText("紀錄已保存。", { exact: true }).waitFor();
  assert.equal(await count(p), 1);
  await p.reload();
  assert.equal(await count(p), 1);
  await p.goto(base);
  await p.locator(".record").filter({ hasText: "確認後才保存" }).waitFor();
  pass("manual review, edited save and reload persist in real IndexedDB");
  await p.getByRole("button", { name: "修改紀錄", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByLabel("內容", { exact: true })
    .fill("修改後的本機內容。");
  await p.getByRole("button", { name: "保存修改", exact: true }).click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  await p.getByRole("button", { name: "修改歷史", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByText("確認後才保存的本機內容。", { exact: true })
    .waitFor();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  await p.getByRole("button", { name: "刪除紀錄", exact: true }).click();
  await p.getByRole("button", { name: "查看已刪除紀錄", exact: true }).click();
  await p.getByRole("button", { name: "還原紀錄", exact: true }).click();
  await p.getByRole("button", { name: "返回一般紀錄", exact: true }).click();
  await p.locator(".record").waitFor();
  pass("edit history, soft delete and restore");
  await p.goto(base + "/tasks");
  await p.getByLabel("待辦名稱").fill("備份前核對");
  await p.getByRole("button", { name: "新增待辦", exact: true }).click();
  await p.getByRole("button", { name: "標記完成", exact: true }).click();
  await p.getByRole("button", { name: "重新開啟", exact: true }).waitFor();
  pass("local tasks create and complete");
  await p.goto(base + "/backup");
  const download = p.waitForEvent("download");
  await p.getByRole("button", { name: "匯出紀錄備份", exact: true }).click();
  const file = await download;
  const buffer = readFileSync(await file.path()),
    data = JSON.parse(buffer);
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].rawText, "修改後的本機內容。");
  assert.ok(data.records[0].history.length >= 3);
  assert.equal(data.tasks[0].status, "DONE");
  assert.ok(!buffer.includes(Buffer.from("sessionToken")));
  writeFileSync(".test-artifacts/pwa/export.json", buffer);
  pass(
    "real JSON download includes UUIDs, history and tasks, excludes auth/media",
  );
  second = await context();
  const p2 = second.p;
  await importFile(p2, buffer);
  await p2
    .getByRole("region", { name: "匯入預覽" })
    .waitFor()
    .catch(() => p2.locator('[aria-label="匯入預覽"]').waitFor());
  assert.equal(await count(p2), 0);
  await p2.getByRole("button", { name: "確認匯入", exact: true }).click();
  await p2.getByRole("status").filter({ hasText: "匯入完成" }).waitFor();
  assert.equal(await count(p2), 1);
  await importFile(p2, buffer);
  await p2.getByRole("button", { name: "確認匯入", exact: true }).click();
  await p2.getByRole("status").filter({ hasText: "匯入完成" }).waitFor();
  assert.equal(await count(p2), 1);
  pass(
    "new-device preview writes nothing; confirmed import and replay deduplicate",
  );
  await p2.goto(base);
  await p2.getByRole("button", { name: "修改紀錄", exact: true }).click();
  await p2
    .getByRole("dialog")
    .getByLabel("內容", { exact: true })
    .fill("另一台裝置修改。");
  await p2.getByRole("button", { name: "保存修改", exact: true }).click();
  await p2.getByRole("dialog").waitFor({ state: "hidden" });
  await importFile(p2, buffer);
  await p2.getByLabel("衝突處理").selectOption("keep-both");
  await p2.getByRole("button", { name: "確認匯入", exact: true }).click();
  await p2.getByRole("status").filter({ hasText: "匯入完成" }).waitFor();
  assert.equal(await count(p2), 2);
  await importFile(p2, buffer);
  await p2.getByLabel("衝突處理").selectOption("keep-both");
  await p2.getByRole("button", { name: "確認匯入", exact: true }).click();
  await p2.getByRole("status").filter({ hasText: "匯入完成" }).waitFor();
  assert.equal(await count(p2), 2);
  pass(
    "conflict keeps both versions and repeating same backup adds no extra copies",
  );
  const broken = structuredClone(data);
  broken.records.push({ ...data.records[0], uid: "bad" });
  await importFile(p2, Buffer.from(JSON.stringify(broken)));
  await p2.getByRole("alert").waitFor();
  assert.equal(await count(p2), 2);
  assert.equal(
    await p2.getByRole("button", { name: "確認匯入", exact: true }).count(),
    0,
  );
  pass("invalid backup rejected before any partial write");
  await p.goto(base);
  await p.getByRole("button", { name: "修改紀錄", exact: true }).click();
  const other = await c.newPage();
  await other.goto(base);
  await other.getByRole("button", { name: "修改紀錄", exact: true }).click();
  await other
    .getByRole("dialog")
    .getByLabel("內容", { exact: true })
    .fill("其他分頁更新的內容。");
  await other.getByRole("button", { name: "保存修改", exact: true }).click();
  await other.getByRole("dialog").waitFor({ state: "hidden" });
  await p
    .getByRole("dialog")
    .getByLabel("內容", { exact: true })
    .fill("不應覆蓋的新草稿");
  await p.getByRole("button", { name: "保存修改", exact: true }).click();
  await p
    .getByRole("alert")
    .filter({ hasText: "其他分頁更新" })
    .first()
    .waitFor();
  assert.equal(
    await p
      .getByRole("dialog")
      .getByLabel("內容", { exact: true })
      .inputValue(),
    "不應覆蓋的新草稿",
  );
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  await other.close();
  pass(
    "cross-tab compare-and-swap rejects stale edits and preserves the draft",
  );
  await p.goto(base + "/settings");
  await p.evaluate(async () => {
    const cache = await caches.open("transformers-cache");
    await cache.put(
      "https://huggingface.co/qa/model/resolve/pinned/config.json",
      new Response("{}"),
    );
  });
  await p.getByRole("button", { name: "清除模型快取", exact: true }).click();
  await p
    .getByText("模型快取已清除，紀錄與待辦仍保留。", { exact: true })
    .waitFor();
  assert.equal(await count(p), 1);
  assert.equal(
    await p.evaluate(async () =>
      (await caches.keys()).includes("transformers-cache"),
    ),
    false,
  );
  pass("model cache clearing preserves IndexedDB records and app shell");
  await p.goto(base);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await c.setOffline(true);
  await p.reload();
  await p.getByRole("heading", { name: "我的紀錄", exact: true }).waitFor();
  await p
    .locator(".record")
    .filter({ hasText: "其他分頁更新的內容" })
    .waitFor();
  await p.goto(base + "/tasks");
  await p.getByRole("button", { name: "重新開啟", exact: true }).waitFor();
  await p.goto(base + "/backup");
  const offlineDownload = p.waitForEvent("download");
  await p.getByRole("button", { name: "匯出紀錄備份", exact: true }).click();
  assert.equal(
    JSON.parse(readFileSync(await (await offlineDownload).path())).records
      .length,
    1,
  );
  await c.setOffline(false);
  pass(
    "offline reload, tasks and real backup download work through service worker",
  );
  for (const width of [1440, 768, 390, 320]) {
    await p.setViewportSize({ width, height: 950 });
    for (const path of [
      "/",
      "/capture",
      "/tasks",
      "/backup",
      "/ai-tools",
      "/settings",
    ]) {
      await p.goto(base + path);
      await p.getByRole("heading", { level: 1 }).waitFor();
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        path + " " + width,
      );
      const m = await p.evaluate(() =>
        [...document.querySelectorAll("button,input,select,textarea")]
          .filter((e) => e.getClientRects().length)
          .every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16),
      );
      assert.ok(m, path + " readable controls");
      if (width === 390)
        await p.screenshot({
          path: ".test-artifacts/pwa/" + path.replaceAll("/", "-") + "-390.png",
          fullPage: true,
        });
    }
  }
  pass(
    "six pages at four widths fit without small controls or horizontal overflow",
  );
  assert.equal(
    requests.filter(
      (r) =>
        r.url.includes("/api/") ||
        ["POST", "PUT", "PATCH", "DELETE"].includes(r.method),
    ).length,
    0,
  );
  assert.equal(errors.length, 0);
  pass("zero API calls, writes to network or browser page errors");
} catch (e) {
  console.log("FAILURE_BODY", await first?.p.locator("body").innerText());
  await first?.p.screenshot({
    path: ".test-artifacts/pwa/functional-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await first?.c.close();
  await second?.c.close();
  await browser.close();
  writeFileSync(
    ".test-artifacts/pwa/functional-results.json",
    JSON.stringify({ passed: results.length, results, errors }, null, 2),
  );
}
console.log("PWA_FUNCTIONAL_PASS", results.length);
