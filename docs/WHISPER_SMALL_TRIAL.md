# Whisper small Q8 與 base 對照（2026-11-01）

## 模型與大小

small：onnx-community/whisper-small，固定 revision 36050c46d777d46dc4b5f43f6d90574fc38f8732，dtype=q8。快取實測 251,848,840 bytes（約 251.8 MB），包含必要設定及 encoder_model_quantized.onnx、decoder_model_merged_quantized.onnx，沒有改下載 q4 權重。

base：同日前一輪固定 revision 1846881b6b3a3024392c1eea3ad983695bc23925，Q8 快取約 79.7 MB。small 約為 base 的 3.2 倍。Qwen 文字／圖片模型沒有改動，不啟用大型語音備援。

試用分支：codex/whisper-small-trial，從 codex/whisper-base-trial 建立；main 沒有合併試用模型。

## 相同語音的實際比較

沿用同一組 S1／S2／S3 WAV、假麥克風與錄音長度，真正執行 MediaRecorder → Web Audio → Whisper → Qwen → IndexedDB。沒有更換語音素材、給模型參考答案或套用誤字修補。原始 WAV SHA256 與兩個模型逐字稿保存在本機對照結果。

| 檢查項目 | 原文 | base Q8 | small Q8 | 結論 |
| --- | --- | --- | --- | --- |
| 收款姓名 | 王先生 | 王先生 | 王先生 | 兩者正確 |
| 金額 | 三千五百元 | 350元 | 3500元 | small 改善且本例正確 |
| 未收尾款 | 尾款還沒有收到 | 微款還沒有收到 | 微款還沒有收到 | 詞語錯誤未改善 |
| 遊戲人名 | 阿哲 | Age | 阿澤 | 兩者都不正確 |
| 遊戲狀態 | 打副本，還沒有通關 | 正確保留 | 正確保留 | 兩者正確 |
| 會議 | 11/2 上午9點半、台北辦公室、登入測試 | 正確 | 正確 | 兩者正確 |

三種不同素材中，兩個模型都只有會議案例完整通過檢查；small 金額改善，但不能把阿澤算成正確人名，也不能把同一個會議的離線重跑算成新的準確度案例。這是少量合成音比較，不是整體字錯率評測。

## 確認保存與離線

- S1、S2、S3 及離線 S3 四次均完成 AI 草稿 → 修改確認 → 保存，保存前沒有紀錄寫入。
- 逐筆比對 IndexedDB 正文、標題、發生時間與最後確認值，保存後重新整理仍一致。
- 原始誤字會留在草稿中，Qwen 不會自動把「微款／阿澤」猜改成參考答案，因此 S1／S2 語意檢查維持不通過。
- 另用實際輸入框人工改正 S1／S2 逐字稿後再 AI 解析，兩次草稿事實、時間與最終保存均正確。報告明確標記 transcriptCorrectedByTester=true，不計為 ASR 準確度通過。
- 離線 S3 使用已下載的 small Q8，辨識、解析、確認保存皆通過。沒有應用 API、雲端推論或媒體上傳。

保存正確是指保存最後確認值，不代表原始辨識文字一定正確；原始基準仍回傳 semanticPass=false 與退出碼 1，以保留真實品質缺陷。

## 結論

此批素材 small 的金額較 base 準，人名沒有通過，「尾款」仍誤識。可作較完整的小模型試用，但不建議在未核對人名／金額時直接採用辨識結果。維持試用分支，不合併 main。

## 測試與證據

68 項單元測試、型別、lint、正式建置通過，另跑本機操作整合回歸。模型試用不改紀錄／備份格式，不清除原先 base 或 large 模型快取。

- .test-artifacts/small-benchmark-results.json：原始三段與離線測試。
- .test-artifacts/base-vs-small.json：逐例對照與 WAV SHA256。
- .test-artifacts/small-reviewed-media.log：人工改正逐字稿後的兩次保存。
- .test-artifacts/small-cache.json：實際模型檔案與大小。

測試使用 Windows 離線中文合成音，桌機 Chrome WebGPU；不能替代真人口音、環境噪音或手機實機表現。可依 README 的測試腳本重跑。
