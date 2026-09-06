# AFTERTRACE LINE Identity / Display Name Policy

Durable supplement for branch `revive/line-worklog`.

## Entry surfaces stay separate

AFTERTRACE has two independent customer entry surfaces:

1. **LINE webhook** — LINE private/group messages delivered to `/webhooks/line`.
2. **PWA Quick Capture** — authenticated Web/PWA flow using the AFTERTRACE web session.

PWA Quick Capture does not depend on LINE webhook delivery or OA friendship. A delivered LINE private webhook is also not gated by `is_oa_friend`; follow/unfollow remains lifecycle/analytics state only.

## Customer-facing LINE identity

When AFTERTRACE shows a LINE person, especially a GROUP **AI 額度負責人**, the primary display value should be the LINE user's display name. Internal AFTERTRACE user id is secondary diagnostic/admin information only.

Preferred Admin presentation:

```text
AI 額度負責人
Ryan Hsu
編號 #5
```

Do not use `#5` or raw `line_user_id` as the main customer-facing identity when a LINE display name is available.

## Display-name hydration

LINE webhook events do not always contain a usable display name. When AFTERTRACE has a LINE user id but `worklog_users.display_name` is missing:

- private LINE interaction: best-effort lookup through LINE `GET /v2/bot/profile/{userId}`;
- GROUP interaction: best-effort lookup through LINE `GET /v2/bot/group/{groupId}/member/{userId}`;
- persist the returned `displayName` into `worklog_users.display_name` as the reusable cached presentation value;
- GROUP AI responsibility binding/status/Admin screens reuse that cached LINE name.

The lookup is **lazy and best-effort**. A profile API failure must not block Record/query/AI responsibility operations. If LINE profile lookup fails, continue with the durable LINE user id / internal user id and allow the display name to be filled on a later successful interaction.

Current implementation avoids an extra LINE profile request when `worklog_users.display_name` is already populated. A future explicit freshness policy may refresh changed LINE names, but missing-name hydration is the current required behavior.

## Authorization boundary

LINE display-name lookup is presentation enrichment only. It must never substitute for:

- GROUP active-membership authorization;
- PRIVATE Source ownership/identity;
- AI point eligibility;
- AI responsibility binding.

Profile lookup success or failure must not grant or revoke data access.

## Admin expectations

Admin GROUP list/detail should resolve the AI 額度負責人 name from `worklog_users.display_name` and keep the internal AFTERTRACE user id as secondary information. Existing rows with a missing name are hydrated lazily the next time that LINE user interacts through a path that has sufficient LINE identity/context.

GitHub Actions must not be used as validation unless explicitly requested by the user.
