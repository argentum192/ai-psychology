-- schema.sql
DROP TABLE IF EXISTS performance_metrics;
DROP TABLE IF EXISTS error_logs;
DROP TABLE IF EXISTS chat_logs;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS registration_codes;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
  message TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Index for efficient chat history queries
CREATE INDEX idx_chat_logs_user_timestamp ON chat_logs(user_id, timestamp DESC);

CREATE TABLE registration_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK(level IN ('error', 'warning', 'info')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  user_id INTEGER,
  endpoint TEXT,
  method TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Indexes for efficient error log queries
CREATE INDEX idx_error_logs_level ON error_logs(level);
CREATE INDEX idx_error_logs_category ON error_logs(category);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);

-- Performance metrics table
CREATE TABLE performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_type TEXT NOT NULL CHECK(metric_type IN ('api_response', 'websocket_connection', 'ai_api_call', 'token_usage')),
  endpoint TEXT,
  user_id INTEGER,
  duration_ms INTEGER,
  tokens_used INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  status_code INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Indexes for efficient performance metrics queries
CREATE INDEX idx_performance_metrics_type ON performance_metrics(metric_type);
CREATE INDEX idx_performance_metrics_created_at ON performance_metrics(created_at DESC);
CREATE INDEX idx_performance_metrics_endpoint ON performance_metrics(endpoint);
CREATE INDEX idx_performance_metrics_user_id ON performance_metrics(user_id);

-- ============================================================
-- DATA RETENTION POLICY
-- ============================================================
-- The following queries can be used to implement data retention:
--
-- 1. Clean up old chat logs (keep last 90 days):
--    DELETE FROM chat_logs WHERE timestamp < datetime('now', '-90 days');
--
-- 2. Clean up old error logs (keep last 90 days):
--    DELETE FROM error_logs WHERE created_at < datetime('now', '-90 days');
--
-- 3. Clean up old performance metrics (keep last 30 days):
--    DELETE FROM performance_metrics WHERE created_at < datetime('now', '-30 days');
--
-- 4. Alternative: Archive old data before deletion
--    You can create archive tables and move old data there before deletion
--
-- IMPLEMENTATION OPTIONS:
-- - Use Cloudflare Workers Cron Triggers to run cleanup daily/weekly
-- - Add cleanup logic in your application code
-- - Manually run cleanup queries periodically
-- ============================================================