# AFTERTRACE Admin Observability Contract

Durable contract for the internal Admin observability surfaces on branch `revive/line-worklog`.

## 異常事件

- Admin API provides Chinese presentation labels for anomaly `category` and `error_code` while retaining raw codes in the response contract used by `applyServerLabels`.
- Admin list should show `使用者編號` and `來源編號` whenever durable IDs are known.
- When an anomaly was recorded before domain IDs were available, Admin read may infer them only from durable LINE metadata already stored on that anomaly:
  - `metadata.lineUserId` -> `worklog_users.line_user_id`;
  - `metadata.lineGroupId` -> GROUP `worklog_sources.line_group_id`;
  - PRIVATE Source may be inferred from the resolved user.
- Never fabricate user/source IDs when no deterministic mapping exists.
- Keep the short `摘要` column.
- Provide `詳細錯誤訊息` action that opens the full stored error summary/detail together with request reference and metadata; the table truncation must not be the only way to inspect an error.

## 操作紀錄

- `target_type` and known Admin action codes receive Chinese backend presentation labels.
- `actor_user_id` / `workspace_id` remain raw durable IDs and are never invented.
- For global Admin operations such as Plan or AI runtime configuration, a null user/workspace is legitimate. Admin response should present contextual fallbacks:
  - `管理員操作` when `actor_admin` exists but there is no actor user id;
  - `全域設定` when `actor_admin` exists but there is no workspace id.
- The list combines `before_value` and `after_value` into a single `修改內容` action.
- Clicking `修改內容` opens a field-by-field diff, not raw JSON.
- Nested objects are flattened into readable field paths.
- Unchanged fields are shown in green; changed/added/removed fields are shown in red.
- Immutable audit JSON remains the durable source; the diff is presentation only.

No database schema change is required for this presentation/enrichment batch.
