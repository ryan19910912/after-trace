# 部署與執行基準

更新：2026-10-29。此文件說明部署方式，不代表已部署；本次修改只在本機驗證。

## 拓樸

Web、Admin 及 API 使用 Cloudflare Workers；前端由 Vite 建置，資料庫是 PostgreSQL／Neon，Drizzle ORM。Chrome Extension 獨立建置。Dev／Prod 使用各自設定及資料庫，部署工具指定 after-trace-{api|web|admin}-{dev|prod}。

AI 在用戶瀏覽器 WebGPU Worker 執行。Hugging Face／版本化 runtime CDN 提供靜態模型檔；不需要 AI 供應商密鑰。提示詞、模型 ID／固定 revision 由 API 讀資料庫提供，不能把模型推論搬到後端。

## 必要環境設定

- DATABASE_URL。
- WEB_APP_URL、WEB_APP_ORIGIN、VITE_API_BASE_URL、ADMIN_WEB_ORIGIN；來源必須符合對應環境，Web URL／origin 一致。
- WEB_AUTH_SECRET、ADMIN_SESSION_SECRET、ADMIN_PASSWORD_PEPPER：至少 32 字元，Dev／Prod 分離並安全持久保存。pepper 與既有管理帳號雜湊綁定，不能每次部署重新產生。
- Google／LINE OAuth client／channel 設定；Apple 完整配置後才啟用。
- WEB_PUSH_PUBLIC_KEY、WEB_PUSH_PRIVATE_KEY、WEB_PUSH_SUBJECT：readiness 仍檢查有效推播設定。
- ADMIN_BOOTSTRAP_PASSWORD_FILE 可選擇首次初始化管理帳密回條位置；不是 Worker 執行密鑰。

不再使用 ADMIN_USERNAME／ADMIN_PASSWORD 作正式管理登入，不要求 GEMINI_API_KEY、模型價格／匯率、FREE／付費方案、試用點數或 NewebPay 金鑰。

## 資料庫與初始化

schema-all.ts、drizzle/0000_worklog_baseline.sql、snapshot 需一致；目前 37 張 public 表，每表／欄位有 COMMENT，沒有商業 CHECK 或應用領域 ENUM。

migration 工具套用基線後初始化六個提示、兩個角色、admin 亂數密碼及模型設定；種子重跑不覆寫既有修改。首次帳密寫入受忽略檔案，請安全交付最高帳號持有人。已存在回條時不默默覆蓋。

重要：修改 canonical baseline 不會自動升級已套用的遠端資料庫。既有 schema 需另行規劃非破壞升級，不能直接重跑建表 SQL 或清空資料。除非明確另行授權，不能重置本機／遠端資料庫。

## 健康檢查

- GET /health：Worker 活著。
- GET /health/ready：核心 schema、auth／admin／push 設定可用；不檢查 AI 價格、付費方案或點數。
- readiness 目前主要探測表及欄位，不等同已驗證種子完整、實際 OAuth 或外部推播。部署驗收還須讀取已發布提示／模型及實際管理登入。

API 共用一個每五分鐘 scheduled handler，處理有界公告／待辦／推播；不為每個待辦建立 Cron。推播失敗保留站內通知。

## 本地驗證

依 [Docker 指引](DOCKER_LOCAL_INTEGRATION.md) 啟動，執行 pnpm typecheck、pnpm lint、pnpm test、pnpm build、pnpm db:baseline:guard，再跑與變更相符的 API／Chrome 整合測試。共用模型 profile 的腳本不能同時執行。

本地測試不代表 Google／LINE／Apple 外部 OAuth、對外推播、目標手機 GPU／記憶體及繁中辨識品質已驗收。請逐項記錄 PASS／未驗證及日期。

## 遠端部署

獲明確部署授權後，使用 .env.dev 或 .env.prod 及 pnpm deploy:{dev|prod}[:api|web|admin]。部署腳本會執行 migration 並上傳 Worker，因此不能拿它當唯讀檢查。先確認遠端 schema 升級計畫、備份及環境分離；API 驗證完成後才更新前端。

正式 Worker 對舊 /api/v1/ai/* 回傳 410 LOCAL_AI_ONLY；/api/v1/payments/*、/api/v1/subscription/* 回傳 410 BILLING_RETIRED。沒有金流回呼驗收流程，也不能重新啟用舊 provider 程式。

管理 API 要驗證 session、目前帳號與每頁權限；CORS 精確比對 origin。公開 Cloudflare 本機預覽代理只允許前台 API，封鎖全部管理 API，不能把整個專案資料夾作靜態目錄。管理帳密／.env／測試 session 不得公開。

未明確要求不得啟動、重跑或修改 GitHub Actions。一般開發 commit 帶 [skip ci]；本地修改不自動 commit／push。
