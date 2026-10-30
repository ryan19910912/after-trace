# 錯誤紀錄管理實作與驗證（2026-10-30）

已新增資料庫摘要、前後台回報與後台 `/error-logs`。推論仍完全使用用戶裝置；診斷 API 不接收圖片、錄音、用戶輸入、任意 message、stack、密碼或 token。

## 資料與追蹤方式

- API 由伺服器產生 requestId，回應標頭 `X-Request-ID` 與錯誤 JSON 共用同一值；忽略客戶端自行提供的 ID。前後台可複製與反查。
- 本機 AI 錯誤使用 eventId，成功回報後才顯示提示。這不是模型呼叫的 requestId；離線／診斷端點不可用時不保證收到事件。
- 每日依來源、功能、固定錯誤碼、路由類別、身分及模型版本聚合；另存每次 eventId/requestId 供舊 ID 反查。只保存固定中文摘要與白名單 metadata。
- 模型代碼及固定 revision 由資料庫設定取得；用戶與管理員身分從驗證 session 推導，不能由事件 payload 指定。
- 每分鐘每個前後台身分最多 30 筆；API 每個身分／匿名路由最多 60 筆。事件去重，併發相同 ID 不重複計數。限流代表紀錄次數不是完整錯誤總量。
- 寫入設 2 秒時限，API 回報使用 waitUntil，不阻塞原本回應；紀錄失敗只留下結構化平台日誌，不遞迴回報。沒有離線佇列。

## 後台操作

可依 requestId/eventId、用戶公開 ID、來源、功能、日期與狀態篩選；每頁 10/25/50 筆。日期採台灣時區。明細列最近 50 筆 ID，更舊 ID 可從列表反查。

狀態：待處理、處理中、已解決、已忽略。修改採版本檢查並留下操作稽核；已解決事件再次發生會重新開啟，忽略事件維持忽略。

`errors.read` 可查詢，`errors.write` 可標記／清理。最高帳號有完整權限；既有角色不自動擴權，請由權限管理設定。新環境的管理者含讀寫權限，營運者含讀取權限。

依最後發生時間保留 30 天，排程與後台均分批每次清理最多 500 組並連帶清理事件 ID；日後查不到已過期 ID 是預期行為。

## 遷移與本地測試

保留 `0000_worklog_baseline.sql`，以 `0001_error_logs.sql` 新增三張表及索引；不重建資料庫。初始化與正式遷移工具皆支援新增遷移。

- `node scripts/integration/error-logs-test.mjs`：真實 Docker PostgreSQL 的去重、限流、狀態、隱私、日期、權限、故障隔離與清理測試。
- `node scripts/integration/error-logs-ui-test.mjs`：瀏覽器故障注入（不是模型準確度測試）、安全 metadata 回報、ID 提示／查詢／複製、狀態、唯讀限制及有資料頁面的桌面與手機排版。
- `node scripts/integration/admin-visual-review-test.mjs`：所有後台頁面與登入頁 4 種寬度，必須成功載入才檢查排版。
- 故障測試使用隔離的本地 18789／18790 測試 Worker，引用正式 diagnostics wrapper；正式 API 沒有故障觸發端點。

本次修正：併發重送的誤判限流、登入後前台未呈現追蹤提示、本地部署缺少新頁面路由，以及舊排版測試可能把 404 當成空白正常頁面。新頁面另補中文功能名稱、載入／空資料提示。

## 最終驗證結果

本地建置 51f4f6b0ca252010。433 項單元測試、typecheck、lint 與新增遷移 guard 通過。錯誤管理 API／真實資料庫 9 組、瀏覽器整合 6 組、原有後台操作 13 組、本地部署回歸 25 組通過；後台含錯誤頁與登入頁共 40 組頁面／尺寸檢查通過。有資料的錯誤列表與明細另測 1440／768／390／320 寬度，並人工檢視截圖。

可重跑：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/integration/run-error-logs-tests.ps1`，需先啟動本地 Docker、API 與前後台。此指令產生私有測試設定、啟動隔離故障 Worker，執行 9+6 組測試後自動停止測試 Worker，保留正常本地部署。結果輸出至 .test-artifacts/errors-integration-results.json 與 .test-artifacts/error-ui/results.json。

## 遠端升級補充

新增 0002_browser_ai_admin_upgrade.sql，支援舊基底資料庫升級本機 AI 提示、模型及管理帳號等資料表；以 IF NOT EXISTS／約束存在檢查避免重建。已在隔離 PostgreSQL 從舊基底升級並重複執行，確認 40 張表與既有測試用戶保留。遷移器會複製全部 SQL 檔，不只基底。dev／prod 初始化 admin 密碼回條分別存於忽略的 .test-artifacts/admin-bootstrap-dev.json／admin-bootstrap-prod.json，與本地回條分開。
