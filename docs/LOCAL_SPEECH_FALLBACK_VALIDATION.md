# 語音主要／備援模型與本機整合驗證（2026-10-30）

## 目前行為

本機部署 8092ce9a68f61709 優先使用 Whisper large-v3（onnx-community/whisper-large-v3-ONNX @ 3b6257ad5e67aa523c7c07f4fea04d445eecc4a6），備援為 Whisper large-v3-turbo（onnx-community/whisper-large-v3-turbo @ 360ebcde2559d60bb474678be3c1de9ef347d01a）。主要、備援 ID 與固定 revision 都存於 worklog_local_ai_models，後台 AI 模型設定可分別維護，備援留白可停用。沒有雲端 AI 備援。

進入紀錄頁只預載文字／圖片模型；語音於錄音停止後按需準備。不預先下載兩個語音模型。

- 下載前讀取瀏覽器 quota／usage。已完整快取兩個必要 Q4 權重時，不因剩餘空間較少而拒絕使用。未知估算、估算失敗或 2 秒逾時不武斷阻擋；仍由實際初始化判定。
- 已知模型估算至少留出主要權重大小 × 1.15 + 64 MiB，供其他資源與暫存使用。這是保守估算，不保證成功；目前主要權重約 1.22GB、備援約 759MB。自訂模型未知大小時不虛構下載容量。
- 可用空間不足時，在啟動主要語音推論／權重下載前提示，可自行選擇「改用較輕量模型辨識原錄音」。備援也會做空間檢查。
- 主要模型載入或執行失敗，釋放 Worker／GPU 資源並提供備援按鈕。沒有自動連續下載第二套。取消、數位靜音、無效錄音或 WebGPU 不支援不當成換模型便能解決的錯誤。
- 下載／辨識超過 30 秒時提供取消、切換入口；不會因為時間長自動把模型停掉。
- 用戶選擇備援後，以 localStorage 記住此裝置選擇。主要／備援 ID 或 revision 改變會使舊選擇失效；可按「重設此裝置語音模型選擇」恢復主要優先。不儲存音訊或私人內容到 preference。
- 切換／取消保留本頁的錄音 Blob 與既有文字，不需重錄。失敗後可重新辨識原錄音；兩套都失敗時仍可手動編輯確認保存。保存／移除錄音／離頁時釋放 Blob URL。
- WebGPU 與瀏覽器儲存額度不是 GPU VRAM／實體硬碟的完整規格。低階手機不保證可跑 turbo；不將未實測手機當成已驗證裝置。

## 取消與競爭處理

每次辨識以 AbortController 與頁面 generation 防止過期結果覆蓋。切換前終止既有 Worker；舊的完成／錯誤／finally 不清除新一次工作狀態。語音等待文字／圖片預載時，取消後也不會因預載 Promise 結束而重新啟動原本語音模型。文字預載失敗不強制封鎖另一個語音模型的嘗試。

## 資料庫與後台

新增 nullable speech_fallback_model／speech_fallback_revision 欄位，同步 Drizzle schema、canonical baseline、snapshot、欄位註解。本機 Docker 經 integration/database.mjs 的 ADD COLUMN IF NOT EXISTS 升級，未刪除資料或重設帳號。初始化種子使用 large-v3／turbo；既有部署的模型不會被 seed 覆寫，本次本機設定另透過授權管理 API 寫入並保留審計。

PUT 使用 expectedVersion 原子 CAS；舊客戶端未傳備援欄位會保留現值，明確 null 則停用；自訂備援也做 Whisper 架構／必要權重驗證。公開設定只增加備援 ID、revision 及已知主要權重大小，不含管理員資料。既有環境需先套用新增欄位再更新 API，不應重建或清空資料庫。

## 測試結果

- 全專案 typecheck、lint 通過。單元測試 API 296、admin 22、web 101，共 419 項通過。新增主要／備援、容量、快取、偏好重設、靜音／取消、過期工作及預載競爭測試。
- 核心 Docker／API 12 項通過；部署／權限／輸入／CAS 25 項通過。
- 備援設定 API 與後台 6 項通過：錯誤代碼拒絕、舊 PUT 保留、版本衝突、明確停用、公開容量 metadata、主要／備援下拉選單。
- 實際 Chrome＋MediaRecorder＋Web Audio＋WebGPU＋AI 草稿＋確認保存＋PostgreSQL 回查，7 個情境全部通過。故障、容量與等待使用測試注入，避免刻意耗盡真實記憶體／磁碟；切換後仍跑真正的本機模型。
- 每個情境保存前 record POST 次數 0，確認後 1。資料庫 title/raw_text/occurred_at 與用戶確認相同；保存後錄音移除；非本站媒體上傳／雲端推論請求 0。建立的測試紀錄依明確 ID 清理。
- 另外 4 項 Worker 靜音／損壞錄音與設定檢查通過；36 組 320／390／768／1440px 前後台畫面，無水平溢出、按鈕裁切或低於檢查門檻的字體／控制項。故障後切換按鈕於 320px 高度至少 44px，並人工檢視截圖。
- canonical single database baseline guard 通過。

| 情境 | 結果 |
| --- | --- |
| primary | 通過 |
| failure | 通過 |
| remember | 通過 |
| capacity | 通過 |
| both-fail | 通過 |
| slow | 通過 |
| cancel-preload | 通過 |

本輪實際錄音仍有 large-v3 的「副本→複本」，以及 turbo 偶發同音字誤辨。功能測試僅宣稱切換、保留錄音、確認後保存正確，未宣稱所有原始辨識內容正確。測試有明確模擬用戶修改確認；不把這一步算成 ASR 辨識成功。

重現：scripts/integration/speech-fallback-test.mjs、speech-fallback-settings-test.mjs；搭配現有 Docker、本機部署與測試登入 fixture。執行錄音套件時不要另開同一個 persistent browser profile。詳細 JSON、各情境截圖及 log 位於 .test-artifacts/asr-matrix，均為本機測試產物，不提交密鑰或錄音。
