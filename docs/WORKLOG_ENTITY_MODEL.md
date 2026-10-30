# 資料模型

更新：2026-10-29。Drizzle 定義以 apps/api/src/db/schema-all.ts 為入口，canonical baseline 目前共 37 張表。

## 核心事實

紀錄是某個已授權範圍中的持久文字。worklog_users 搭配 auth_identities 及 user_public_accounts 儲存 provider-neutral 帳號、登入綁定及不透明用戶 ID；last_used_at 觀察登入後前台活動，最多每五分鐘更新，不等同即時在線狀態。

worklog_workspaces／worklog_sources／worklog_source_members／邀請表提供個人 PRIVATE 與群組 GROUP 授權。群組角色為 OWNER、MEMBER，不使用 LINE 群組或 AI 出資人。

worklog_records 包含 source_id、作者、選填 title、必要 raw_text、選填 occurred_at、created_at／updated_at、status、version；worklog_record_revisions 保存修改歷史。AI 產生的草稿不在確認前成為紀錄；媒體不儲存在後端。手動紀錄不需要 AI metadata。

編輯／軟刪除／還原都依目前權限及 expectedVersion 執行，原子更新並保存歷史。AI 搜尋僅提出條件；資料查詢由後端確定性處理。摘要、改寫或待辦建議不直接修改正式資料。不自動產生 Customer／Project／Entity／Alias 主資料。

## 管理與 AI 設定

- worklog_admin_roles：角色、權限集合及設定版本。
- worklog_admin_accounts：管理帳號、加鹽雜湊、角色、最高帳號／啟用狀態、token_version、強制改密碼、登入失敗鎖定與時間。
- worklog_local_ai_models：singleton（id=1），文字／圖片及語音模型代碼、固定 commit revision、設定版本與修改者。
- worklog_local_ai_prompts：六個功能的草稿／發布模板、token 上限及版本。
- worklog_local_ai_prompt_revisions：提示詞發布／回復歷史。
- worklog_audit_logs：管理操作稽核，不保存明文密碼。

種子 ON CONFLICT DO NOTHING，重跑保留管理員編輯及密碼。密碼用 PBKDF2-SHA256（100000 次）、獨立隨機 salt 與環境 pepper；pepper 不存資料庫。變更密碼或停用帳號撤銷既有 token。

## 其他現行領域

待辦／提醒、站內通知與收件狀態、Web Push subscription／偏好、公告、feedback 與 feedback_management 均為獨立領域。推播 subscription 指裝置通知註冊，不是已退役的付費訂閱。

## 歷史資料

舊付費訂閱、付款、AI Grant／用量／成本等表仍在基線及資料庫，保留供歷史查閱；正式 Worker 不再使用它們提供金流或雲端 AI。不能據表存在便認定功能已開放。未重新引入 LINE Messaging、Entity／Alias 或一次性儲值領域。

## 結構規則

每個表／欄位有 COMMENT，沒有應用領域 PostgreSQL ENUM 或商業 CHECK；結構 PK／FK／UNIQUE／NOT NULL／INDEX／DEFAULT 保留。應用驗證合法狀態與權限，使用參數化 SQL。既有資料庫不得任意清空，schema／基線／metadata 需同步。

## 本輪索引與讀取稽核

worklog_records 新增 (author_user_id,id DESC)，worklog_feedback 新增 (user_id,id DESC)，分別對應作者歷史與本人回饋的排序查詢。表數仍為 37，schema、canonical baseline、snapshot 同步；本地既有庫以 IF NOT EXISTS 補索引。已套用舊基線的遠端庫仍須規劃非破壞 schema 升級，不能只改檔案即宣稱已升級。

worklog_audit_logs 同時記錄 USER_HISTORY_VIEWED／USER_RECORD_VIEWED，after_value 只含目標與用途等稽核資訊，不含保存紀錄正文。
