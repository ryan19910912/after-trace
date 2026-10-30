> 歷史驗證紀錄：以下數字與畫面只代表各節當時執行結果，不是現行產品規格。最新產品／技術規格見 WORKLOG_PRODUCT_SPEC.md、WORKLOG_LOCAL_AI_POLICY.md、WORKLOG_ADMIN_POLICY.md；新版後台結果見 ADMIN_MANAGEMENT_VALIDATION.md。舊固定管理帳密、34 張表、舊頁面與訂閱規則均已退役。

# Docker 本機整合測試結果 — 2026-10-28

分支：`codex/local-browser-ai`。

## 實際執行結果

| 驗證 | 結果 |
| --- | --- |
| PostgreSQL 17 Docker，32 張表初始化 | 通過 |
| 真實 Worker → Neon 相容代理 → PostgreSQL | 通過，`/health/ready` 為 200 |
| 12 組資料庫／API 整合情境 | 全部通過 |
| 5 組真實 Chrome／模型／API／資料庫情境 | 全部通過 |
| 短語音完整管線（假麥克風） | 通過 |
| Docker PostgreSQL 重啟／容器重建後資料保留 | 通過，5 筆測試紀錄仍存在 |
| 重啟後 API 自動恢復查詢 | 通過，readiness 200 |
| 完整回歸測試 | API 282、Web 47、Admin 20，共 349 項通過 |
| 型別檢查、lint、四個應用 build | 全部通過 |

API 情境包含：認證與 Origin 限制、帳號及個人空間、紀錄新增／讀取／搜尋／修改／回收桶／還原、版本衝突、修改歷史、私人資料隔離、群組權限及單次邀請、待辦建立／完成／權限隔離、通知查詢、訂閱快照、Admin 登入、舊雲端 AI 及付款新購封鎖。

Browser 測試未模擬 API，使用真正的本機 Qwen 模型。文字與繁中圖片解析完成時，資料庫筆數不變；使用者修改草稿並按確認後才新增。圖片／語音不送往 API；保存請求僅含確認後文字。手機 390px 寬度沒有水平溢出，重新載入後可從首頁讀回已保存紀錄。未觀察到雲端 AI 請求。

Audio 測試以 Windows System.Speech 離線合成英文 WAV，作為 Chrome 假麥克風輸入，經真正 MediaRecorder、Web Audio、Whisper 與 Qwen 模型後確認保存。未使用實際麥克風。真人繁中／台語、噪音及不同手機效能仍需另外驗收。

## 保留的本機環境

- Web：`http://localhost:15173`
- API：`http://localhost:18787`
- PostgreSQL：`127.0.0.1:55432`，資料庫／使用者 `aftertrace`，密碼 `aftertrace_local_test_only`
- HTTP 代理：`127.0.0.1:55433/sql`
- Docker Compose 專案：`aftertrace-local-integration`
- 資料 volume：`aftertrace-local-integration_aftertrace_pgdata`

API 與 Web 啟動程序目前保留。本機登入 URL 可用以下指令取得（測試 session 有效 24 小時）：

```powershell
node scripts/integration/login-url.mjs
```

設定、session、模型快取、截圖與 JSON 結果均在已忽略的 `.test-artifacts/`。未讀取或修改原有 `.env.local`／Dev／Prod 金鑰，不連現有雲端資料庫，未部署、未推送、未觸發 GitHub Actions。

可重跑步驟見 [Docker 本機整合測試](DOCKER_LOCAL_INTEGRATION.md)。測試用 session 是離線 fixture；真正 Google／LINE OAuth、對外推播與付款提供者回呼不在本次測試範圍。
