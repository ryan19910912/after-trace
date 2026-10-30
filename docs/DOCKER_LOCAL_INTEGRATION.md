# Docker 本機整合測試

此環境只使用本機 Docker PostgreSQL，不載入或修改 `.env.local`、`.env.dev` 或 `.env.prod`。資料庫名稱為 `aftertrace`，Compose 專案名稱為 `aftertrace-local-integration`；不會重設其他容器或資料庫。

## 啟動

```powershell
pnpm integration:db
pnpm integration:configure
# 分別在兩個終端啟動：
pnpm integration:api
pnpm integration:web
# 選用的管理後台：
pnpm integration:admin
```

| 服務 | 位址 |
| --- | --- |
| 前台 | http://localhost:15173 |
| API | http://localhost:18787 |
| 管理後台 | http://localhost:15174 |
| PostgreSQL TCP | 127.0.0.1:55432 |
| Neon 相容 HTTP 代理 | 127.0.0.1:55433/sql |

直接連 PostgreSQL：使用者 `aftertrace`、密碼 `aftertrace_local_test_only`、資料庫 `aftertrace`。這些是僅限本機的測試憑證。

應用程式使用 Neon HTTP driver，因此測試 Worker 的 `DATABASE_URL` 使用代理連接埠 55433；資料庫工具則使用 PostgreSQL 連接埠 55432。只有 loopback 主機會走 HTTP，其他 Neon 主機保留原有 HTTPS 路由。

PostgreSQL 首次啟動會執行 `drizzle/0000_worklog_baseline.sql`，建立 37 張表。資料保存在命名 volume；重啟不會清空。這是獨立的基底初始化環境，不要對已初始化的測試庫重複執行雲端 migration 腳本。

Neon 相容代理來自 [TimoWilhelm/local-neon-http-proxy](https://github.com/TimoWilhelm/local-neon-http-proxy)，已固定 image digest。正式 Neon driver 的 [端點設定文件](https://github.com/neondatabase/serverless/blob/main/CONFIG.md) 說明此 HTTP 連接方式。

## 執行測試

在 API 與 Web 都啟動後，從專案根目錄依序執行：

```powershell
pnpm integration:test:api
pnpm integration:test:browser
pnpm integration:test:audio
pnpm integration:test:prompts:api
pnpm integration:test:prompts:ui
```

- API 測試會新增三個隔離測試帳號與真實測試資料，不開放任何測試登入後門。使用僅供本機測試的 session secret 簽發有效 session。
- Browser 測試使用 Chrome、真正本機 Qwen 模型、實際 API 與 Docker 資料庫，不攔截或模擬 API。
- Audio 測試限 Windows：用離線 System.Speech 合成英文 WAV，交給 Chrome 假麥克風，測試 MediaRecorder → Web Audio → 本機 Whisper → 編輯草稿 → 確認保存。它不會錄取實際麥克風聲音。
- 第一次模型測試需要下載較大的權重；快取、session、截圖及結果都保存在已忽略的 `.test-artifacts/`。
- 瀏覽器測試使用獨立 profile，測試時須有支援 WebGPU 的 Chrome。不同測試不可同時使用同一個 profile。
- 測試涵蓋紀錄 CRUD、版本衝突、修改歷史、私人／群組權限、單次邀請、待辦、舊雲端 AI 封鎖，以及解析不保存／修改確認才保存。
- OAuth 對外登入、對外 Web Push、付款提供者回呼不在本機測試範圍；測試設定中的 OAuth 欄位都是無效的測試佔位值。

管理後台帳號為 `admin`，首次亂數密碼在 `.test-artifacts/admin-bootstrap.json`。可於右上角修改自己的密碼。`ADMIN_PASSWORD_PEPPER` 與 session secret 由 configure 持久保存，不要刪除設定後重新產生 pepper；舊固定測試帳密已失效。一般使用者測試 session 保存在 `.test-artifacts/integration-session.json`，有效 24 小時；重新執行 API 測試會建立新 fixture。

## 停止資料庫

```powershell
docker compose -f compose.integration.yaml down
```

以上保留命名 volume。API 與前端在各自終端以 Ctrl+C 停止。

## AI 提示管理

啟動 API 與 Admin 後開啟 http://localhost:15174/ai?tab=prompts，使用上方初始化管理員帳密。編輯 → 儲存草稿 → 發布生效；前台下一次 AI 操作會確認最新版本，不需要重新建置前台。組裝預覽不會呼叫 AI。歷史版本可展開查看或回復，最多列最近 20 筆，預設收合為 5 筆。

integration:db 會等待 Docker 就緒、只新增本機缺少的提示／管理角色／帳號／模型表及最後使用時間欄位，再執行不覆寫既有編輯的初始設定。新的空資料庫可直接由 canonical baseline 建立。正式 migration 程式也會在建立 schema 後種入缺少的提示；已套用舊 baseline 的遠端資料庫不會因改寫 baseline 自動升級，遠端升級須另行規劃，不得直接重設已有資料的資料庫。本次沒有操作遠端資料庫。

Prompt UI 測試預設走純本地 Web／API；若本次 Cloudflare 預覽仍在運行，可執行 node scripts/integration/prompt-ui-test.mjs --public-preview 驗證公開前台。兩種模式都使用真正的 WebGPU 模型。共用同一 profile 的模型測試須依序執行。

## 後台與介面驗證

node scripts/integration/admin-v2-api-test.mjs、node scripts/integration/admin-v2-ui-test.mjs 與 node scripts/integration/review-functional-test.mjs 驗證權限、模型、帳號、用戶 ID 複製及錯誤重試。API 測試會建立 fixture 管理帳號／角色；測試後只依 fixture 明確識別清理，不清空整個資料庫。

node scripts/integration/audit-routes.mjs review 會檢查 20 個前後台路由的四種寬度。實際模型／麥克風測試和版面檢查分開，結果保存在 .test-artifacts/audit。

## 本輪完整整合回歸

node scripts/integration/continue-integration-test.mjs：建立 105 個停用的隔離測試管理帳號與用戶回饋，驗證跨帳號隔離、游標分頁、稽核、客服反查及觸控手動保存，finally 只清理唯一標記 fixture。node scripts/integration/query-plan-test.mjs 在交易內建立 20 萬筆臨時資料比較索引，最後回滾。這些測試仍需 API、Web、Admin 與 Docker 引擎啟動。

手機 device emulation 使用桌機 Chrome，不代表已驗證真實 Safari／手機 GPU、記憶體與辨識品質。

## 固定建置產物的本地部署（2026-10-29）

本次已將 15173／15174 從 Vite dev 改為正式建置的靜態服務；18787 為打包後 Worker 的本地 workerd。建置 ID：51749ea4f01f3cb0。不會部署到 Cloudflare 遠端。

產物在 .test-artifacts/local-deployment/{web,admin,api}，manifest.json 記錄 SHA-256；wrangler.json 含測試密鑰，不能公開。processes.json 記錄本次背景程序。/__local-build 可確認前後台版本一致。

重新建置：node scripts/integration/local-deployment.mjs build。停止既有相同服務後，分別執行 node scripts/integration/local-deployment.mjs api、web、admin 啟動，網址沿用上表；勿同時啟動同連接埠的 integration:dev 服務。

一般前台登入需要真實 OAuth 設定；本機無效 OAuth 佔位設定不能完成外部登入。需要操作隔離測試用戶時，複製 .test-artifacts/local-deployment/access.json 的 testLoginUrl（僅本機、有效 24 小時），不能公開該 session。管理帳密仍使用原本初始化回條。

新增 node scripts/integration/deployment-cases-test.mjs：25 組固定產物、快取／路由、權限／隔離、雙擊保存、失敗恢復及檔案拒絕案例。node scripts/integration/deployed-ai-tools-test.mjs 經正式 UI 執行真實本地模型，不依賴 /src/ 開發模組。共用模型 profile 的測試須依序執行。

最新繁中與介面驗收見 TRADITIONAL_CHINESE_CONTENT_QUALITY.md。固定建置可用 powershell -NoProfile -ExecutionPolicy Bypass -File scripts/integration/restart-local-deployment.ps1 -Build 重新建置及重啟本專案記錄的背景程序。


## 繁中語音模型更新（2026-10-29）

本機預設語音改用資料庫指定的 Whisper large-v3-turbo，新增 Breeze ASR 25 與 medium 後台選項，加入離線繁體轉換與靜音檢查。13 組保存整合測試全數保存一致；原始語音 2/3 正確，仍有「尾款」同音字問題。比較、資源限制與完整結果見 [瀏覽器繁中語音模型評估](LOCAL_ASR_MODEL_EVALUATION.md)。其他環境的既有模型設定不會被初始化種子覆寫。


## 語音主要與備援模型（2026-10-30）

目前預設 large-v3 優先、turbo 為用戶可選備援，兩者代碼／revision 存資料庫。加入容量估算、保留原錄音切換、裝置偏好與重設、30 秒等待提示，以及取消預載的競爭保護。詳見 [語音備援整合驗證](LOCAL_SPEECH_FALLBACK_VALIDATION.md)。


## 錯誤紀錄管理（2026-10-30）

新增 `/error-logs` 與 errors.read／errors.write 權限，顯示可讀摘要、用戶 ID 及 requestId／eventId，支援查詢與處理狀態。只存白名單 metadata；詳細限制與本地整合測試見 [錯誤紀錄管理實作與驗證](ERROR_LOGGING_IMPLEMENTATION.md)。採 0001_error_logs.sql 新增遷移，保留既有基底與資料；既有角色不自動增加權限。
