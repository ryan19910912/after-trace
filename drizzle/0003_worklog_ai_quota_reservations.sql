DO $$ BEGIN
  CREATE TYPE "worklog_ai_reservation_status" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_ai_quota_balances" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" bigint NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone,
  "allowance_units" integer DEFAULT 0 NOT NULL,
  "used_units" integer DEFAULT 0 NOT NULL,
  "reserved_units" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "worklog_ai_quota_balance_user_period_uq" UNIQUE("user_id", "period_start"),
  CONSTRAINT "worklog_ai_quota_balance_units_check"
    CHECK ("allowance_units" >= 0 AND "used_units" >= 0 AND "reserved_units" >= 0)
);
--> statement-breakpoint
INSERT INTO "worklog_ai_quota_balances" (
  "user_id",
  "period_start",
  "period_end",
  "allowance_units",
  "used_units",
  "reserved_units",
  "created_at",
  "updated_at"
)
SELECT
  subscription."user_id",
  subscription."current_period_start",
  subscription."current_period_end",
  COALESCE(plan."ai_allowance_units", 0),
  COALESCE((
    SELECT SUM(event."ai_units_consumed")::integer
    FROM "worklog_ai_usage_events" AS event
    WHERE event."charged_user_id" = subscription."user_id"
      AND event."created_at" >= subscription."current_period_start"
      AND (
        subscription."current_period_end" IS NULL
        OR event."created_at" < subscription."current_period_end"
      )
  ), 0),
  0,
  NOW(),
  NOW()
FROM "worklog_user_subscriptions" AS subscription
LEFT JOIN "worklog_subscription_plans" AS plan
  ON plan."code" = subscription."plan_code"
ON CONFLICT ("user_id", "period_start") DO UPDATE
SET
  "period_end" = EXCLUDED."period_end",
  "allowance_units" = EXCLUDED."allowance_units",
  "used_units" = EXCLUDED."used_units",
  "updated_at" = NOW();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_ai_quota_balance_user_time_idx"
  ON "worklog_ai_quota_balances" USING btree ("user_id", "period_start", "period_end");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_ai_quota_reservations" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "token" varchar(64) NOT NULL,
  "charged_user_id" bigint NOT NULL,
  "actor_user_id" bigint NOT NULL,
  "source_id" bigint,
  "units_reserved" integer NOT NULL,
  "units_committed" integer DEFAULT 0 NOT NULL,
  "status" "worklog_ai_reservation_status" DEFAULT 'RESERVED' NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "worklog_ai_quota_reservation_token_uq" UNIQUE("token"),
  CONSTRAINT "worklog_ai_quota_reservation_units_check"
    CHECK ("units_reserved" > 0 AND "units_committed" >= 0 AND "units_committed" <= "units_reserved")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_ai_quota_reservation_charged_status_expiry_idx"
  ON "worklog_ai_quota_reservations" USING btree ("charged_user_id", "status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_ai_quota_reservation_source_actor_idx"
  ON "worklog_ai_quota_reservations" USING btree ("source_id", "actor_user_id", "created_at");
