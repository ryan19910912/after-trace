# Dev 模型下載 CORS 修正（2026-10-30）

使用者回報 Qwen3.5 固定 revision 的 preprocessor_config.json 在 dev 瀏覽器被 CORS 阻擋。已重現：相同模型 URL 與 Origin，帶 dev workers.dev Referer 得到 404 且沒有 Access-Control-Allow-Origin；localhost 或無 Referer 則得到正常 307／200 與 CORS 標頭。這是下載階段問題，不能據此判定裝置算力不足。

僅針對 Hugging Face 靜態模型 resolve GET，使用 credentials:omit、mode:cors、referrerPolicy:no-referrer。網路／CORS 失敗最多另重試兩次，以新的查詢參數避讓失敗快取；404 不重試以保留 Transformers.js 的可選檔案探測，取消不重試。未代理用戶內容，沒有雲端推論。

新增 AI_DOWNLOAD_FAILED 白名單摘要及可操作的前台提示。舊的 AI_MODEL_FAILED 事件保留原分類，不用推測覆寫過去紀錄。

驗證：新增五項下載單元測試；四個實際 HF 設定檔從 dev 瀏覽器來源執行 CORS 故障注入後下載成功。這是下載與恢復驗證，不是本次重新進行完整模型推論品質評估。

重跑：node scripts/integration/model-download-cors-test.mjs。結果位於忽略的 .test-artifacts/model-download-cors-results.json。
