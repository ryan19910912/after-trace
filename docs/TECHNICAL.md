# 技術設計與備份格式

## 發布結構

單一 pnpm workspace：apps/web。React + TypeScript + Vite；Cloudflare 僅提供靜態檔案。移除 apps/api、apps/admin、apps/extension、伺服器資料庫 schema／migration／認證與相關部署腳本。CI 只檢查前端型別、lint、測試與建置。

不讀取 VITE_API_BASE_URL。model-config／prompt-config 直接使用 config/ 內的版本化資料。local-ai-tools 透過本機 WorklogApi adapter 讀取 IndexedDB，adapter 不發 HTTP。診斷僅存 localStorage 的最近 50 個固定代碼事件。

## IndexedDB

資料庫 aftertrace-local，版本 1。records／tasks 各自使用 autoIncrement id，並對 uid 建立唯一索引，updatedAt 建立索引。records 有 title、rawText、occurredAt、status、version、createdAt、updatedAt 與 history；tasks 有 title、body、dueAt、status 及版本／時間。

所有寫入在 readwrite transaction 中完成後才回報成功。修改要求符合目前版本，拒絕跨分頁過期寫入；用戶原草稿保留。BroadcastChannel 通知其他分頁重新讀取。匯入同時對 records／tasks 開一個 transaction，重新計算去重與衝突，不依賴可能過期的預覽結果；出錯會整筆 transaction abort。

## 備份 v1

根物件只有 format="AFTERTRACE_BACKUP"、version=1、exportedAt、records、tasks。portable records／tasks 不包含本機 id，包含 uid 與其餘正式欄位。record.history 為修改前快照，不含媒體。

嚴格拒絕未知欄位、錯誤 UUID、重複 UID、無效時間、錯誤狀態、過長／空白正文、無效歷史版本順序與超過大小／筆數限制的檔案。React 以文字呈現內容，不執行備份中的 HTML。整體使用 canonical 欄位比較，JSON key 排序不同不應產生衝突。

匯入已刪除狀態若與本機現有內容不同也算衝突，預設不覆蓋本機。保留兩份會建立新 UID；透過內容比對防止同一個衝突備份反覆新增副本。

## PWA 與模型快取

Vite 建置時產生含內容版本的 Service Worker precache 清單，涵蓋 index、JS／CSS、模型 Worker、OpenCC chunk、manifest 與圖示。導航 online-first、離線回退 app shell；相同來源靜態資源 cache-first。只清理 aftertrace-app-* 舊 shell，絕不清除 IndexedDB 或模型快取。

模型使用 Transformers.js transformers-cache；ONNX Runtime 的固定 CDN 資源另存 aftertrace-runtime-v1。HF resolve GET 使用 no-referrer、omit credentials，網路錯誤有限重試。函式庫對 main 的 tokenizer 探測以目前模型固定 revision 解析並先讀已下載 cache，避免離線重新載入時發出多餘 metadata 請求。此修正以真實離線文字／圖片／語音測試驗證。

sw.js 更新先等待；使用者選擇更新時才觸發 ACTIVATE_UPDATE、skipWaiting 與頁面重載。草稿離開保護仍會先執行。

## 保留與還原

原版：archive/server-backed-main-2026-10-30，e3d0e12。切回並安裝該分支依賴可恢復伺服器架構。原雲端資料庫並未因原始碼改造而刪除；本機 IndexedDB 與舊雲端資料沒有隱含轉換或合併。不要以新版空白本機紀錄推論舊資料已遺失。

本機啟動只需 pnpm dev；部署只需 apps/web/dist。遠端舊 API／後台的下線與雲端資源清理需明確記錄，不以刪除舊資料庫方式降低成本。
