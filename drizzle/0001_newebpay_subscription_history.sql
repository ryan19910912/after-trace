CREATE TABLE IF NOT EXISTS "worklog_newebpay_subscription_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL REFERENCES "public"."worklog_users"("id") ON DELETE restrict ON UPDATE no action,
	"checkout_intent_id" bigint REFERENCES "public"."worklog_checkout_intents"("id") ON DELETE restrict ON UPDATE no action,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
COMMENT ON TABLE "worklog_newebpay_subscription_history" IS '藍新定期定額歷史紀錄。每一筆 merchant_order_no 代表一次付款／委託建立紀錄，用於保留完整歷史並處理延遲回呼。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."id" IS '歷史紀錄流水號。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."user_id" IS 'AFTERTRACE 使用者 ID，關聯 worklog_users.id。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."checkout_intent_id" IS '對應的付款意圖 ID，關聯 worklog_checkout_intents.id。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."merchant_order_no" IS 'AFTERTRACE 傳給藍新的商店訂單編號，每次 checkout 唯一。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."period_no" IS '藍新定期定額委託編號，成功建立定期定額後由藍新回傳。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."status" IS 'AFTERTRACE 內部付款歷史狀態，例如 PENDING、ACTIVE、TERMINATED、FAILED、SUPERSEDED、PAID_CONFLICT；合法值由應用程式層控管。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."provider_status" IS '藍新回傳的原始交易／委託狀態。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."respond_code" IS '藍新回傳代碼，例如 00 代表成功。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."auth_amount" IS '本次授權金額，單位為新台幣元。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."total_times" IS '定期定額設定的總授權期數。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."already_times" IS '目前已完成的授權／扣款期數。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."trade_no" IS '藍新交易序號。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."auth_date" IS '首次或本次信用卡授權成功時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."next_auth_date" IS '藍新提供的下一次預計授權／扣款日期。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."current_period_start" IS '此筆訂閱目前服務週期開始時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."current_period_end" IS '此筆訂閱目前服務週期結束時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."last_provider_event_key" IS '最近一次已處理的藍新事件識別值，用於避免重複處理。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."metadata" IS '其他付款、回呼或 reconciliation 擴充資訊，JSON 格式保存。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."created_at" IS '資料建立時間。';
COMMENT ON COLUMN "worklog_newebpay_subscription_history"."updated_at" IS '資料最後更新時間。';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_newebpay_history_order_uq" ON "worklog_newebpay_subscription_history" USING btree ("merchant_order_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_newebpay_history_period_uq" ON "worklog_newebpay_subscription_history" USING btree ("period_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_newebpay_history_user_time_idx" ON "worklog_newebpay_subscription_history" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_newebpay_history_status_time_idx" ON "worklog_newebpay_subscription_history" USING btree ("status","updated_at");
