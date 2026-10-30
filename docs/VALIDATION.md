# 本機 PWA 驗證結果（2026-10-30）

## 留存版本

原伺服器版已推送至 archive/server-backed-main-2026-10-30，e3d0e12，包含原 main 17574d6 與既有 dev 媒體驗證文件。這次沒有刪除原雲端資料庫，沒有把舊雲端紀錄當成本機資料自動搬移。

## 已通過

- 66 項前端單元測試：解析輸入／輸出、日期、語音安全、備援、模型下載／快取、備份格式與本機 AI 工具。型別、lint、正式建置通過。
- 13 組真實 IndexedDB／CacheStorage 瀏覽器操作：免登入、確認前不保存、修改後保存、重新整理保留、歷史／刪除還原、待辦、真實 JSON 下載、新裝置預覽與匯入、重複去重、衝突保留兩份及重複匯入不增副本、損壞檔拒收、跨分頁過期修改保護、清模型快取保留資料、離線重新開啟與備份、零 API／網路寫入。
- UI 覆蓋紀錄／新增／待辦／備份／AI 整理／設定共 6 頁，1440／768／390／320 共 24 個頁面尺寸；沒有水平溢出，控制項至少 16px，人工檢查手機版備份與編輯視窗截圖。
- 8 組真實 WebGPU 模型端到端：線上文字 2、圖片 2（貼上與上傳）、繁中語音 1，及離線文字／圖片／語音各 1。每筆逐項檢查人物、金額、否定狀態、日期時間；確認前及修改草稿後 IndexedDB 筆數不變，確認後新增一筆，正文、標題、時間與確認值一致，重整後仍存在。
- 媒體測試使用獨立持久瀏覽器 profile，最初實際冷下載模型；暖快取及離線重跑皆使用實際模型，不替換 AI 輸出。完成後只清理該測試 profile 內的合成紀錄與待辦。

## 修正的問題

1. 編輯視窗預填 textarea 的包裹 label 會包含初始內容，補明確 aria-label 與 dialog 名稱。
2. Transformers.js tokenizer 存在性探測即使指定固定模型版本仍查 main，導致離線重載失敗。將探測對應到固定版本快取，已以離線三種輸入重驗。
3. 匯入衝突保留兩份時，避免重複匯入同檔案不斷建立相同副本。
4. PWA shell 建立版本化完整 precache，另外快取固定版本 ONNX Runtime，清快取與紀錄隔離；加入明確更新提示及未保存內容保護。
5. 本機保存／匯入的寫入完成以 transaction complete 為準；跨分頁過期版本拒絕覆寫並保留草稿。

## 測試限制

繁中語音為 Windows 離線合成音經假麥克風進入真正 MediaRecorder／Web Audio／Whisper large-v3 ONNX，不代表已測所有真人口音、噪音及手機 GPU。手機尺寸測試為桌機 Chrome viewport，不是實機 Safari 驗證。

收款案例曾因原有標題事實檢查留白，正文與時間正確；留白標題仍需用戶自行核對填寫，沒有宣稱模型永遠產生正確標題。

離線 AI 必須先完整下載該模型與執行環境；清除快取或改用未下載的模型時仍需連網。網站資料可能被瀏覽器／用戶清除，持久儲存申請不能取代外部備份。

## 重跑與證據

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/serve.mjs
# 另一個終端
node scripts/integration/pwa-functional-test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/integration/prepare-pwa-audio.ps1
node scripts/integration/pwa-media-test.mjs
```

結果：.test-artifacts/pwa/functional-results.json、.test-artifacts/pwa-media/results.json，截圖及瀏覽器模型快取位於相同目錄，均不提交 Git。媒體測試結果 network=[]、failures=[]；沒有應用程式 API、雲端推論或媒體上傳。
