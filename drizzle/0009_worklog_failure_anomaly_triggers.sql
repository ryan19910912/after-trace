CREATE OR REPLACE FUNCTION worklog_capture_attachment_failure_anomaly()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'FAILED' AND (OLD.status IS DISTINCT FROM 'FAILED' OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code) THEN
    INSERT INTO worklog_anomaly_events (
      category,
      severity,
      status,
      error_code,
      summary,
      user_id,
      source_id,
      line_message_id,
      request_ref,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      'LINE_ATTACHMENT_INGESTION',
      CASE
        WHEN NEW.last_error_code IN ('LINE_CONTENT_EXPIRED', 'ATTACHMENT_UNSUPPORTED', 'LINE_CONTENT_TOO_LARGE') THEN 'WARNING'::worklog_anomaly_severity
        ELSE 'ERROR'::worklog_anomaly_severity
      END,
      'OPEN',
      LEFT(COALESCE(NEW.last_error_code, 'ATTACHMENT_INGESTION_FAILED'), 128),
      'LINE Reply attachment ingestion failed',
      NEW.actor_user_id,
      NEW.source_id,
      NEW.command_line_message_id,
      NEW.quoted_line_message_id,
      jsonb_build_object(
        'quotedLineMessageId', NEW.quoted_line_message_id,
        'ingestionStatus', NEW.status,
        'recordId', NEW.record_id
      ),
      NOW(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_attachment_failure_anomaly_trg ON worklog_attachment_ingestions;
CREATE TRIGGER worklog_attachment_failure_anomaly_trg
AFTER UPDATE OF status, last_error_code ON worklog_attachment_ingestions
FOR EACH ROW
EXECUTE FUNCTION worklog_capture_attachment_failure_anomaly();

CREATE OR REPLACE FUNCTION worklog_capture_normalization_failure_anomaly()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_source_id bigint;
  target_user_id bigint;
  target_line_message_id varchar(64);
BEGIN
  IF NEW.status = 'FAILED' AND (OLD.status IS DISTINCT FROM 'FAILED' OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code) THEN
    SELECT source_id, author_user_id, line_message_id
      INTO target_source_id, target_user_id, target_line_message_id
    FROM worklog_records
    WHERE id = NEW.record_id;

    INSERT INTO worklog_anomaly_events (
      category,
      severity,
      status,
      error_code,
      summary,
      user_id,
      source_id,
      line_message_id,
      request_ref,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      'TEXT_AI_NORMALIZATION',
      'ERROR',
      'OPEN',
      LEFT(COALESCE(NEW.last_error_code, 'AI_NORMALIZATION_FAILED'), 128),
      'Worklog TEXT AI normalization failed',
      target_user_id,
      target_source_id,
      target_line_message_id,
      NEW.record_id::text,
      jsonb_build_object(
        'recordId', NEW.record_id,
        'normalizationStatus', NEW.status,
        'detail', NEW.last_error_detail
      ),
      NOW(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worklog_normalization_failure_anomaly_trg ON worklog_record_ai_normalizations;
CREATE TRIGGER worklog_normalization_failure_anomaly_trg
AFTER UPDATE OF status, last_error_code ON worklog_record_ai_normalizations
FOR EACH ROW
EXECUTE FUNCTION worklog_capture_normalization_failure_anomaly();
