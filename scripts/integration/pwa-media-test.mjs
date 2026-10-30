import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire(resolve("apps/web/package.json"))(
    "@playwright/test",
  ),
  base = process.env.PWA_TEST_ORIGIN ?? "http://localhost:15173",
  root = ".test-artifacts/pwa-media",
  corpus = JSON.parse(readFileSync("config/local-ai-quality-cases.json")),
  results = [],
  network = [],
  failures = [];
mkdirSync(root, { recursive: true });
const ids = (
  process.env.PWA_MEDIA_CASES ??
  "T1,T2,I1,I2,S3,OFFLINE,OFFLINE_IMAGE,OFFLINE_SPEECH"
).split(",");
const records = (p) =>
  p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("aftertrace-local", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("records").objectStore("records").getAll();
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
      }),
  );
function audioFixture(id) {
  const b = readFileSync(
    resolve(".test-artifacts/content-quality/" + id + ".wav"),
  );
  let offset = 12,
    rate = 0;
  while (offset + 8 <= b.length) {
    const tag = b.toString("ascii", offset, offset + 4),
      length = b.readUInt32LE(offset + 4);
    if (tag === "fmt ") rate = b.readUInt32LE(offset + 16);
    if (tag === "data") {
      const out = Buffer.concat([
        b.subarray(0, offset + 8 + length),
        Buffer.alloc(rate * 2),
      ]);
      out.writeUInt32LE(out.length - 8, 4);
      out.writeUInt32LE(length + rate * 2, offset + 4);
      const path = resolve(root + "/" + id + ".wav");
      writeFileSync(path, out);
      return { path, seconds: length / rate + 1.3 };
    }
    offset += 8 + length + (length % 2);
  }
  throw Error("Invalid audio");
}
async function launch(audio) {
  const context = await chromium.launchPersistentContext(process.env.PWA_MEDIA_PROFILE ?? root + "/browser", {
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    timezoneId: "Asia/Taipei",
    viewport: { width: 1440, height: 1000 },
    args: audio
      ? [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          "--use-file-for-fake-audio-capture=" + audio.path,
        ]
      : [],
    permissions: audio ? ["microphone"] : [],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) ||
      r.url().includes("/api/v1/")
    )
      network.push({ url: r.url(), method: r.method() });
  });
  page.on("console", (m) => {
    if (m.type() === "error")
      console.log("MEDIA_BROWSER", m.text().slice(0, 450));
  });
  page.on("requestfailed", (r) => {
    if (!r.failure()?.errorText.includes("ABORTED"))
      failures.push({
        url: new URL(r.url()).pathname,
        error: r.failure()?.errorText,
      });
  });
  await page.goto(base + "/capture");
  await page.getByLabel("輸入內容或貼上圖片").waitFor();
  return { context, page };
}
let ui = await launch();
await ui.page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  await reg.update();
  if (reg.installing)
    await new Promise((resolve) => {
      const worker = reg.installing;
      worker.addEventListener("statechange", () => {
        if (["installed", "activated", "redundant"].includes(worker.state))
          resolve();
      });
    });
});
await ui.context.close();
ui = await launch();
let current = ui.page;
const timer = setInterval(async () => {
  if (current)
    console.log(
      "PWA_MEDIA_STATUS",
      (
        await current
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .match(/(?:下載|正在|模型資源下載失敗|本機解析失敗)[^\n]{0,100}/g)
        ?.slice(-3)
        .join(" | "),
    );
}, 20000);
try {
  for (const id of ids) {
    const item = structuredClone(
      corpus.find(
        (i) =>
          i.id ===
          (id === "OFFLINE"
            ? "T2"
            : id === "OFFLINE_IMAGE"
              ? "I1"
              : id === "OFFLINE_SPEECH"
                ? "S3"
                : id),
      ),
    );
    assert.ok(item, id);
    let audio;
    if (item.kind === "speech") {
      audio = audioFixture(item.id);
      current = null;
      await ui.context.close();
      ui = await launch(audio);
      current = ui.page;
    }
    const { page, context } = ui;
    const result = {
      id,
      kind: id.startsWith("OFFLINE") ? "offline-" + item.kind : item.kind,
    };
    console.log("PWA_MEDIA_START", id);
    try {
      if (id.startsWith("OFFLINE")) {
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await context.setOffline(true);
      }
      await page.goto(base + "/capture");
      await page.getByLabel("輸入內容或貼上圖片").waitFor();
      const before = (await records(page)).length;
      if (item.kind === "text")
        await page.getByLabel("輸入內容或貼上圖片").fill(item.reference);
      if (item.kind === "image") {
        const bytes = await page.evaluate(async (item) => {
          const c = document.createElement("canvas");
          c.width = 1000;
          c.height = 180 + item.lines.length * 85;
          const x = c.getContext("2d");
          x.fillStyle = "#fff";
          x.fillRect(0, 0, c.width, c.height);
          x.fillStyle = "#111";
          x.font = 'bold 45px "Microsoft JhengHei",sans-serif';
          item.lines.forEach((line, i) => x.fillText(line, 40, 85 + i * 85));
          const blob = await new Promise((r) => c.toBlob(r, "image/png"));
          if (item.id === "I2")
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
          const dt = new DataTransfer();
          dt.items.add(new File([blob], "case.png", { type: "image/png" }));
          document
            .querySelector("textarea")
            .dispatchEvent(
              new ClipboardEvent("paste", {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
              }),
            );
        }, item);
        if (bytes)
          await page
            .locator("input[type=file]")
            .setInputFiles({
              name: "case.png",
              mimeType: "image/png",
              buffer: Buffer.from(bytes),
            });
        await page.getByAltText("待解析圖片").waitFor();
      }
      if (item.kind === "speech") {
        await page.getByLabel("語音語言").selectOption("chinese");
        await page
          .getByRole("button", {
            name: "錄製短語音（最多 60 秒）",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "停止錄音", exact: true })
          .waitFor();
        await page.waitForTimeout(audio.seconds * 1000);
        await page
          .getByRole("button", { name: "停止錄音", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector("textarea")?.value.trim() ||
            document.querySelector("[role=alert]"),
          undefined,
          { timeout: 900000 },
        );
        if (await page.getByRole("alert").count())
          throw Error(await page.getByRole("alert").innerText());
        result.transcript = await page
          .getByLabel("輸入內容或貼上圖片")
          .inputValue();
        console.log("PWA_TRANSCRIPT", result.transcript);
      }
      await page.getByRole("button", { name: "AI 解析", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="保存前確認"]') ||
          document.querySelector("[role=alert]"),
        undefined,
        { timeout: 900000 },
      );
      if (await page.getByRole("alert").count())
        throw Error(await page.getByRole("alert").innerText());
      assert.equal((await records(page)).length, before);
      result.draft = {
        title: await page.getByLabel("標題", { exact: true }).inputValue(),
        rawText: await page.getByLabel("內容", { exact: true }).inputValue(),
        time: await page.getByLabel("發生時間（選填）").inputValue(),
      };
      const norm = (t) => t.replace(/[，,。！？、\s]/g, "").toUpperCase();
      result.facts = item.facts.map((f) => ({
        name: f.name,
        pass: f.patterns.some((p) =>
          new RegExp(p, "i").test(norm(result.draft.rawText)),
        ),
      }));
      if (result.transcript)
        result.transcriptFacts = item.facts.map((f) => ({
          name: f.name,
          pass: f.patterns.some((p) =>
            new RegExp(p, "i").test(norm(result.transcript)),
          ),
        }));
      const today = await page.evaluate(() => {
        const d = new Date();
        return [
          d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, "0"),
          String(d.getDate()).padStart(2, "0"),
        ].join("-");
      });
      result.timeCorrect =
        result.draft.time === item.time.replace("TODAY", today);
      result.titleCorrect = !(item.forbiddenTitlePatterns ?? []).some((p) =>
        new RegExp(p).test(result.draft.title),
      );
      await page.screenshot({
        path: root + "/" + id + "-review.png",
        fullPage: true,
      });
      const confirmed = result.draft.rawText + "\n已確認本機保存。";
      await page.getByLabel("內容", { exact: true }).fill(confirmed);
      assert.equal((await records(page)).length, before);
      await page.getByRole("button", { name: "確認保存", exact: true }).click();
      await page.getByText("紀錄已保存。", { exact: true }).waitFor();
      const list = await records(page);
      assert.equal(list.length, before + 1);
      const saved = list.find((r) => r.rawText === confirmed);
      assert.ok(saved);
      assert.equal(saved.title, result.draft.title.trim() || null);
      const expected = result.draft.time
        ? await page.evaluate(
            (t) => new Date(t).toISOString(),
            result.draft.time,
          )
        : null;
      assert.equal(saved.occurredAt, expected);
      await page.reload();
      assert.ok(
        (await records(page)).some(
          (r) => r.uid === saved.uid && r.rawText === confirmed,
        ),
      );
      result.savedCorrectly = true;
      result.semanticPass =
        result.facts.every((f) => f.pass) &&
        result.timeCorrect &&
        result.titleCorrect &&
        (!result.transcriptFacts ||
          result.transcriptFacts.every((f) => f.pass));
      console.log("PWA_MEDIA_RESULT", JSON.stringify(result));
    } catch (e) {
      result.error = e.message;
      console.error("PWA_MEDIA_FAIL", id, e.message);
      await page
        .screenshot({ path: root + "/" + id + "-failure.png", fullPage: true })
        .catch(() => {});
    } finally {
      await context.setOffline(false);
      results.push(result);
      writeFileSync(
        root + "/results.json",
        JSON.stringify({ results, network, failures }, null, 2),
      );
    }
  }
  assert.equal(network.length, 0, "No application API or network writes");
} finally {
  clearInterval(timer);
  current = null;
  try {
    await ui.page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("aftertrace-local", 1);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(["records", "tasks"], "readwrite");
            tx.objectStore("records").clear();
            tx.objectStore("tasks").clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        }),
    );
  } finally {
    await ui.context.close();
  }
  writeFileSync(
    root + "/results.json",
    JSON.stringify(
      { results, network, failures, testDataCleared: true },
      null,
      2,
    ),
  );
}
console.log(
  "PWA_MEDIA_TOTAL",
  JSON.stringify({
    cases: results.length,
    accurate: results.filter((r) => r.semanticPass).length,
    saved: results.filter((r) => r.savedCorrectly).length,
  }),
);
process.exitCode = results.some((r) => r.error || !r.semanticPass) ? 1 : 0;
