-- Preserve AI allowance as an immutable billing-cycle snapshot.
--
-- Plan definitions are templates for future cycles. Once a row exists in
-- worklog_ai_quota_balances for (user_id, period_start), reassigning a plan or
-- editing a plan template must not rewrite that cycle's allowance underneath
-- already-used or reserved units. A future explicit operator adjustment should
-- use a dedicated audited mechanism rather than mutating this snapshot implicitly.

CREATE OR REPLACE FUNCTION worklog_preserve_quota_cycle_allowance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.allowance_units IS DISTINCT FROM OLD.allowance_units THEN
    NEW.allowance_units := OLD.allowance_units;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_quota_cycle_allowance_snapshot
  ON worklog_ai_quota_balances;

CREATE TRIGGER worklog_quota_cycle_allowance_snapshot
BEFORE UPDATE OF allowance_units ON worklog_ai_quota_balances
FOR EACH ROW
EXECUTE FUNCTION worklog_preserve_quota_cycle_allowance();
