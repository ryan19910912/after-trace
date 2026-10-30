# 瀏覽器繁中語音模型評估（2026-10-29）

## 選擇與實作

目前本機資料庫透過管理 API 更新為 Whisper large-v3-turbo，保留原本 vision 模型。初始化種子也選用 turbo；既有資料庫不會被 seed 蓋掉，其他環境必須從後台自行切換。模型 ID 與固定 revision 仍存於資料庫，後台提供 turbo、Breeze ASR 25、medium、small 等選項。前台不固定預設代碼、不傳媒體至推論服務。

- 預設：onnx-community/whisper-large-v3-turbo @ 360ebcde2559d60bb474678be3c1de9ef347d01a，WebGPU/Q4。
- Breeze 選項：a2d8a4v/Breeze-ASR-25-ONNX @ cb9c36288335cf0b442dde9960d15539435ebc62，WebGPU/Q4。這是社群 ONNX 轉換，並非聯發科直接發布的 ONNX 包。
- medium 選項：onnx-community/whisper-medium-ONNX @ d3978248a6b5de6df7ec29ddfbde3993845fa806。
- 中國簡體字輸出以 opencc-js 1.4.2 的 cn→tw 在瀏覽器轉成繁體。字典隨靜態資源載入；不使用 twp 詞彙替換，不把微款、唯款、人名、復笨照測試答案偷改。
- OpenCC 於語音分支才載入；Vite Worker 使用 ES module，支援分割載入。
- 數位靜音與 NaN/Infinity 在載入語音權重前拒絕，保留低音量錄音。這不是完整 VAD 或降噪。
- 語音仍隨使用載入，錄音上限 60 秒；既有重聽、編輯、確認保存、取消、閒置釋放機制保留。文字／圖片仍使用用戶裝置。

## 一手資料與供應來源

[Breeze ASR 25 模型卡](https://huggingface.co/MediaTek-Research/Breeze-ASR-25)說明其為 Whisper-large-v2 的台灣華語與中英混用微調模型。Breeze ASR 26 主要針對台語，不當成華語的直接升級。官方 Breeze ONNX 的檔案結構與目前 Transformers.js 管線不直接相容，因此另外驗證[社群轉換](https://huggingface.co/a2d8a4v/Breeze-ASR-25-ONNX)。

[Turbo Transformers.js 模型卡](https://huggingface.co/onnx-community/whisper-large-v3-turbo)、[medium ONNX](https://huggingface.co/onnx-community/whisper-medium-ONNX)、[OpenCC JS](https://github.com/nk2028/opencc-js)。下載來自 Hugging Face 固定 commit 的靜態資源；ONNX runtime 來自固定版本 CDN。沒有 Hugging Face Inference、OpenAI 或其他雲端 AI 呼叫。

## 同錄音比較

scripts/integration/asr-model-comparison.mjs 先經真實 MediaRecorder 保存本地錄音 Blob，再將完全相同的 3 段音訊解碼為 16kHz mono，直接呼叫部署的 Worker。未提供正確文字當 decoder 提示。樣本為 Windows 離線 zh-TW 合成語音，不代表真實使用者口音／環境噪音的普遍準確率。

硬體：RTX 5060 Ti 16GB VRAM、32GB 系統記憶體、Windows Chrome。各段 6.18～9.12 秒。時間包含模型初始化，第一段還包含首次下載；後續段為快取下載但重新初始化，並非純推論計時。

| 模型／量化 | S1 尾款 | S2 阿哲／遊戲副本 | S3 會議日期地點 | 首次／後續時間 | 兩個主要權重下載大小 |
| --- | --- | --- | --- | --- | --- |
| small Q4 | 微款（錯） | 阿澤（錯） | 正確 | 4.8s／4.4～4.8s（已快取） | 保留較小下載選項 |
| turbo Q4 | 唯款（錯） | 正確 | 內容正確，原始含簡體 | 33.6s／5.2～5.4s | 約759MB |
| medium Q4 | 違款（錯） | 正確 | 正確 | 29.7s／6.0～6.2s | 約679MB |
| Breeze Q4 | 正確 | 復笨（錯） | 正確 | 60.3s／8.3～8.6s | 約1.22GB |
| Breeze Q4F16 實驗 | 正確 | 復笨（錯） | 正確 | 65.3s／8.5～8.7s | 約979MB |

Q4F16 沒解決此樣本的錯字，正式版未採用該實驗分支。Turbo 以較小下載量與較快速度提供此批 2/3 語意完整結果，故作為折衷預設，並非宣稱它在所有台灣華語都勝過 Breeze。舊 small 為 1/3；簡繁形式差異需與語意誤字分開評分。這些小樣本數字不是 WER/CER 或產品準確率。

權重大小不含 tokenizer/runtime 等資源，也不是 GPU VRAM 或整體記憶體需求。手機、整合顯示晶片尚未實機驗證；大型模型可能下載／初始化失敗，必須允許重試、取消及手動輸入，絕不切換雲端。

## 驗證紀錄

- 全專案 typecheck、lint、409 個單元測試通過（API 296、web 91、admin 22）。新增測試涵蓋離線簡繁、數字／英文保留、不猜同音字、靜音與損壞輸入、安靜語音。
- 正式靜態部署 build dc787f5404984c54；25 個部署整合案例通過，含模型設定 CAS／非法代碼、匿名設定、頁面權限與保存操作。
- asr-safety-test.mjs：真正部署 Worker 的靜音／NaN 拒絕，無模型權重下載；後台選單顯示資料庫當前值與 Breeze，4 項通過。
- 詳細原始結果留於本機 .test-artifacts/asr-research（不提交錄音與登入資訊）。模型前值另有備份，修改經後台授權及審計。

- content-quality-test.mjs asr-upgrade：13 組（文字 6、清晰 PNG 4、繁中錄音 3）。文字／圖片 10/10 內容與時間正確；語音原始事實核對 2/3 正確；總計 12/13 自動語意核對通過。S1「尾款」被辨成「唯款」，測試模擬使用者於確認前修正，不計為 ASR 成功。
- 13/13 保存值均與使用者確認的 title/raw_text/occurred_at 完全相同，確認前沒有寫入；錄音在保存後移除。無雲端推論請求。這不是宣稱 13 組自動解析全部正確。
- 詳細結果：.test-artifacts/audit/content-quality-asr-upgrade.json；每組截圖位於 .test-artifacts/audit/content-quality。

所有「人工修正後保存成功」和「ASR 原始辨識正確」分開計算。尚需後續加入多位真人、不同麥克風／口音／噪音錄音，才適合評估是否改成 Breeze 預設。


英文語音回歸也通過：真實 MediaRecorder → 本機 Whisper → AI 草稿 → 編輯確認 → API／資料庫回查；另核對 login feature 與 tomorrow/test 事實，無雲端推論請求。最終 typecheck、lint、canonical database baseline guard 通過。


下一輪已完成八模型、繁簡文字及台語對照，見 [多語言完整測試](LOCAL_AI_MULTILINGUAL_EVALUATION.md)。本輪新測試使用原始音訊，與前輪 MediaRecorder 錄音不完全相同，請分開閱讀。
