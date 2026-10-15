-- 리얀 봇 전용 데이터. Livebrary 기존 테이블과 충돌하지 않도록 riyan_ 접두사를 사용합니다.
CREATE TABLE IF NOT EXISTS riyan_admin_codes (
  week_start DATE PRIMARY KEY,
  encrypted_code TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  posted_message_id TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS riyan_verify_codes (
  id UUID PRIMARY KEY,
  livebrary_user_id TEXT NOT NULL,
  code_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS riyan_verify_codes_user_idx ON riyan_verify_codes (livebrary_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS riyan_links (
  livebrary_user_id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS riyan_attempts (
  discord_user_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(discord_user_id, window_key)
);
CREATE TABLE IF NOT EXISTS riyan_audit (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS riyan_delivery_queue (
  id UUID PRIMARY KEY,
  channel_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS riyan_delivery_due_idx ON riyan_delivery_queue (due_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS riyan_admin_attempts (
  livebrary_user_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (livebrary_user_id, window_key)
);
