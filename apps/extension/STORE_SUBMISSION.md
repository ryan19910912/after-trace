# AFTERTRACE Chrome Web Store 上架資料

此文件同時維護 DEV 與 PROD 兩個 Chrome Web Store Item 的上架文案、權限說明與測試資訊。

## Item 名稱

- DEV：`AFTERTRACE DEV`
- PROD：`AFTERTRACE`

## 簡短說明

### DEV

AFTERTRACE 測試版。從瀏覽器快速記錄文字、選取內容、目前頁面資訊與語音轉文字結果到 DEV 環境。

### PROD

從瀏覽器快速留下工作紀錄、選取文字與目前頁面資訊，需要時在 AFTERTRACE 找得到。

## 詳細說明

AFTERTRACE 是工作紀錄工具，讓使用者在事情發生時快速留下紀錄，而不是等到之後再回想。

Chrome 擴充元件可在不離開目前網頁的情況下：

- 輸入文字並儲存到自己的 AFTERTRACE 紀錄空間
- 使用瀏覽器語音轉文字後再確認並儲存
- 將目前選取的文字帶入紀錄
- 在使用者明確勾選時附上目前頁面的標題與 URL
- 擷取目前可見畫面供預覽；只有使用者主動執行 AI 圖片整理時才會送到 AFTERTRACE backend
- 選擇個人或有權限的群組紀錄空間

擴充元件不會讀取整個瀏覽歷史，也不會在背景持續擷取網頁內容。與 AFTERTRACE Web 的連接使用短效 extension session，且 DEV 與 PROD 環境完全分離。

## 權限用途

### `activeTab`

只在使用者主動操作擴充元件時取得目前分頁必要資訊，用於頁面標題 / URL、目前可見畫面截圖，以及快速記錄流程。不會持續監控所有分頁。

### `contextMenus`

提供「儲存到 AFTERTRACE」右鍵選單，讓使用者把自己選取的文字帶入擴充元件。

### `storage`

儲存擴充元件本機設定，例如短效 AFTERTRACE extension session、目前選擇的紀錄空間，以及連線所需的暫時狀態。

### Host permissions

DEV Item 僅允許：

- `https://after-trace-api-dev.a0955625660.workers.dev/*`

PROD Item 僅允許：

- `https://after-trace-api-prod.a0955625660.workers.dev/*`

用途是呼叫 AFTERTRACE 自己的 API。兩個 Store Item 不共用 API host。

### `externally_connectable`

DEV Item 僅接受 DEV Web：

- `https://after-trace-web-dev.a0955625660.workers.dev/*`

PROD Item 僅接受 PROD Web：

- `https://after-trace-web-prod.a0955625660.workers.dev/*`

用途是完成 Web → Extension 的短效 session handoff。Extension 仍會驗證來源環境、nonce 與 API / Web 環境是否一致。

## Privacy / 資料處理說明

AFTERTRACE 擴充元件只在使用者主動操作時處理資料。

可能處理的資料包含：

- 使用者自行輸入的工作紀錄文字
- 使用者主動選取的網頁文字
- 使用者明確勾選後附上的目前頁面標題與 URL
- 使用者按下截圖按鈕後產生的目前可見畫面
- 瀏覽器語音辨識產生的文字結果
- AFTERTRACE 帳號與短效 extension session 所需的驗證資料

資料用途僅為提供 AFTERTRACE 的紀錄、搜尋、整理與帳號連線功能，不出售使用者資料，也不將工作紀錄提供給廣告用途。

語音按鈕使用瀏覽器提供的 Speech Recognition 能力，擴充元件本身保存的是辨識後文字；一般語音轉文字不會因為使用麥克風就自動呼叫 AFTERTRACE AI。

截圖預設只在擴充元件本機預覽。只有使用者主動執行需要圖片 AI 的動作時，圖片才會送到 AFTERTRACE backend，並依帳號方案 / 試用額度處理。

使用者可在擴充元件內解除 AFTERTRACE 連接；解除後會移除本機保存的 AFTERTRACE extension session 與已選紀錄空間。

## DEV / PROD 發布原則

### DEV

- Store Item 名稱：`AFTERTRACE DEV`
- 建議 Visibility：Unlisted 或限制測試者
- 只連 DEV Web / API
- 用於正式上 PROD 前的 Store 安裝與更新測試

### PROD

- Store Item 名稱：`AFTERTRACE`
- Visibility：Public
- 只連 PROD Web / API
- 提供正式使用者安裝

## 上傳套件

在 repo 根目錄執行：

```powershell
pnpm --filter @aftertrace/extension pack:dev
pnpm --filter @aftertrace/extension pack:prod
```

上傳：

- DEV：`apps/extension/aftertrace-extension-dev.zip`
- PROD：`apps/extension/aftertrace-extension-prod.zip`

## 上架後要回填 Web 環境變數

DEV Web：

```env
VITE_CHROME_EXTENSION_STORE_URL=https://chromewebstore.google.com/detail/<DEV_ITEM_SLUG_OR_ID>
```

PROD Web：

```env
VITE_CHROME_EXTENSION_STORE_URL=https://chromewebstore.google.com/detail/<PROD_ITEM_SLUG_OR_ID>
```

DEV / PROD 的 Web build 必須各自注入自己的 Store URL，避免正式網站導向 DEV Item。

## 建議 Store 截圖

至少準備以下畫面：

1. 擴充元件已連接 AFTERTRACE、可選擇紀錄空間
2. 文字 / 語音快速紀錄
3. 右鍵選取文字 → 帶入擴充元件
4. 勾選附上目前頁面的畫面
5. 截圖預覽 / AI 圖片整理入口

DEV 截圖應清楚顯示 `AFTERTRACE DEV`，避免和正式版混淆。
