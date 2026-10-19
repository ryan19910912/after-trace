# AFTERTRACE

AFTERTRACE 是一個結合 AI 的工作紀錄與知識整理平台，協助使用者快速保存工作中發生的事情，並在需要時找回相關資訊。

透過網頁、PWA 與 Chrome 擴充功能，使用者可以記錄文字、語音和網頁內容，再利用搜尋、摘要與待辦建議整理工作資訊。

## 主要功能

- **工作紀錄**：新增、編輯與刪除紀錄，以時間軸、關鍵字及日期篩選查找內容。
- **AI 輔助整理**：處理文字、圖片與支援的音訊、文件輸入，提供自然語言搜尋、摘要、相關紀錄及待辦建議。
- **個人與群組空間**：區分私人紀錄與群組資料，透過邀請連結及成員權限管理協作。
- **待辦與通知**：管理待辦事項、提醒與通知中心，支援 Web Push 推播。
- **快速擷取**：使用 Chrome 擴充功能保存選取文字、網頁標題、網址與截圖。
- **帳號與管理後台**：整合第三方登入，提供帳號查詢、公告、使用者回饋及 AI 額度管理。

## 使用技術

| 類別 | 技術 |
| --- | --- |
| 前端 | React、TypeScript、Vite、PWA |
| 後端 | TypeScript、Hono、Cloudflare Workers |
| 資料庫 | PostgreSQL、Neon、Drizzle ORM |
| AI | Google Gemini API |
| 登入驗證 | Google／LINE／Apple 登入、OAuth 2.0、PKCE |
| 瀏覽器整合 | Chrome Extension、Web Speech API、Web Push |
| 訂閱付款 | 藍新金流定期定額串接 |
| 測試與開發工具 | Vitest、ESLint、pnpm、Wrangler、Git |
