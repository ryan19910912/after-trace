-- Keep customer/project links deterministic even when a project is reassigned.
--
-- API writes already canonicalize customer_id from a selected project's customer,
-- but changing the project's customer later could leave existing records and
-- transactions pointing at the previous customer. This migration closes that gap
-- at the database layer.

CREATE OR REPLACE FUNCTION worklog_sync_project_customer_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL THEN
    UPDATE worklog_records
    SET customer_id = NEW.customer_id,
        updated_at = NOW()
    WHERE project_id = NEW.id
      AND workspace_id = NEW.workspace_id
      AND customer_id IS DISTINCT FROM NEW.customer_id;

    UPDATE worklog_transactions
    SET customer_id = NEW.customer_id,
        updated_at = NOW()
    WHERE project_id = NEW.id
      AND workspace_id = NEW.workspace_id
      AND customer_id IS DISTINCT FROM NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_project_customer_link_sync
  ON worklog_projects;

CREATE TRIGGER worklog_project_customer_link_sync
AFTER UPDATE OF customer_id ON worklog_projects
FOR EACH ROW
EXECUTE FUNCTION worklog_sync_project_customer_links();
