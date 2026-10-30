> 歷史驗證紀錄：以下數字與畫面只代表各節當時執行結果，不是現行產品規格。最新產品／技術規格見 WORKLOG_PRODUCT_SPEC.md、WORKLOG_LOCAL_AI_POLICY.md、WORKLOG_ADMIN_POLICY.md；新版後台結果見 ADMIN_MANAGEMENT_VALIDATION.md。舊固定管理帳密、34 張表、舊頁面與訂閱規則均已退役。

# 本機整合、UI 與效能審查（2026-10-28）


> **最新：資料庫 Prompt 與後台改善已完成。** 390 項測試（API 290／Web 80／Admin 20）、typecheck、lint、四個應用 build 與 baseline guard 通過。以下第一、二輪數字保留作歷史基準；目前操作與驗證結果如下。

## 資料庫 Prompt 與後台審查結果

### 已完成

- 六種提示改為資料庫已發布設定，後台新增「AI 提示管理」：編輯、必要變數及 JSON 欄位驗證、組裝預覽、儲存草稿、發布、歷史內容按需讀取、版本回復。初始模板只保留在 seed JSON，前台沒有內建模板備援。
- 草稿不影響前台，發布才生效。更新與歷史寫入採單一 SQL、expectedVersion 競爭控制；兩個同時編輯只成功一個，另一個 409 並保留畫面文字。
- 前台同頁即可於下一次解析取得新設定，已用真正 WebGPU 模型驗證固定測試標題生效。變數只替換一次，不重新解讀使用者文字中的模板標記。輸入沒有傳到設定 API，也沒有雲端 AI 推論。
- ETag／304 減少未變動設定的傳輸，同時合併進行中的設定讀取；同次摘要鎖定設定快照。注意 ETag 並未消除重新確認版本的資料庫查詢。
- 後台頁面按需載入；首頁主 JS 241.16 KB → 210.53 KB（約減少 12.7%），gzip 73.57 KB → 66.07 KB。首次開啟個別頁面仍需載入該頁 chunk，不把減少首頁大小宣稱為所有操作加速。
- 統一 API 的登入失效通知，未登入直接開管理頁會先登入並返回原頁；失效 session 不再留在半失效畫面。
- 帳號精確查詢使用正規化的大寫 ID 比對，避免在索引欄位上套 upper；先限制匹配帳號，再用一次聚合計算各類紀錄數，取代四次重複掃描；顯示有效紀錄數。UI 移除過時方案／訂閱狀態，改顯示本機 AI 執行方式。
- 回饋每頁 30 筆，以一筆 lookahead 判斷下一頁，不額外 count 全表；篩選重設頁碼、拒絕無效參數，舊回應不覆蓋新結果。修正原本載入 200 筆與篩選競態。
- 管理頁保留統一深色風格，桌機編輯／預覽雙欄，手機單欄；必要變數、字數、輸出長度、草稿與發布狀態明確顯示。歷史預設只顯示最近 5 筆，可展開至 20 筆，完整內容按需讀取。
- 畫面與 SQL 實測另抓到並修正版本 ID 文字排序，以及帳號聚合 JOIN 的修改錯誤；最終再跑實際 API 通過。

### 最新整合證據

- prompt-api.json：管理員／一般帳號／跨來源邊界、格式與長度限制、草稿隔離、發布後 ETag 更新、競爭更新、回復與回饋分頁；另驗證歷史 ID 數字排序及列表不攜帶完整模板。
- prompt-ui.json：真實後台編輯／發布、同一 Cloudflare 前台頁面以真實本機模型使用新標題、不自行保存、歷史回復、衝突保留文字、登入導回原頁與過期登入處理。
- admin-workflows.json：41 筆合成回饋的真實分頁無重複、篩選重設頁碼、延遲舊篩選回應不覆蓋新篩選，以及小寫帳號 ID 查詢。合成回饋於 finally 清理，不刪其他資料。
- routes-prompts.json：12 個前台與 8 個後台路由，在 1440／768／390／320px 共 80 組檢查通過，無文件水平溢出、頁面 JS 例外、HTTP 4xx/5xx API 或未命名欄位。幾何檢查使用無 WebGPU 的手動模式，避免每頁重複下載；實際 GPU 由上述模型專項驗證。
- prompt-baseline.json：全新隔離 PostgreSQL 資料庫能套用唯一 baseline，34 張表、6 組提示及 6 筆初始歷史；重複 seed 不覆蓋人工編輯。測試後移除該專用臨時資料庫，原本資料庫保留。
- ai-tools.json、integration-browser-results.json、integration-audio-results.json：接入資料庫提示後，搜尋、改寫、相關、摘要、待辦、文字／圖片確認保存及英文麥克風流程均再次通過。
- 完整檢查紀錄：.test-artifacts/audit/prompts-final-*.log；最終後台畫面：admin-prompts-desktop.png、admin-prompts-mobile.png。其餘原始結果亦在 .test-artifacts/audit/。

### 使用與剩餘範圍

本機後台：http://localhost:15174/ai-prompts。本機帳密與操作見 DOCKER_LOCAL_INTEGRATION.md。公開前台會讀同一個本機資料庫的已發布設定；公開代理仍不提供管理後台存取。

仍未驗收真實手機 GPU、完整螢幕閱讀器／對比度、正式 OAuth／外部推播與遠端資料庫升級。大量回饋深頁目前仍使用 bounded OFFSET；若量增加應量測後改 keyset。歷史方案／用量頁與舊雲端程式仍只作歷史相容，不會執行金流或雲端 AI。沒有推送、部署遠端服務或執行 GitHub Actions。

> **最新預載調整：** 記錄頁完成範圍授權即背景準備文字／圖片模型，支援暫停，解析共用同一份準備工作；語音按需載入。381 項測試（API 284／Web 77／Admin 20）、typecheck、lint 與預覽正式建置通過。以沒有快取的新瀏覽器從 Cloudflare 網址驗證：未按 AI 已下載模型，只有一個預載命令、無自動推論／保存、無 Whisper 下載、無雲端推論請求；遊戲副本與檔案副本實際推論分別保留原情境。證據 .test-artifacts/preview/preload-verification.json。

> **最新介面調整：** 使用者要求移除原文對照與文字差異兩區，已完成。明確日期／時刻改由本機規則帶入可修改的發生時間；時刻未附日期時以裝置今天為準並提示，歧義則留白。已經原 Cloudflare HTTPS 網址以真實 AI 驗證「晚上十點」帶入 22:00，修改為 2026-10-29 21:30 後確認保存，PostgreSQL 儲存為 UTC 13:30，手機無水平溢出。證據 .test-artifacts/preview/time-verification.json；typecheck、lint、全部測試通過。

> **第二輪優化已完成。** 下方第一輪資料保留作歷史基準；目前測試為 358 項，訂閱／金流與付款回呼均停用。最新結果如下。

## 第二輪優化與驗證

- 摘要保留且仍只由使用者主動按鈕觸發。每段最多 320 tokens，提示最多 5 點，顯示段落進度、逐段呈現；取消停止後續處理並保留已完成部分。搜尋／相關 ID／待辦依用途縮減輸出上限。
- 站內導航改為不整頁重新載入，閒置模型可跨頁重用；進行中的工作於離頁取消。未保存內容離頁提醒；上一頁／下一頁可用。閒置 5 分鐘釋放 Worker，登出仍完整刷新。
- 草稿可直接對照原文與原圖，文字比較標示不同區段（以共同前後綴切分，並非逐字最小編輯距離）；進入確認區會將鍵盤焦點移至標題。保留明確確認保存。
- 首頁先顯示最近 5 筆，可展開到 10 筆，長文字收合；首次模型需求說明收合但可隨時查看。
- 「方案」改成「本機 AI」；顯示模型資源快取數、本站儲存用量／可用空間估計，可單獨清除模型快取。首次下載前提示數百 MB 至數 GB；尚未提供逐模型精確大小或離線下載保證。
- 搜尋最多兩個關鍵字查詢並行、去重且維持最多 20 筆結果。群組切換加上請求序號，舊回應不覆蓋目前範圍；讀取失敗顯示重試，避免偽裝成沒有資料。
- 訂閱與金流退出正式 Worker 依賴圖；/api/v1/payments/*、/api/v1/subscription/* 回傳 410 BILLING_RETIRED，CORS OPTIONS 回傳 204。不提供結帳、取消、付款回呼，也不再需要金流金鑰或舊帳務表才能通過 readiness。歷史資料及舊模組留存，未操作外部供應商合約。

最新驗證：typecheck、lint、358 項測試（API 284／Web 54／Admin 20）、四個應用 build 通過；12 個基礎資料庫／API 案例、擴充 API 案例、10 個 UI 流程、5 個真實模型與保存案例、英文錄音流程、中文真人音檔均通過。中文音檔約 3.46 秒辨識完成，簡繁正規化後與參考逐字相同。

新增 7 個整合案例通過：真實模型跨頁重用、原文差異與離頁保護、延遲舊群組回應、載入失敗重試、真實摘要分段進度、前台沒有金流請求、隔離環境只清除模型快取。舊回應案例延遲真實 API 回應；失敗重試案例主動阻斷請求；其他模型／保存走真實 API 與 Docker 資料庫。

同一測試頁：首次已快取文字推論 2.956 秒，切換至本機 AI 頁後 0.882 秒，Worker 建立數仍為 1。該批 UI 摘要約 8.289 秒；另一次重建測試資料後的工具摘要為 2.518 秒。資料量不同，不把這些數字與第一輪 21.8 秒當作嚴格 A/B 加速比例，也不保證所有裝置速度。

76 個前後台頁面／尺寸組合再次通過。證據：.test-artifacts/audit/routes-optimized.json、optimization-browser.json、optimization-final-*.log、ai-tools.json；重跑新增案例可執行 pnpm integration:test:optimization（共用模型 profile 的腳本須依序執行）。

仍待後續實測：真實手機／低記憶體裝置、模型下載中斷與儲存配額不足、複雜長紀錄品質、噪音／混語辨識、完整無障礙驗收。資料庫排序索引仍為 rollback 的實驗，未改 schema。沒有部署、推送或執行 GitHub Actions。

## 第一輪審查紀錄（歷史）

專案：D:\Project\after-trace；分支：codex/local-browser-ai。修改尚未提交／推送，未部署，未啟動 GitHub Actions。本報告取代先前 LOCAL_AI_VALIDATION.md 對本機資料庫、中文語音及測試數量的早期結論。

## 驗證範圍及結果

- 真實 Docker PostgreSQL 17 + Neon HTTP proxy、Worker API、Web、Admin；獨立測試設定，不讀寫正式環境。
- typecheck、lint、355 項測試（API 284、Web 51、Admin 20）、四個應用 build 全部通過，API 僅 dry-run。
- 12 個前台路由、7 個後台路由，在 1440／768／390／320px 共 76 種組合檢查。修正後無文件水平溢出、頁面 JS 例外、失敗 API 請求或未命名表單欄位。這不是完整無障礙認證。
- 10 個真實 UI 流程通過：切換群組同步紀錄、編輯後保存、一般搜尋、待辦新增／修改／完成、群組與邀請、意見回饋、公告通知、保存時權限撤銷仍保留草稿、無 WebGPU 手動保存、失效登入清除。
- 擴充 API 稽核包含公告預覽／發送／並行發送、通知隔離／已讀、排程取消、推播偏好、回饋管理、管理員權限、擴充登入重發、邀請撤銷、待辦、分頁、單筆紀錄授權、舊雲端 AI 入口封鎖；11 個功能案例及 1 組延遲量測通過。
- 原本的真實模型／UI／資料庫整合及英文麥克風流程通過。文字、圖片、搜尋、改寫、相關紀錄、摘要、待辦建議皆在 Chrome 實際執行本機模型。
- 中文真人樣本約 5 秒，辨識約 3.15 秒；簡繁正規化後與官方參考逐字相同。英文另由本機合成語音走錄音→辨識→編輯草稿→確認→資料庫保存。沒有呼叫雲端推論服務；模型與 runtime 仍需下載靜態資源。

## 已修正的問題

| 問題 | 修正與驗證 |
| --- | --- |
| 公告發送卡在 SENDING，重送 409 | PostgreSQL 同一 CTE 不應更新同一列兩次；改為單次狀態更新並原子寫入收件者，並行發送只成功一次 |
| 取消公告 SQL 型別無法推斷 | 明確將取消者參數轉為 text；真實 PostgreSQL 驗證 |
| 中文語音被輸出成英文 | 套件尚無自動語言偵測，預設英文；介面加入中文／英文選擇，預設中文並明確傳入模型 |
| AI 工具為取得單筆紀錄載入大量歷史 | 增加授權後單筆讀取；無關紀錄不再批量取得；待辦無指定紀錄時不讀歷史 |
| 首頁重複查詢與保存範圍不同步 | 僅合併進行中的 surfaces 請求，完成即清除，避免長期權限快取；範圍切換同步近期紀錄 |
| 768px AI 工具日期欄造成水平溢出 | 平板改單欄，修正 grid／input 最小寬度 |
| 獨立記錄頁過大空白、確認流程容易覆蓋草稿 | 調整容器與間距、確認區捲動定位；核對時隱藏重新解析入口，保留失敗草稿 |
| 本機 AI 工具等待狀態不明確 | 共用處理狀態、取消與離頁釋放；處理期間鎖定相關輸入；下載百分比明確標示目前檔案 |
| 後台仍依賴雲端 AI 舊設定並顯示錯誤商業資訊 | 改成本機 AI 說明及歷史方案入口，移除硬編碼售價／不實運作狀態 |
| 部分表單缺少可讀名稱 | 補搜尋、分頁、群組、邀請及回饋欄位標籤 |

## 效能量測與已採用優化

測試機 RTX 5060 Ti，Chrome 真實 WebGPU；兩模型相同提示、圖片與量化配置。快取已存在，不含首次模型下載。單一裝置、小樣本，不能代表手機或所有內容。

| 量測 | 原 Qwen3.5-0.8B ONNX | ONNX-OPT（已採用） |
| --- | ---: | ---: |
| 已快取的首次文字解析（含初始化） | 15.26 秒 | 3.16 秒 |
| 暖機文字解析，三次中位數 | 12.78 秒 | 0.887 秒 |
| 單張測試圖片解析 | 30.97 秒 | 1.195 秒 |

暖機文字約快 14 倍，圖片樣本約快 26 倍。不能據此宣稱模型更準確：兩個模型在同一文字樣本都曾把「完成登入功能」擴寫成「完成登入功能測試」，所以確認前人工核對仍必要。

其他工具本次實測：自然語言搜尋約 3 秒、改寫約 1.2 秒、相關紀錄約 3.1 秒、待辦建議約 1.8 秒；摘要約 21.8 秒，仍是明顯瓶頸，資料量與輸出長度會影響結果。

本機 API 12 次依序查詢：中位數 494ms、p95 503ms；數字包含本機 Worker／代理及多次 SQL 往返，不能當作正式環境 SLA。

另以隔離來源的 10,000 筆合成紀錄測試查詢計畫，實驗性 expression index 將 SQL execution 從 2.714ms 降至 0.095ms，buffer blocks 188→6。索引實驗已 rollback，**未修改正式 schema 或 baseline**。這只是 SQL 執行時間，不能宣稱 API 加速 29 倍。

## 建議後續調整（尚未實作）

1. **優先補模型品質驗收**：人名、金額、日期、否定句、圖片模糊與中英混說樣本；在原文與草稿之間標示新增／刪除文字，高亮數字與日期。小模型可能新增事實，不能只看 JSON 有效就算成功。
2. **摘要減少等待**：限制摘要輸出長度、分段進度、每段可取消；用實際長紀錄驗證分層摘要品質，避免只提高 context。
3. **模型下載／記憶體體驗**：下載前告知大小與需求、顯示快取狀態與清除入口，評估裝置能力；實測低階筆電與手機，量測顯存峰值及熱降頻。目前尚無真實手機結果。
4. **導航保留模型**：現有整頁跳轉會重新初始化模型；評估前端路由與持續存在的 runtime，並維持取消／登出時資源釋放，避免每頁支付約 3 秒初始化。
5. **API 與 SQL**：先量測往返次數和部署區域，縮減授權／來源／查詢的重複往返。大量紀錄再評估上述排序索引、文字搜尋索引及 keyset pagination；schema、唯一 baseline 與 metadata 必須一起維護。
6. **UI**：手機輸入區與最近紀錄仍偏長，可將輔助說明收合、首頁近期紀錄預設減量；長紀錄以摘要預覽並提供展開。補鍵盤焦點、完整對比度、螢幕閱讀器、錄音狀態朗讀及錯誤重試測試。維持底部導覽安全留白，重要保存動作應容易找到。

## 未涵蓋的外部驗收

Google／LINE 真實 OAuth 回呼、付款供應商與取消續訂、推播實際送達、正式環境網路與資料庫、實際安裝 Chrome 擴充套件、Safari／Firefox／Android／iOS、台語／口音／噪音／長時間混語音均尚未驗收。帳號登入使用本機簽發的測試 session；不應把上述結果稱為所有外部服務均通過。

## 重跑與證據

環境步驟見 [DOCKER_LOCAL_INTEGRATION.md](DOCKER_LOCAL_INTEGRATION.md)。本機網址：Web http://localhost:15173、Admin http://localhost:15174、API http://localhost:18787。Docker 與開發服務保留運行；測試資料是合成資料。

從專案根目錄執行：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm integration:test:api
pnpm integration:test:browser
pnpm integration:test:audio
node scripts/integration/audit-api.mjs
node scripts/integration/audit-flows.mjs
node scripts/integration/audit-routes.mjs verified
node scripts/integration/audit-ai-tools.mjs
node scripts/integration/audit-chinese-audio.mjs
node scripts/integration/audit-model-comparison.mjs
```

模型腳本共用瀏覽器快取 profile，應依序執行，不可同時啟動。database 效能腳本會新增大量合成資料，勿對正式環境執行。原始結果、螢幕截圖與最終檢查紀錄在被 git 忽略的 `.test-artifacts/audit/`，包括 api-extended.json、ui-flows.json、routes-verified.json、model-comparison.json、ai-tools.json、chinese-audio.json、database-plan.json 與 final-*.log。

模型來源：[ONNX-OPT 模型卡](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT)。中文音檔／參考文字：[PaddleSpeech 官方 ASR demo](https://github.com/PaddlePaddle/PaddleSpeech/blob/develop/demos/speech_recognition/README.md)。下載範例音訊只作本機驗證，不是外部 AI 推論。
