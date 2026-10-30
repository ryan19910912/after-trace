# 繁簡文字、國語、台語本機模型對照（2026-10-29）

本輪已測完八種模型：TEA-ASR-1.1-mini、TEA-ASR-1.1、Qwen3-ASR-0.6B、Qwen3-ASR-1.7B、Breeze ASR 25、Breeze ASR 26、Whisper large-v3、Whisper large-v3-turbo。所有推論均在這台電腦，沒有雲端 AI 推論。未改變正式前台模型選擇；本地資料庫仍指定 turbo。

## 測試範圍與限制

- 音訊：每模型相同 9 段，國語 3 段、台語 6 段，共 72 次完成推論。另實際測出 5 個目前瀏覽器管線無法載入的模型，而非把它們的準確率記為 0%。
- 國語為 Windows 離線 zh-TW TTS 三種聲線，涵蓋尾款、金額、人名、遊戲副本、未完成、日期時間。台語來自公開資料集的閱讀／辭典錄音；不是把國語 TTS 當台語。多個台語片段僅 2～4 秒，不能代表長句、口語、噪音或所有腔調。
- 繁簡文字：同一組 6 個情境各測繁體、簡體，共 12 組，用產品現有 Qwen 文字／視覺模型及實際 UI／API／Docker 資料庫驗證。ASR 模型接受音訊，沒有把文字輸入硬塞給 ASR 當辨識測試。
- 瀏覽器：Windows Chrome、Transformers.js 4.3.2、WebGPU/Q4、RTX 5060 Ti 16GB VRAM。TEA／Qwen ASR 另在本機 Python CPU/FP32 執行；Breeze 26 用社群 CTranslate2 CPU/int8 轉換版。原生執行成功不代表瀏覽器已支援，FP32 與 Q4 也不是同精度對照。
- 國語分數使用原先預先定義的事實規則，繁簡字形只在評分時正規化，不依正確答案修同音字。小樣本 3/3 並非一般準確率、更不是 100% WER/CER。
- 台語可能輸出台語漢字或華語譯文。Breeze 26 本來偏向華語漢字表達，不能直接拿它與台語正字逐字 CER 比較。因此保留完整輸出、提供台語原文及資料集華語對照，不製造不公平的總準確率排名。
- 這輪使用原始 WAV／公開音檔，與前次經 MediaRecorder/Opus 的音訊不同，結果差異不能全歸因模型版本。評測 Worker 同模型連續重用，後續延遲也不等同正式產品每次重建管線的時間。CPU、GPU 與下載並行，時間僅留作診斷，未用跨引擎速度排名。

## 國語事實核對

| 模型 | Runtime | 國語關鍵資訊通過 | 完成音訊數 |
| --- | --- | --- | --- |
| onnx-community/whisper-large-v3-turbo | browser-webgpu-q4 | 2/3 | 9 |
| a2d8a4v/Breeze-ASR-25-ONNX | browser-webgpu-q4 | 1/3 | 9 |
| onnx-community/whisper-large-v3-ONNX | browser-webgpu-q4 | 3/3 | 9 |
| JacobLinCool/TEA-ASR-1.1-mini | native-python-cpu-fp32 | 3/3 | 9 |
| JacobLinCool/TEA-ASR-1.1 | native-python-cpu-fp32 | 3/3 | 9 |
| Qwen/Qwen3-ASR-0.6B | native-python-cpu-fp32 | 3/3 | 9 |
| Qwen/Qwen3-ASR-1.7B | native-python-cpu-fp32 | 3/3 | 9 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 | native-ctranslate2-cpu-int8 | 2/3 | 9 |

Breeze 25 本輪 S2 把副本辨成富邦；S3 輸出「上午 9.5」，不符合可直接填入 09:30 的明確時間格式，故嚴格核對未通過。Turbo 仍有尾款→唯款。Whisper large-v3、TEA 與 Qwen ASR 四款在本輪三組國語皆通過。

## 瀏覽器相容性：實際載入結果

- TEA 兩款與 Qwen ASR 兩款：現有 runtime 回報 Unsupported model type qwen3_asr for task automatic-speech-recognition。不是改後台模型 ID 就能運行。
- Breeze 26 原始 checkpoint：缺少目前管線期待的 tokenizer.json，載入失敗。另查到的 weemed ONNX 是自訂 encoder/decoder int8 檔名，也非現有 Transformers.js 管線可直接替換的包，未聲稱已瀏覽器推論。
- Breeze 26 補充辨識測試使用 WizardForest/faster-whisper-Breeze-ASR-26-int8 @ 5e78fb5aa2ae2bd80cd016949735dedcd050d66e。它是社群轉換，不能將結果視為官方原始 FP32 權重的完全等價認證。
- 三個 Whisper 架構 ONNX 模型完成瀏覽器 27 次推論；紀錄的非 GET/HEAD 網路請求為 0，沒有送出音訊或辨識內容。Python 使用本地檔案及下載至本機的模型權重；沒有架設或呼叫產品後端推論服務。

## 繁簡文字端到端

12/12 原始解析的事實與時間核對通過，12/12 保存的 title/raw_text/occurred_at 與確認畫面一致，無人工更正。涵蓋訂金尾款、遊戲未通關、未付款／未寄合約、訂單數量總額、待討論的多日期、更正金額。

**簡體輸入常保留簡體內容。** 因此這表示能理解與保存兩種文字，不表示已自動把所有文字整理成繁體。現有離線繁體轉換套用於語音輸出；本輪未將它擴充到所有文字／圖片內容。原始字形仍記於截圖與 JSON。

第一輪有一筆「2 个」因只比對「2 個」誤判；評分程式改以離線 OpenCC 做字形正規化後重跑 12 組，全部通過。沒有改產品輸出來迎合測試。前後結果保留於本地 artifact。

## 台語觀察與建議

Breeze 26 在 E1「紅嬰仔哭甲一身軀汗」輸出「嬰兒哭得滿身大汗」，E8 輸出「母親一離世 孩子就大聲哭」，E12 輸出「我一輩子不曾做過 對不起別人的事」，這三句主要意思完整。Turbo、large-v3 和 TEA mini 在 E1／E8 等片段存在顯著誤辨。Breeze 26 的 H1 也未可靠辨對，不能宣稱台語全部正確。TEA 完整版能保留部分台語漢字，但仍有詞句誤差。

若維持純瀏覽器，Whisper large-v3 是本輪值得進一步做產品整合的國語候選（Q4 主要權重約 1.22GB），不是直接將未支援的 TEA／Breeze 26 放進預設選項。若要台語，Breeze 26 值得另做 WebGPU/WASM 適配及語言選擇，再補不同腔調真人樣本；不得用伺服器推論冒充用戶算力。TEA mini 是較小型的繁體國語候選，仍要做模型轉換與瀏覽器算子相容性驗證。

## 樣本來源與重現

固定模型 revision 見 config/local-ai-asr-evaluation-models.json；音檔來源、資料列與 SHA256 見 config/local-ai-multilingual-cases.json。三段國語檔沿用 prepare-quality-audio.ps1 產物；台語取自 [數產署 Taiwan Tongues 測試集](https://huggingface.co/datasets/adi-gov-tw/Taiwan-Tongues-ASR-CE-dataset-hokkien) 的 test 0/1/2，及 [教育部辭典例句鏡像](https://huggingface.co/datasets/sarahwei/Taiwanese-Minnan-Example-Sentences) 的 train 1/8/12。鏡像內容依資料集標註使用，未將它當獨立大規模盲測集。

- S3：十一月二日上午九點半，在台北辦公室開會，討論登入功能測試。
- S2：晚上十點和阿哲打遊戲副本，還沒有通關。
- S1：今天下午三點，王先生收到款項三千五百元，尾款還沒有收到。
- H0：我沒咧驚
- H1：無一下著
- H2：烏白試
- E1：紅嬰仔哭甲一身軀汗。（華語對照：小嬰兒哭得滿身大汗。）
- E8：老母一下死，囡仔就大聲吼。（華語對照：媽媽一死，小孩子就大聲的哭。）
- E12：我一世人毋捌做過對不起別人的代誌。（華語對照：我一輩子不曾做過對不起他人的事。）

模型一手資料：[TEA](https://huggingface.co/JacobLinCool/TEA-ASR-1.1)、[Qwen3-ASR](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)、[Breeze 25](https://huggingface.co/MediaTek-Research/Breeze-ASR-25)、[Breeze 26](https://huggingface.co/MediaTek-Research/Breeze-ASR-26)、[Whisper large-v3 ONNX](https://huggingface.co/onnx-community/whisper-large-v3-ONNX)。

測試程式：asr-browser-matrix.mjs、asr-native-matrix.py、asr-breeze26-matrix.py、asr-score-matrix.mjs、content-quality-test.mjs。瀏覽器 harness 原始碼在 scripts/integration/asr-harness；以 Vite 建置至 .test-artifacts/asr-matrix/browser-dist 後由測試在 127.0.0.1:15175 暫時提供，結束關閉。並未取代前台 15173 或增加正式產品服務。

本輪 Python 隔離環境與模型快取在 .test-artifacts/asr-python 及 .test-artifacts/asr-matrix/hf-cache；瀏覽器快取在 .test-artifacts/asr-benchmark-cache。沒有修改全域 Python 環境。相關依賴版本清單留在 .test-artifacts/asr-matrix/native-requirements.txt，含 qwen-asr 0.0.6、Transformers 4.57.6、Torch 2.15.0+cpu。音檔、權重、登入資料不提交。

實際整合測試明細在 .test-artifacts/audit/content-quality-multilingual-text-normalized.json，計數為 12；原始模型逐句輸出在 .test-artifacts/asr-matrix/scored.json。沒有因本輪測試變更正式模型、提示詞或資料庫 schema。

## 全部逐句原始結果

| 模型／Runtime | 樣本 | 原始輸出 | 繁體形式（僅字形轉換） |
| --- | --- | --- | --- |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | S3 | 11月2日上午9点半在台北办公室开会讨论登入功能测试 | 11月2日上午9點半在臺北辦公室開會討論登入功能測試 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | S2 | 晚上10点和阿哲打游戏副本还没有通关 | 晚上10點和阿哲打遊戲副本還沒有通關 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | S1 | 今天下午三点,王先生收到款项3500元,唯款还没有收到。 | 今天下午三點,王先生收到款項3500元,唯款還沒有收到。 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | H0 | 我可以去 | 我可以去 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | H1 | 某一大业 | 某一大業 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | H2 | 欧北七 | 歐北七 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | E1 | 紅蝦靠到一千苦冠 | 紅蝦靠到一千苦冠 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | E8 | 老布尺寺 金娜 特朗生号 | 老布尺寺 金娜 特朗生號 |
| onnx-community/whisper-large-v3-turbo / browser-webgpu-q4 | E12 | 我一世人,不必做過最不去別人的事 | 我一世人,不必做過最不去別人的事 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | S3 | 11 月 2 日上午 9.5 在台北辦公室開會討論登入功能測試 | 11 月 2 日上午 9.5 在臺北辦公室開會討論登入功能測試 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | S2 | 晚上 10 點和阿哲打遊戲富邦還沒有通關 | 晚上 10 點和阿哲打遊戲富邦還沒有通關 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | S1 | 今天下午 3 點 王先生收到款項 3,500 元 尾款還沒有收到 | 今天下午 3 點 王先生收到款項 3,500 元 尾款還沒有收到 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | H0 | 我阿婆得見 | 我阿婆得見 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | H1 | 冇一袋掉 | 冇一袋掉 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | H2 | 歐北氣 | 歐北氣 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | E1 | 紅蝦 扣 到 1000 塊 | 紅蝦 扣 到 1000 塊 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | E8 | 老母一個死 孩子就大聲吼 | 老母一個死 孩子就大聲吼 |
| a2d8a4v/Breeze-ASR-25-ONNX / browser-webgpu-q4 | E12 | 我一輩子沒做過對不起別人的事情 | 我一輩子沒做過對不起別人的事情 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | S3 | 11月2日上午9點半在台北辦公室開會討論登入功能測試 | 11月2日上午9點半在臺北辦公室開會討論登入功能測試 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | S2 | 晚上10点和阿哲打游戏副本还没有通关 | 晚上10點和阿哲打遊戲副本還沒有通關 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | S1 | 今天下午3点王先生收到款项3500元尾款还没有收到 | 今天下午3點王先生收到款項3500元尾款還沒有收到 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | H0 | 我來寫 | 我來寫 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | H1 | 某一大丢 | 某一大丟 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | H2 | 欧北七 | 歐北七 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | E1 | 昂威厚到一千塊塊 | 昂威厚到一千塊塊 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | E8 | 老布一类戏,Gina的大声号 | 老布一類戲,Gina的大聲號 |
| onnx-community/whisper-large-v3-ONNX / browser-webgpu-q4 | E12 | 我只是人 不做過對不起別人的事 | 我只是人 不做過對不起別人的事 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | S3 | 十一月二日上午九點半在臺北辦公室開會討論登入功能測試。 | 十一月二日上午九點半在臺北辦公室開會討論登入功能測試。 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | S2 | 晚上十點和阿哲打遊戲副本，還沒有通關 | 晚上十點和阿哲打遊戲副本，還沒有通關 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | S1 | 今天下午三點王先生收到款項三千五百元，尾款還沒有收到。 | 今天下午三點王先生收到款項三千五百元，尾款還沒有收到。 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | H0 | 我無咧驚 | 我無咧驚 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | H1 | 無一個對 | 無一個對 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | H2 | 歐北氣 | 歐北氣 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | E1 | onaya靠家己先苦瓜 | onaya靠家己先苦瓜 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | E8 | 老木吉列是 gina 的短編號 | 老木吉列是 gina 的短編號 |
| JacobLinCool/TEA-ASR-1.1-mini / native-python-cpu-fp32 | E12 | 我只系人，唔捌這貴對不起別人嘅代志 | 我只系人，唔捌這貴對不起別人嘅代志 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | S3 | 十一月二日上午九點半在臺北辦公室開會，討論登入功能測試。 | 十一月二日上午九點半在臺北辦公室開會，討論登入功能測試。 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | S2 | 晚上十點和阿哲打遊戲副本，還沒有通關。 | 晚上十點和阿哲打遊戲副本，還沒有通關。 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | S1 | 今天下午三點王先生收到款項三千五百元，尾款還沒有收到 | 今天下午三點王先生收到款項三千五百元，尾款還沒有收到 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | H0 | 我無咧驚 | 我無咧驚 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | H1 | 無一個對 | 無一個對 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | H2 | 歐北市 | 歐北市 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | E1 | 紅蟳啊烤加一仙箍幹 | 紅蟳啊烤加一仙箍幹 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | E8 | 老母一日死，囡仔就大聲號。 | 老母一日死，囡仔就大聲號。 |
| JacobLinCool/TEA-ASR-1.1 / native-python-cpu-fp32 | E12 | 我一世人毋捌做過對不起別人個代志。 | 我一世人毋捌做過對不起別人個代志。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | S3 | 十一月二日上午九点半，在台北办公室开会讨论登入功能测试。 | 十一月二日上午九點半，在臺北辦公室開會討論登入功能測試。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | S2 | 晚上十点和阿哲打游戏副本，还没有通关。 | 晚上十點和阿哲打遊戲副本，還沒有通關。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | S1 | 今天下午三点，王先生收到款项三千五百元，尾款还没有收到。 | 今天下午三點，王先生收到款項三千五百元，尾款還沒有收到。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | H0 | 我無咧驚。 | 我無咧驚。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | H1 | 無一個對。 | 無一個對。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | H2 | 歐北氣。 | 歐北氣。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | E1 | 昂哎呀！靠家几仙苦瓜。 | 昂哎呀！靠家幾仙苦瓜。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | E8 | 老木这里是囡囡的短信号。 | 老木這裡是囡囡的短信號。 |
| Qwen/Qwen3-ASR-0.6B / native-python-cpu-fp32 | E12 | 我只系人，唔捌做鬼，对不起别人嘅代志。 | 我只系人，唔捌做鬼，對不起別人嘅代志。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | S3 | 十一月二日上午九点半，在台北办公室开会，讨论登入功能测试。 | 十一月二日上午九點半，在臺北辦公室開會，討論登入功能測試。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | S2 | 晚上十点和阿哲打游戏副本，还没有通关。 | 晚上十點和阿哲打遊戲副本，還沒有通關。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | S1 | 今天下午三点，王先生收到款项三千五百元，尾款还没有收到。 | 今天下午三點，王先生收到款項三千五百元，尾款還沒有收到。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | H0 | 我無咧驚。 | 我無咧驚。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | H1 | 無一個對。 | 無一個對。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | H2 | 烏北市。 | 烏北市。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | E1 | 红叶啊，靠加一扇枯干。 | 紅葉啊，靠加一扇枯乾。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | E8 | 老母一日死，囡仔着大声哭。 | 老母一日死，囡仔著大聲哭。 |
| Qwen/Qwen3-ASR-1.7B / native-python-cpu-fp32 | E12 | 我一世人毋捌做过对不起别人个代志。 | 我一世人毋捌做過對不起別人個代志。 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | S3 | 11月2日上午9點半 在台北辦公室開會 討論登入功能測試 | 11月2日上午9點半 在臺北辦公室開會 討論登入功能測試 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | S2 | 晚上十點和阿哲打遊戲富笨 還沒有通關 | 晚上十點和阿哲打遊戲富笨 還沒有通關 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | S1 | 今天下午三點 王先生收到款項三千五百元 尾款還沒有收到 | 今天下午三點 王先生收到款項三千五百元 尾款還沒有收到 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | H0 | 我沒在怕 | 我沒在怕 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | H1 | 沒有一個對 | 沒有一個對 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | H2 | 亂試 | 亂試 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | E1 | 嬰兒哭得滿身大汗 | 嬰兒哭得滿身大汗 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | E8 | 母親一離世 孩子就大聲哭 | 母親一離世 孩子就大聲哭 |
| WizardForest/faster-whisper-Breeze-ASR-26-int8 / native-ctranslate2-cpu-int8 | E12 | 我一輩子不曾做過 對不起別人的事 | 我一輩子不曾做過 對不起別人的事 |
