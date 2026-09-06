import { sql } from 'drizzle-orm';

/**
 * Forward-compatibility migrations for environments that already applied an older
 * regenerated 0000 baseline. Keep these migrations idempotent: fresh databases run
 * this before Drizzle creates the current baseline, while existing databases may run
 * it on every manual deploy.
 *
 * Neon HTTP prepared statements accept one SQL command per execute call. Keep each
 * forward-compatibility DO block in its own db.execute(...) rather than concatenating
 * multiple top-level commands into one prepared statement.
 */
export async function applyForwardCompatibilityMigrations(db) {
  await db.execute(sql.raw(`
DO $aftertrace$
DECLARE
  plans_table regclass := to_regclass('public.worklog_subscription_plans');
  has_legacy_points boolean;
  has_plan_type boolean;
  has_grant_points boolean;
BEGIN
  IF plans_table IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'worklog_plan_type'
  ) INTO has_plan_type;
  IF NOT has_plan_type THEN
    CREATE TYPE public.worklog_plan_type AS ENUM ('FREE', 'SUBSCRIPTION', 'ONE_TIME');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'worklog_subscription_plans'
      AND column_name = 'subscription_period_points'
  ) INTO has_legacy_points;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'worklog_subscription_plans'
      AND column_name = 'plan_type'
  ) INTO has_plan_type;
  IF NOT has_plan_type THEN
    ALTER TABLE public.worklog_subscription_plans ADD COLUMN plan_type public.worklog_plan_type;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'worklog_subscription_plans'
      AND column_name = 'grant_points'
  ) INTO has_grant_points;
  IF NOT has_grant_points THEN
    ALTER TABLE public.worklog_subscription_plans ADD COLUMN grant_points integer;
  END IF;

  UPDATE public.worklog_subscription_plans
  SET plan_type = CASE WHEN code = 'FREE' THEN 'FREE'::public.worklog_plan_type ELSE 'SUBSCRIPTION'::public.worklog_plan_type END
  WHERE plan_type IS NULL;

  IF has_legacy_points THEN
    UPDATE public.worklog_subscription_plans SET grant_points = subscription_period_points WHERE grant_points IS NULL;
  ELSE
    UPDATE public.worklog_subscription_plans SET grant_points = 0 WHERE grant_points IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.worklog_subscription_plans
    WHERE (code = 'FREE' AND (plan_type <> 'FREE' OR price_twd <> 0))
       OR (code <> 'FREE' AND plan_type = 'FREE')
  ) THEN RAISE EXCEPTION 'AFTERTRACE forward migration refused inconsistent FREE plan data'; END IF;

  IF EXISTS (SELECT 1 FROM public.worklog_subscription_plans WHERE grant_points < 0) THEN
    RAISE EXCEPTION 'AFTERTRACE forward migration refused negative grant_points';
  END IF;

  ALTER TABLE public.worklog_subscription_plans
    ALTER COLUMN plan_type SET NOT NULL,
    ALTER COLUMN grant_points SET DEFAULT 0,
    ALTER COLUMN grant_points SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = plans_table AND conname = 'worklog_plan_free_identity_ck'
  ) THEN
    ALTER TABLE public.worklog_subscription_plans
      ADD CONSTRAINT worklog_plan_free_identity_ck
      CHECK (((code = 'FREE' AND plan_type = 'FREE' AND price_twd = 0) OR (code <> 'FREE' AND plan_type <> 'FREE')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = plans_table AND conname = 'worklog_plan_grant_points_ck'
  ) THEN
    ALTER TABLE public.worklog_subscription_plans
      ADD CONSTRAINT worklog_plan_grant_points_ck CHECK (grant_points >= 0);
  END IF;

  IF has_legacy_points THEN
    ALTER TABLE public.worklog_subscription_plans DROP COLUMN subscription_period_points;
  END IF;
END
$aftertrace$;
  `));

  await db.execute(sql.raw(`
DO $aftertrace_search$
DECLARE
  records_table regclass := to_regclass('public.worklog_records');
  has_search_terms boolean;
BEGIN
  IF records_table IS NULL THEN RETURN; END IF;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'worklog_records' AND column_name = 'search_terms'
  ) INTO has_search_terms;
  IF NOT has_search_terms THEN
    ALTER TABLE public.worklog_records ADD COLUMN search_terms jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.worklog_records WHERE jsonb_typeof(search_terms) <> 'array'
  ) THEN
    RAISE EXCEPTION 'AFTERTRACE forward migration refused non-array worklog_records.search_terms data';
  END IF;
END
$aftertrace_search$;
  `));

  await db.execute(sql.raw(`
DO $aftertrace_record_reset$
DECLARE
  records_table regclass := to_regclass('public.worklog_records');
  revisions_table regclass := to_regclass('public.worklog_record_revisions');
  has_enrichment_type boolean;
BEGIN
  -- Fresh database: the regenerated canonical baseline creates the target shape.
  IF records_table IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'worklog_record_ai_enrichment_status'
  ) INTO has_enrichment_type;
  IF NOT has_enrichment_type THEN
    CREATE TYPE public.worklog_record_ai_enrichment_status AS ENUM ('NONE', 'ENRICHED', 'LEGACY');
  END IF;

  ALTER TABLE public.worklog_records
    ADD COLUMN IF NOT EXISTS title varchar(255),
    ADD COLUMN IF NOT EXISTS extracted_metadata jsonb,
    ADD COLUMN IF NOT EXISTS ai_enrichment_status public.worklog_record_ai_enrichment_status,
    ADD COLUMN IF NOT EXISTS ai_enriched_at timestamptz;

  -- Existing pre-reset records are intentionally marked LEGACY instead of guessing
  -- whether historical title/search metadata was generated by the retired LINE AI path.
  UPDATE public.worklog_records
  SET ai_enrichment_status = 'LEGACY'::public.worklog_record_ai_enrichment_status
  WHERE ai_enrichment_status IS NULL;

  ALTER TABLE public.worklog_records
    ALTER COLUMN ai_enrichment_status SET DEFAULT 'NONE'::public.worklog_record_ai_enrichment_status,
    ALTER COLUMN ai_enrichment_status SET NOT NULL,
    ALTER COLUMN occurred_at DROP DEFAULT,
    ALTER COLUMN occurred_at DROP NOT NULL;

  CREATE INDEX IF NOT EXISTS worklog_record_ai_enrichment_idx
    ON public.worklog_records (ai_enrichment_status, ai_enriched_at);

  IF revisions_table IS NOT NULL THEN
    ALTER TABLE public.worklog_record_revisions
      ALTER COLUMN previous_occurred_at DROP NOT NULL,
      ALTER COLUMN new_occurred_at DROP NOT NULL;
  END IF;
END
$aftertrace_record_reset$;
  `));

  await db.execute(sql.raw(`
DO $aftertrace_product_foundation$
DECLARE
  users_table regclass := to_regclass('public.worklog_users');
  sources_table regclass := to_regclass('public.worklog_sources');
  members_table regclass := to_regclass('public.worklog_source_members');
  plans_table regclass := to_regclass('public.worklog_subscription_plans');
  has_member_role_type boolean;
BEGIN
  -- Fresh database: the regenerated canonical baseline creates the target shape.
  IF users_table IS NULL OR sources_table IS NULL OR members_table IS NULL OR plans_table IS NULL THEN
    RETURN;
  END IF;

  -- Web/PWA accounts must no longer require LINE identity. Existing LINE ids are preserved.
  ALTER TABLE public.worklog_users ALTER COLUMN line_user_id DROP NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'worklog_source_member_role'
  ) INTO has_member_role_type;
  IF NOT has_member_role_type THEN
    CREATE TYPE public.worklog_source_member_role AS ENUM ('OWNER', 'MEMBER');
  END IF;

  ALTER TABLE public.worklog_sources
    ADD COLUMN IF NOT EXISTS name varchar(255),
    ADD COLUMN IF NOT EXISTS created_by_user_id bigint;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = sources_table AND conname = 'worklog_sources_created_by_user_id_worklog_users_id_fk'
  ) THEN
    ALTER TABLE public.worklog_sources
      ADD CONSTRAINT worklog_sources_created_by_user_id_worklog_users_id_fk
      FOREIGN KEY (created_by_user_id) REFERENCES public.worklog_users(id) ON DELETE RESTRICT;
  END IF;

  ALTER TABLE public.worklog_sources DROP CONSTRAINT IF EXISTS worklog_source_identity_shape_ck;
  ALTER TABLE public.worklog_sources
    ADD CONSTRAINT worklog_source_identity_shape_ck
    CHECK ((
      (type = 'PRIVATE' AND private_user_id IS NOT NULL AND line_group_id IS NULL)
      OR
      (type = 'GROUP' AND private_user_id IS NULL AND (
        line_group_id IS NOT NULL
        OR (name IS NOT NULL AND length(btrim(name)) > 0)
      ))
    ));

  CREATE INDEX IF NOT EXISTS worklog_source_creator_idx
    ON public.worklog_sources (created_by_user_id);

  ALTER TABLE public.worklog_source_members
    ADD COLUMN IF NOT EXISTS role public.worklog_source_member_role;
  UPDATE public.worklog_source_members
    SET role = 'MEMBER'::public.worklog_source_member_role
    WHERE role IS NULL;
  ALTER TABLE public.worklog_source_members
    ALTER COLUMN role SET DEFAULT 'MEMBER'::public.worklog_source_member_role,
    ALTER COLUMN role SET NOT NULL;
  CREATE INDEX IF NOT EXISTS worklog_source_member_source_role_idx
    ON public.worklog_source_members (source_id, role, is_active);

  ALTER TABLE public.worklog_subscription_plans
    ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS monthly_ai_point_cap integer,
    ADD COLUMN IF NOT EXISTS monthly_provider_cost_cap_twd numeric(12,2),
    ADD COLUMN IF NOT EXISTS per_request_ai_point_cap integer;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = plans_table AND conname = 'worklog_plan_ai_cap_values_ck'
  ) THEN
    ALTER TABLE public.worklog_subscription_plans
      ADD CONSTRAINT worklog_plan_ai_cap_values_ck CHECK ((
        (monthly_ai_point_cap IS NULL OR monthly_ai_point_cap > 0)
        AND (monthly_provider_cost_cap_twd IS NULL OR monthly_provider_cost_cap_twd > 0)
        AND (per_request_ai_point_cap IS NULL OR per_request_ai_point_cap > 0)
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = plans_table AND conname = 'worklog_plan_ai_enabled_shape_ck'
  ) THEN
    ALTER TABLE public.worklog_subscription_plans
      ADD CONSTRAINT worklog_plan_ai_enabled_shape_ck CHECK ((
        ai_enabled = false
        OR (
          plan_type = 'SUBSCRIPTION'
          AND price_twd > 0
          AND monthly_ai_point_cap IS NOT NULL
          AND monthly_provider_cost_cap_twd IS NOT NULL
        )
      ));
  END IF;

  CREATE TABLE IF NOT EXISTS public.worklog_auth_identities (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.worklog_users(id) ON DELETE CASCADE,
    provider varchar(64) NOT NULL,
    subject varchar(255) NOT NULL,
    email_snapshot varchar(320),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS worklog_auth_identity_provider_subject_uq
    ON public.worklog_auth_identities (provider, subject);
  CREATE INDEX IF NOT EXISTS worklog_auth_identity_user_idx
    ON public.worklog_auth_identities (user_id);

  CREATE TABLE IF NOT EXISTS public.worklog_source_invites (
    id bigserial PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES public.worklog_sources(id) ON DELETE CASCADE,
    token_hash varchar(128) NOT NULL,
    created_by_user_id bigint NOT NULL REFERENCES public.worklog_users(id) ON DELETE RESTRICT,
    expires_at timestamptz,
    revoked_at timestamptz,
    max_uses integer,
    use_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT worklog_source_invite_use_count_ck CHECK (use_count >= 0),
    CONSTRAINT worklog_source_invite_max_uses_ck CHECK (
      max_uses IS NULL OR (max_uses > 0 AND use_count <= max_uses)
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS worklog_source_invite_token_hash_uq
    ON public.worklog_source_invites (token_hash);
  CREATE INDEX IF NOT EXISTS worklog_source_invite_source_active_idx
    ON public.worklog_source_invites (source_id, revoked_at, expires_at);
END
$aftertrace_product_foundation$;
  `));

  await db.execute(sql.raw(`
DO $aftertrace_group_profile$
BEGIN
  -- Fresh database: canonical baseline creates this after the compatibility hook returns.
  IF to_regclass('public.worklog_sources') IS NULL THEN RETURN; END IF;

  CREATE TABLE IF NOT EXISTS public.worklog_source_line_profiles (
    source_id bigint PRIMARY KEY REFERENCES public.worklog_sources(id) ON DELETE CASCADE,
    group_name text NOT NULL,
    picture_url text,
    synced_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS worklog_source_line_profile_synced_idx
    ON public.worklog_source_line_profiles (synced_at);
END
$aftertrace_group_profile$;
  `));
}