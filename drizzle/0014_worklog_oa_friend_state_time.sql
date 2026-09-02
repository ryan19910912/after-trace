-- Keep LINE OA FOLLOW / UNFOLLOW ordering independent from ordinary interaction time.
--
-- Webhook delivery may be delayed or reordered. A dedicated lifecycle timestamp lets
-- a newer FOLLOW/UNFOLLOW win without allowing an ordinary private message to block
-- a legitimate friendship-state event that happened slightly earlier.

ALTER TABLE "worklog_users"
ADD COLUMN IF NOT EXISTS "oa_friend_state_at" timestamptz;

-- Existing rows have no precise historical lifecycle timestamp. `updated_at` is the
-- best durable approximation for the currently persisted friendship state; future
-- FOLLOW/UNFOLLOW events will maintain the dedicated timestamp explicitly.
UPDATE "worklog_users"
SET "oa_friend_state_at" = COALESCE("oa_friend_state_at", "updated_at", "last_interaction_at", "created_at")
WHERE "oa_friend_state_at" IS NULL;
