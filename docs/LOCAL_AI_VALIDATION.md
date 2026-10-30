> 歷史驗證紀錄：以下數字與畫面只代表各節當時執行結果，不是現行產品規格。最新產品／技術規格見 WORKLOG_PRODUCT_SPEC.md、WORKLOG_LOCAL_AI_POLICY.md、WORKLOG_ADMIN_POLICY.md；新版後台結果見 ADMIN_MANAGEMENT_VALIDATION.md。舊固定管理帳密、34 張表、舊頁面與訂閱規則均已退役。

# 本機 AI 改造驗證 — 2026-10-28

> 後續真實 Docker、UI、效能與中文語音稽核結果見 [INTEGRATION_UI_PERFORMANCE_REVIEW.md](INTEGRATION_UI_PERFORMANCE_REVIEW.md)。下列為早期 smoke 紀錄，測試數量與環境範圍以新報告為準。

基底：main / 3baecfab2e4c341a730d3075b1407907e0109c40。

已執行：

- 在 D:\Project\after-trace 最終重跑 TypeScript typecheck、ESLint、全部 347 項測試與四個應用 build：通過。
- API：280 項全數通過；含所有舊 AI 入口與雲端方案新購封鎖測試。
- Web：47 項通過，含保存前確認、編輯後才保存、失敗保留輸入、文件拒絕、本機工具授權與不自動寫入。
- Admin：20 項通過。
- API Worker dry-run、Web、Admin、Extension production build：通過。未部署、未觸發 GitHub Actions。
- 無頭 Chrome：WebGPU adapter 可用；桌機與 390px 手機寬度確認保存流程通過，無水平溢出。
- 真實 Qwen3.5 本機文字推論：輸入「今天完成網站登入功能，明天要測試。」成功產生可編輯 JSON 草稿。
- 真實圖片推論：測試程式在 canvas 畫入繁中「今天完成登入功能／明天進行測試」，本機模型正確抽出文字。
- 真實 Whisper 推論：Windows 本機 System.Speech 產生短英文音檔；明確指定英文後轉出「Today I finished the login feature. Tomorrow I will test it.」。
- 上述模型測試監看未出現遠端推論 POST；外連只下載模型及執行資源。
- 正式 production bundle 的 Worker 也已在 Chrome 完成繁中推論，無遠端推論 POST。

尚未驗證：真人繁中／台語／嘈雜環境語音品質、真實手機 GPU／記憶體、不同瀏覽器、正式登入／資料庫／付款回呼。本機瀏覽器流程使用模擬 API，不代表遠端服務已驗收。既有訂閱未自動取消。

可重跑：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
$env:VITE_API_BASE_URL='http://localhost:8787'
pnpm --filter @aftertrace/web dev --host 127.0.0.1
# 另一個終端，從專案根目錄執行：
node apps/web/scripts/check-webgpu.mjs
node apps/web/scripts/browser-smoke.mjs
```

模型 smoke 另外需要 `.test-artifacts/speech.wav` 短音檔；此目錄及瀏覽器模型快取均已忽略，不提交。可用 Windows System.Speech 離線合成測試音檔。模型測試會下載較大的模型資源。
