# 開發規範

更新：2026-10-29。以目前程式與使用者最新決策為準。

## 開始修改前

依工作範圍閱讀產品規格、本機 AI、帳號識別、後台管理、客服、通知、擴充元件、資料模型、紀錄修改及部署規範。退役訂閱／點數文件只是停止使用的契約，不能把舊實作重新接線。

## 產品與技術邊界

- Web／PWA 優先；首頁最近 5 筆可展開 10 筆，搜尋獨立。
- 全部 AI 在瀏覽器 WebGPU Worker 執行，沒有雲端推論／備援。不使用 SpeechRecognition／webkitSpeechRecognition。
- 只接受文字、單張圖片及最多 60 秒主動錄音；不接受 PDF／文件／音訊檔上傳。解析不寫入，用戶編輯確認後才保存文字。
- 提示及模型 ID／固定版本在資料庫，種子只供首次建立；不覆寫管理員編輯。設定讀取失敗保留手動功能，不能啟用硬編碼或雲端備援。
- PRIVATE／GROUP 資料逐次授權，模型輸出不取得任何額外權限；沒有自動歷史回填。
- 管理頁同時以後端權限及前台導覽保護；最高帳號保留全部權限。
- 用戶介面使用清楚繁體中文，不暴露 Source、Grant、ledger 等內部字詞。客服資訊須可讀，不直接放原始 JSON。

## 帳號、非同步與輸入

帳號為 provider-neutral；Google／LINE 優先，Apple 依環境啟用。不得按 email 自動合併。OAuth 回傳的 #session 消費後移除，登出不能重新讀回。

用戶 ID 是穩定不透明客服識別碼，與內部主鍵不同。設定／查詢錯誤不得偽造資料或默默覆寫用戶輸入。非同步讀取要防止過期回應污染目前頁面；切換未保存表單須提示。請求失敗提供明確重試，不能永久顯示載入中。

## 資料庫

canonical 為 drizzle/0000_worklog_baseline.sql；Drizzle schema-all.ts、baseline、snapshot 要一致。每個持久表／欄位有 COMMENT。只保留結構性的 PK／FK／UNIQUE／NOT NULL／INDEX／DEFAULT；不使用應用領域 ENUM 或商業 CHECK，合法狀態與跨欄位條件由 TypeScript 驗證。

使用參數化 SQL，不以未引用保留字（user、group、order、grant 等）作識別符。紀錄及管理設定使用預期版本避免覆蓋新資料，變更要有歷史／稽核。

不能因仍在上線前就自行刪資料或重置資料庫。既有本機資料以非破壞方式補表／欄位；重置及遠端 schema 升級須另行明確授權。改寫基線不會自動升級已套用的遠端資料庫。

## 通知與退役程式

通知為 ANNOUNCEMENT／SYSTEM／TASK；推播失敗不刪站內通知。共用有界排程處理公告／提醒。LINE OA 只作外部客服，不還原機器人、LINE 群組或 Entity／Alias 主資料流程。

正式 Worker 不載入舊 AI 供應商及金流路由。保留的歷史表／測試不能作現行產品能力說明。

## 驗證及交付

執行與變更相符的 typecheck、lint、test、build；資料庫變更執行 db:baseline:guard。重要流程用真實 Docker DB／Chrome 驗證，模型測試 profile 不能同時佔用。外部 OAuth／推播、真實手機及辨識品質須單獨驗收。

報告清楚標記已實測與未驗證，不把舊日期結果當新結果。同步產品技術文件及 WORKLOG_REBUILD_PROGRESS.md。

未經明確要求不得執行、啟動、重新執行或修改 GitHub Actions；一般開發 commit 包含 [skip ci]。本地檢查不代表已部署；未獲授權不得推送或部署遠端。
