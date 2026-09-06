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