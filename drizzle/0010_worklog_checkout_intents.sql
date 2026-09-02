CREATE TABLE IF NOT EXISTS worklog_checkout_intents (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  plan_code varchar(64) NOT NULL,
  request_key varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING_PROVIDER',
  provider varchar(64),
  provider_checkout_id varchar(255),
  checkout_url varchar(2048),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT worklog_checkout_intent_status_ck CHECK (status IN ('PENDING_PROVIDER','READY','COMPLETED','CANCELLED','FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS worklog_checkout_intent_request_uq
  ON worklog_checkout_intents(request_key);
CREATE INDEX IF NOT EXISTS worklog_checkout_intent_user_time_idx
  ON worklog_checkout_intents(user_id, created_at);
CREATE INDEX IF NOT EXISTS worklog_checkout_intent_status_time_idx
  ON worklog_checkout_intents(status, created_at);
