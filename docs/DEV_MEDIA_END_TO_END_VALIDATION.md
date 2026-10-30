# Dev 真實本機模型端到端驗證（2026-10-30）

目標：dev 前台／API，以及 dev Neon 資料庫。版本 17574d6。使用新建隔離帳號及有效簽章 session；沒有替換 API、模型輸出或 GPU。Qwen 與 Whisper large-v3 ONNX 均在 Chrome 的 WebGPU 執行。第一次使用全新瀏覽器 profile，實際從 Hugging Face 下載，後續重用此 profile 驗證快取可用。

## 結果

共 7 次流程，全部解析事實／日期時間與確認保存一致：

| 類型 | 內容 | 結果 |
| --- | --- | --- |
| 文字 | 王小明收到林小姐訂金 3500 元、尾款未付 | 姓名、金額、未付狀態與 10/29 15:00 正確 |
| 文字 | 阿哲晚上十點遊戲副本、尚未通關 | 人物、未通關與當日 22:00 正確 |
| 貼上圖片 | 林小姐收款單 | 金額、未付款與日期正確 |
| 貼上圖片 | 阿哲遊戲訊息 | 副本、未通關與 22:00 正確 |
| 上傳圖片 | 專案會議資料 | 王小明、台北、登入測試與 11/2 09:30 正確 |
| 繁中語音冷下載 | 11/2 上午九點半台北辦公室開會 | large-v3 下載、辨識、AI 草稿與保存通過 |
| 繁中語音快取重跑 | 同一會議音檔，修正測試錄音長度 | 逐字稿及草稿日期、時間、地點、議題均正確 |

每次均驗證：解析草稿前與修改草稿後資料庫筆數不變；只有點擊確認保存後新增一筆。逐一比對資料庫 title、raw_text、occurred_at，與最後確認內容完全一致。確認保存前額外加入核對文字，證明保存的是修改後內容。

兩次測試的寫入請求均只往 dev API，沒有 multipart、image/audio 上傳或外部 AI POST；測試用戶、來源、workspace、紀錄、版本與診斷資料於 finally 清理。未修改其他用戶資料。

## 範圍與觀察

語音是 Windows 離線繁中合成音，經 Chrome 假麥克風進入真正 MediaRecorder／Web Audio／Whisper，沒有使用雲端合成或預先注入辨識結果。這不代表已驗證真人口音、嘈雜環境或所有手機硬體。

首輪固定錄音 11 秒讓 Chrome 循環播放短測試音檔，造成逐字稿尾端重複日期；已改依 WAV 長度扣除尾端靜音再錄，重跑不再重複。這是測試音源設定問題，沒有對產品辨識結果做字串修補。

收款文字的一筆標題被既有事實檢查留白，正文與時間正確；留白標題仍需用戶核對後自行填寫，不把防誤判留白算成已產生正確標題。未宣稱模型永遠無誤。本次未發現需修改產品程式的問題。

## 重跑

先備妥 .env.dev 及 Docker 以外的 dev 連線設定。離線產生語音素材：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/integration/prepare-quality-audio.ps1
node scripts/integration/dev-media-test.mjs
# 選測：$env:DEV_MEDIA_CASES='I2,S3'
```

腳本使用 dev 環境建立並清理獨立 fixture，切勿對 prod 執行。結果、截圖、私有 fixture ID、快取位於已忽略的 .test-artifacts/dev-media/；本次合併結果為 final-results.json。
