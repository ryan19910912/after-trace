# 後續改善與整合驗證

日期：2026-10-29。全部使用本地 Docker PostgreSQL 與 Chrome，未部署遠端、未觸發 GitHub Actions。

## 已完成

1. 客服查閱歷史：選擇用途並按開始查閱；列表、分頁及全文讀取寫入管理帳號、時間、目標與用途。讀取及 audit INSERT 是同一 SQL，稽核不複製正文。缺用途拒絕，權限不足拒絕，作者不符不回傳內容。
2. 用戶回饋進度：送出顯示案件編號；查看自己的內容與狀態，使用游標分頁，手動更新進度。後端明確限制 session user，不傳 admin actor、context 或內部資料；長內容收合。
3. 客服反查：有權限的回饋管理顯示「查看此用戶」，導至已按用戶 ID 篩選的用戶列表；歷史仍要求獨立權限及用途。
4. 管理帳號：搜尋、總數、每頁 10／25／50、上下頁；超過 100 個也可操作。過期回應不覆蓋目前篩選。
5. 查詢索引：worklog_records (author_user_id,id DESC)、worklog_feedback (user_id,id DESC)，已同步 schema、baseline、snapshot，並對既有本地庫非破壞新增。integration:db 重跑會補缺少索引。
6. 手機：iPhone 13／Pixel 7 的 Chrome device emulation，觸控回饋更新及不支援 WebGPU 時的手動編輯、確認、實際寫入 DB 都通過。

## 整合測試

| 測試 | 結果 |
| --- | --- |
| typecheck、lint、402 項單元測試、所有應用建置 | PASS |
| canonical baseline guard 與獨立全新 37 表／種子重跑不覆寫 | PASS |
| 核心 API／DB：CRUD、版本衝突、修改歷史、回收桶、群組邀請、待辦、登入、退休端點 | 12 組 PASS |
| 後台 API：權限即時生效、停用撤銷、改密碼、最高帳號保護及舊憑證拒絕 | 10 組 PASS |
| 後台 UI：角色、權限、帳號、AI 設定、回饋、歷史及手機導覽 | 10 組 PASS |
| 本輪專項 API／UI／DB | 7 組 PASS：105 管理帳號、稽核用途、回饋隔離、進度、反查、分頁、觸控保存 |
| 真實本機模型文字／圖片解析與確認後 DB 保存 | 5 項 PASS，零雲端推論 |
| 短語音 | PASS：假麥克風 → MediaRecorder → Web Audio → 本地 Whisper → 編輯確認 → DB |
| AI 工具 | PASS：文字整理、搜尋、改寫、相關紀錄、區間摘要及待辦建議 |
| 前後台排版／載入檢查 | 20 路由 × 4 寬度 = 80 畫面；0 溢出、0 JS 錯誤、0 HTTP 失敗、0 未標示欄位 |

本輪專項測試建立 105 個停用 fixture 管理帳號、本人回饋及手機測試紀錄，finally 依唯一標記與 ID 清理。後台 API 測試建立的營運／管理測試帳號與角色也已清除；最高帳號 admin、兩個預設角色與原資料保留。基礎 CRUD／模型測試依既有設計保留各自隔離測試用戶與紀錄，沒有清空資料庫。

## 效能證據

在交易內建立 20 萬筆臨時資料，原 author／input_type 索引需額外 Sort；加入 author／id DESC 後使用 Index Only Scan、無 Sort。此次查詢實測約 0.329 ms → 0.057 ms，僅代表這組控制資料／查詢計畫，不能當成整站快六倍的宣稱。實驗只投影 id；實際歷史 API 還讀取內容欄位，可能使用需回表的 Index Scan，不能宣稱所有 API 都是 Index Only Scan。臨時表與測試索引全部回滾，正式索引另外依 canonical 定義加入本地庫。

後台權限仍逐次驗證，不為減少查詢而長時間快取；本人回饋改用游標，避免新增資料造成深 offset 重複／漏列。管理帳號及用戶列表仍保留 offset 與精確總數，規模擴大後應再量測模糊名稱搜尋與計數成本。

## 環境處理與限制

Docker Desktop 曾因兩個零位元殘留 Unix socket 啟動失敗；確認 backend 停止及目錄只有 IPC 後，保留改名執行期目錄，讓 Docker 重建。未操作 factory reset 或刪除資料卷，恢復後沿用原測試資料庫。

device emulation 使用桌機 Chrome，不是實際 iPhone Safari／Android GPU。真實手機記憶體、電池、下載中斷恢復、長時間穩定性與實際繁中圖片／語音品質尚未驗證；目前不能宣稱已完成手機實機驗收。外部 OAuth 與對外推播也未測。

原始證據：.test-artifacts/audit/continue-*、routes-continue.json、admin-v2-api.json、admin-v2-ui.json、integration-api-results.json、integration-browser-results.json、integration-audio-results.json。測試資料夾含 session／本地資訊，請勿整份公開。
