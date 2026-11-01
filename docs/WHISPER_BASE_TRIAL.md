# Whisper base Q8 試用（2026-11-01）

## 設定

語音主模型改為 onnx-community/whisper-base，固定 revision 1846881b6b3a3024392c1eea3ad983695bc23925，dtype=q8。實際下載 encoder_model_quantized.onnx 與 decoder_model_merged_quantized.onnx；已檢查瀏覽器快取中沒有 base 的 q4 權重。

必要模型與設定快取實測 79,666,434 bytes，約 79.7 MB，不含共用執行環境與 Qwen。容量檢查使用相同量化檔名，已下載完整模型時不因剩餘空間低而重複阻擋。偏好 key 包含 dtype，避免重用舊量化設定。

本次不啟用大型備援，文字／圖片仍為原 Qwen。舊 large-v3／turbo 快取不會自動刪除，紀錄與備份格式不變。

## 真實模型結果

Windows 離線繁中合成音，經 Chrome 假麥克風、MediaRecorder、Web Audio、Whisper base Q8、Qwen 與真實 IndexedDB。沒有模擬模型輸出，也沒有用字串修補辨識結果。

| 案例 | 原始辨識結果 | 評估 |
| --- | --- | --- |
| S1 收款 | 三千五百元 → 350元；尾款 → 微款 | 金額與詞語錯誤，不合格 |
| S2 遊戲 | 阿哲 → Age；副本、未通關及晚上十點保留 | 人名錯誤，不合格 |
| S3 會議 | 11/2 上午9點半、台北辦公室、登入功能測試正確 | 本案例關鍵資訊通過 |
| 離線 S3 | 快取重載、辨識與 AI 草稿正確 | 本案例離線流程通過 |

三種不同語音只有會議案例完整保留檢查事實；離線會議是相同素材重測，不能算成另一種語音準確度。四次流程都能完成確認保存，保存值與最後確認的文字／標題／時間一致，但保存成功不等於原始辨識內容正確。

另對 S1／S2 透過實際輸入框人工改正逐字稿後才點 AI 解析，兩個草稿的事實、日期時間與保存內容都正確。報告保留原本的錯誤逐字稿及 transcriptCorrectedByTester=true，不把這個結果算成語音模型辨識通過。benchmark 的 semanticPass 仍為 false，因此退出碼 1 是刻意指出辨識品質未通過，不是寫入功能故障。

## 結論

base 的下載與離線使用可行，且遠小於 large-v3；但此批繁中素材的人名與金額誤識明顯，僅作輕量試用，不建議據此宣稱可可靠辨識財務／姓名內容。沒有自動切回大模型，也沒有把錯誤文字猜改成預期答案。需保留人工核對流程。

## 驗證與證據

68 項單元測試、型別與 lint 通過，新增固定 base Q8 設定及 Q8 快取檔名的回歸測試。一般本機操作整合測試另執行。

- .test-artifacts/base-benchmark-results.json：三種語音與離線會議原始測試。
- .test-artifacts/base-media.log：原始辨識與草稿。
- .test-artifacts/base-reviewed-media.log：人工修改逐字稿後的整理／保存測試。
- .test-artifacts/base-cache.json：實際 base 下載檔案與大小。

```powershell
# 先 pnpm build 並以靜態服務啟動網站
$env:PWA_MEDIA_CASES='S1,S2,S3,OFFLINE_SPEECH'
node scripts/integration/pwa-media-test.mjs
# 如果要驗證人工核對流程，可設定 PWA_REVIEW_TRANSCRIPT=1；不可視為原始辨識準確度。
```

S1／S2 音檔是既有隔離測試素材，需要 Windows 對應的離線語音。手機尺寸與桌機 GPU 測試不能替代手機實機語音品質與記憶體評估。
