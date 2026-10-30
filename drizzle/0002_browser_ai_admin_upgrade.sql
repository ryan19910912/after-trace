-- Additive upgrade for databases initialized with the original baseline.
ALTER TABLE "worklog_users" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_local_ai_prompt_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"prompt_key" varchar(48) NOT NULL,
	"action" varchar(24) NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"max_tokens" integer NOT NULL,
	"actor" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_local_ai_prompts" (
	"key" varchar(48) PRIMARY KEY NOT NULL,
	"draft_template" text NOT NULL,
	"published_template" text NOT NULL,
	"draft_max_tokens" integer NOT NULL,
	"published_max_tokens" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(128) NOT NULL,
	"published_by" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='worklog_local_prompt_revisions_prompt_fk' AND conrelid='worklog_local_ai_prompt_revisions'::regclass) THEN ALTER TABLE "worklog_local_ai_prompt_revisions" ADD CONSTRAINT "worklog_local_prompt_revisions_prompt_fk" FOREIGN KEY ("prompt_key") REFERENCES "public"."worklog_local_ai_prompts"("key") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_local_ai_prompt_revisions_key_id_idx" ON "worklog_local_ai_prompt_revisions" USING btree ("prompt_key","id");
--> statement-breakpoint
COMMENT ON TABLE "worklog_local_ai_prompts" IS 'Operator-managed local AI templates with isolated drafts and published snapshots.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."key" IS 'Local prompt configuration key.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."draft_template" IS 'Local prompt configuration draft template.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."published_template" IS 'Local prompt configuration published template.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."draft_max_tokens" IS 'Local prompt configuration draft max tokens.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."published_max_tokens" IS 'Local prompt configuration published max tokens.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."version" IS 'Local prompt configuration version.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."published_version" IS 'Local prompt configuration published version.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."updated_by" IS 'Local prompt configuration updated by.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."published_by" IS 'Local prompt configuration published by.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."created_at" IS 'Local prompt configuration created at.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."updated_at" IS 'Local prompt configuration updated at.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompts"."published_at" IS 'Local prompt configuration published at.';
--> statement-breakpoint
COMMENT ON TABLE "worklog_local_ai_prompt_revisions" IS 'Immutable local AI prompt edit and publication history for review and rollback.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."id" IS 'Local prompt configuration id.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."prompt_key" IS 'Local prompt configuration prompt key.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."action" IS 'Local prompt configuration action.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."version" IS 'Local prompt configuration version.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."template" IS 'Local prompt configuration template.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."max_tokens" IS 'Local prompt configuration max tokens.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."actor" IS 'Local prompt configuration actor.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_prompt_revisions"."created_at" IS 'Local prompt configuration created at.';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_admin_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" varchar(128) NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" varchar(48) NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_admin_roles" (
	"id" varchar(48) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worklog_local_ai_models" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"vision_model" varchar(200) NOT NULL,
	"vision_revision" varchar(64) NOT NULL,
	"speech_model" varchar(200) NOT NULL,
	"speech_revision" varchar(64) NOT NULL,
	"speech_fallback_model" varchar(200),
	"speech_fallback_revision" varchar(64),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(128) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='worklog_admin_accounts_role_fk' AND conrelid='worklog_admin_accounts'::regclass) THEN ALTER TABLE "worklog_admin_accounts" ADD CONSTRAINT "worklog_admin_accounts_role_fk" FOREIGN KEY ("role_id") REFERENCES "public"."worklog_admin_roles"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worklog_admin_accounts_username_uq" ON "worklog_admin_accounts" USING btree ("username");
--> statement-breakpoint
COMMENT ON TABLE "worklog_admin_roles" IS 'Operator administration: worklog admin roles.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_roles"."id" IS 'Administration id.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_roles"."name" IS 'Administration name.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_roles"."permissions" IS 'Administration permissions.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_roles"."version" IS 'Administration version.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_roles"."updated_at" IS 'Administration updated at.';
--> statement-breakpoint
COMMENT ON TABLE "worklog_admin_accounts" IS 'Operator administration: worklog admin accounts.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."id" IS 'Administration id.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."username" IS 'Administration username.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."password_hash" IS 'Administration password hash.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."role_id" IS 'Administration role id.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."is_super_admin" IS 'Administration is super admin.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."active" IS 'Administration active.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."token_version" IS 'Administration token version.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."must_change_password" IS 'Administration must change password.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."failed_attempts" IS 'Administration failed attempts.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."locked_until" IS 'Administration locked until.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."last_login_at" IS 'Administration last login at.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."created_at" IS 'Administration created at.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_admin_accounts"."updated_at" IS 'Administration updated at.';
--> statement-breakpoint
COMMENT ON TABLE "worklog_local_ai_models" IS 'Operator administration: worklog local ai models.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."id" IS 'Administration id.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."vision_model" IS 'Administration vision model.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."vision_revision" IS 'Administration vision revision.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."speech_model" IS 'Administration speech model.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."speech_revision" IS 'Administration speech revision.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."version" IS 'Administration version.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."updated_by" IS 'Administration updated by.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."updated_at" IS 'Administration updated at.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_users"."last_used_at" IS 'Last authenticated frontend use, refreshed at most once every five minutes; null means no observed activity.';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_record_author_id_idx" ON "worklog_records" USING btree ("author_user_id","id" DESC);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worklog_feedback_user_id_idx" ON "worklog_feedback" USING btree ("user_id","id" DESC);

--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."speech_fallback_model" IS 'Optional browser speech fallback model repository.';
--> statement-breakpoint
COMMENT ON COLUMN "worklog_local_ai_models"."speech_fallback_revision" IS 'Pinned browser speech fallback model revision.';
