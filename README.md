# AFTERTRACE 本機 PWA

免登入的本機紀錄工具。文字、圖片、短語音在用戶裝置上的 WebGPU 模型解析，核對並修改草稿後才寫入 IndexedDB；不需要 API、資料庫伺服器、Docker、金流或後台。

## 本地啟動

需要 Node.js 22 與 pnpm 10.15.0。

```powershell
cd D:\Project\after-trace
pnpm install --frozen-lockfile
pnpm dev
```

前台 http://localhost:15173。若此埠已有背景服務，先停止該服務再執行 dev，或改用 `pnpm --filter @aftertrace/web dev --port 15175`。

正式建置預覽：

```powershell
pnpm build
pnpm preview
```

只有正式建置會註冊 PWA Service Worker。前台不需要任何 `.env` 或 VITE_API_BASE_URL；既有 `.env.dev/.env.prod` 不會被拿來連線。

## 使用方式

- 紀錄：本機搜尋、編輯、修改歷史、移至已刪除／還原。
- 新增：文字、貼上／上傳 PNG、JPEG、WebP（5 MB），或最長 60 秒語音；人工確認後只保存文字。
- 待辦：本機建立與完成，不做背景推播。
- AI 整理：本機搜尋、摘要、相關紀錄、改寫與待辦建議；改寫／待辦需明確確認。
- 備份：匯出 JSON；匯入先預覽，支援去重、保留本機版本或保留兩份，不清空現有資料。
- 設定：查看／清除模型快取、重設語音備援選擇、申請持久儲存與匯出本機診斷。

資料只在目前網站來源、瀏覽器設定檔及裝置。手機與電腦不自動同步。清除網站資料、改用不同網域、移除瀏覽器設定檔或裝置故障都可能遺失紀錄；請定期匯出並保存到網站之外。PWA 不提供雲端救援。

首次下載模型／推論執行環境需要網路。完成快取後，已驗證可離線解析文字、圖片及繁中語音。裝置仍需支援 WebGPU 且有足夠記憶體／空間；可隨時手動編輯保存。

## 模型與提示詞

設定隨版本發布：`config/local-ai-models.seed.json`、`config/local-ai-prompts.seed.json`。預設 Qwen3.5-0.8B ONNX OPT；語音 large-v3 ONNX 優先、turbo 為用戶明確選用的備援。下載自 Hugging Face／版本固定的 ONNX Runtime CDN，不呼叫雲端 AI。

## 驗證與部署

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/serve.mjs
# 另一個終端：
node scripts/integration/pwa-functional-test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/integration/prepare-pwa-audio.ps1
node scripts/integration/pwa-media-test.mjs
```

整合測試目前以 Windows Chrome／WebGPU 為目標。語音使用 Windows 離線繁中合成音經假麥克風進入真正 MediaRecorder、Web Audio 與 Whisper；不是以固定輸出替代模型。

`pnpm deploy:dev`／`pnpm deploy:prod` 只發布靜態前台 Worker。一般靜態空間亦可部署 apps/web/dist，需將前台路由 fallback 到 index.html。

## 原版留存

原本含登入、後台及雲端資料庫的版本已推送到 [`archive/server-backed-main-2026-10-30`](https://github.com/ryan19910912/after-trace/tree/archive/server-backed-main-2026-10-30)，留存提交 e3d0e12（包含原 main 17574d6 與既有 dev 驗證文件）。

切換前先保存目前修改：`git switch archive/server-backed-main-2026-10-30`，再按該分支 README／文件安裝與部署。舊雲端資料不會自動下載到本機，舊版 SQL／API 匯出不屬於新版備份格式。

詳見 [產品規格](docs/PRODUCT.md)、[技術與備份格式](docs/TECHNICAL.md)、[驗證結果](docs/VALIDATION.md)。
