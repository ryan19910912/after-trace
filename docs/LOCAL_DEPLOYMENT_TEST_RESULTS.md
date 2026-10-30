> 歷史建置驗證；繁中品質與 UI 改版的最新版本與限制見 [繁中品質報告](TRADITIONAL_CHINESE_CONTENT_QUALITY.md)。

# 前次本地部署與多情境驗證

日期：2026-10-29。建置 ID：a034d9b8d155dc91，建置時間（台北）：2026/10/29 19:05:46。使用 codex/local-browser-ai 工作目錄包含未提交修改的目前內容，沒有切換／重設分支、推送、遠端部署或啟動 GitHub Actions。

## 部署

- 前台：http://localhost:15173
- 後台：http://localhost:15174/users
- API：http://localhost:18787，/health/ready 回 200 ready。
- 前後台為編譯後靜態產物，沒有 Vite HMR 或 /src 模組；API 從打包後 worker.js 以本地 workerd 執行。
- 兩端 /__local-build 版本一致，manifest 中每個產物 SHA-256 已重新核對。
- 使用原 Docker PostgreSQL／Neon HTTP 代理；沒有清空資料庫或重置管理密碼。
- 背景 PID／啟動記錄在 .test-artifacts/local-deployment，服務維持運行。重新啟動方法見 DOCKER_LOCAL_INTEGRATION.md。

## 登入

前台一般入口需要有效 OAuth 設定，本地佔位設定不能作外部登入驗收。測試資料用戶的有效登入網址在 .test-artifacts/local-deployment/access.json 的 testLoginUrl，限本機、24 小時有效。後台仍用原 admin 及初始化帳密回條／後續自行修改的密碼；沒有新增固定通用密碼。兩個檔案都不能公開。

## 新增的 25 組部署案例

| 案例 | 結果 |
| --- | --- |
| 01 same frozen build on frontend and admin | PASS |
| 02 HTML references compiled assets, no Vite or source modules | PASS |
| 03 deep-link reload serves app, missing JS is actual 404 | PASS |
| 04 deployment does not expose source, API config or secrets | PASS |
| 05 static method restrictions, HEAD and no-cache app shell | PASS |
| 06 bundled Worker liveness and readiness | PASS |
| 07 cross-origin management denied before data access | PASS |
| 08 malformed and out-of-range pagination rejected | PASS |
| 09 user token cannot access management; bogus token rejected | PASS |
| 10 anonymous prompt/model settings reveal only published configuration | PASS |
| 11 stale model update cannot overwrite newer configuration | PASS |
| 12 malformed model URL rejected without changing settings | PASS |
| 13 history purpose is mandatory and cannot read a different author | PASS |
| 14 feedback cannot be widened by forged userId query | PASS |
| 15 retired AI, documents and billing cannot create records | PASS |
| 16 expired admin browser login is cleared | PASS |
| 17 unsupported WebGPU still permits manual draft and preserves text | PASS |
| 18 rapid double-save produces exactly one persisted edited record | PASS |
| 19 cancelled discard preserves edited draft; confirmed discard writes nothing | PASS |
| 20 failed save preserves draft and can retry successfully | PASS |
| 21 PDF selection rejected locally without uploading or losing input | PASS |
| 22 image larger than 5 MiB rejected before decode or network upload | PASS |
| 23 feedback submit failure preserves text and avoids false receipt | PASS |
| 24 cold admin lazy routes load after direct navigation and refresh | PASS |
| 25 restricted operator cannot gain page access by typing URL | PASS |

失敗恢復案例以瀏覽器攔截一次 503 作故障注入；重試後仍呼叫真正本地 API 與 Docker DB。雙擊保存實測只有一次 POST 與一筆修改後內容。PDF 與超過 5 MiB 的圖片在本機拒絕，沒有 POST 上傳。測試只清理各自唯一標記 fixture。

## 新增的 6 組真實模型 UI 案例

- PASS：compiled UI: real local rewrite produces proposal; cancel leaves original version unchanged
- PASS：compiled UI: real local time-range summary and progress rendered without save
- PASS：compiled UI: related-record lookup completes within current authorised scope
- PASS：compiled UI: natural-language search runs local model and displays result
- PASS：compiled UI: task proposal is editable and cancellation creates no task
- PASS：zero cloud inference, zero source-module imports and no automatic record/task writes

使用正式建置頁面、實際 Qwen／WebGPU，不 import /src、不呼叫雲端推論。搜尋測試先操作 AI 搜尋分頁，摘要核對完成後的持久結果；改寫與待辦測試取消後資料不變。

## 其他回歸

- 402 項單元測試、typecheck、lint、基線 guard：PASS。
- 核心 API／DB 12 組、後台 API 10 組、後台 UI 10 組、本輪專項 7 組：PASS。
- 105 個管理帳號分頁、回饋隔離／進度／反查、歷史稽核、手機觸控保存：PASS。
- 真實文字／圖片確認保存 5 項與短語音錄製 → Whisper → 確認 → DB：PASS。
- 20 個路由 × 四個寬度，共 80 個畫面：無溢出、JS 錯誤、HTTP 失敗或未標示表單。

資料累積後，舊專項案例假設目標回饋一定在第一頁而失敗；改成依處理狀態篩選，並用 combobox 可存取名稱定位下拉控制項後通過。這是測試資料與定位假設修正，沒有為通過測試去刪除既有回饋或放寬權限。

## 範圍限制

手機為桌機 Chrome device emulation，未驗證實體手機 GPU、記憶體、續航及實際繁中辨識品質；外部 OAuth／對外推播／商店擴充安裝未驗收。沒有任何遠端部署。測試報告與截圖在 .test-artifacts/audit；含測試資料或 session 的資料夾不能整包公開。
