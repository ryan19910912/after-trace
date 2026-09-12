CREATE TABLE IF NOT EXISTS "worklog_newebpay_subscription_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"checkout_intent_id" bigint,
	"merchant_order_no" varchar(30) NOT NULL,
	"period_no" varchar(32),
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"provider_status" varchar(64),
	"respond_code" varchar(64),
	"auth_amount" integer,
	"total_times" integer,
	"already_times" integer,
	"trade_no" varchar(64),
	"auth_date" timestamp with time zone,
	"next_auth_date" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"last_provider_event_key" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worklog_newebpay_history_status_ck" CHECK ("status" IN ('PENDING','ACTIVE','TERMINATED','FAILED','SUPERSEDED','PAID_CONFLICT')),
	CONSTRAINT "worklog_newebpay_history_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "worklog_newebpay_history_checkout_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."worklog_checkout_intents"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_newebpay_history_order_uq" ON "worklog_newebpay_subscription_history" USING btree ("merchant_order_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_newebpay_history_period_uq" ON "worklog_newebpay_subscription_history" USING btree ("period_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_newebpay_history_user_time_idx" ON "worklog_newebpay_subscription_history" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_newebpay_history_status_time_idx" ON "worklog_newebpay_subscription_history" USING btree ("status","updated_at");
