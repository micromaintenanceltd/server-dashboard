-- MML Server Dashboard: D1 (SQLite) schema.
-- Run with:  npm run db:init:local   (or db:init:remote for production)

-- Servers roster. One row per monitored server.
CREATE TABLE IF NOT EXISTS servers (
  id            TEXT PRIMARY KEY,          -- uuid string
  name          TEXT NOT NULL,
  client_name   TEXT NOT NULL,
  location      TEXT,
  api_key_hash  TEXT NOT NULL,             -- SHA-256 hex of the raw key; raw key is shown once at creation
  api_key_prefix TEXT,                     -- first few chars of the raw key, for display/identification only
  current_status TEXT NOT NULL DEFAULT 'pending', -- online | stale | offline | pending
  desired_state TEXT NOT NULL DEFAULT 'active',   -- active | decommission (admin asked the agent to self-uninstall)
  created_at    TEXT NOT NULL,             -- ISO-8601 UTC
  last_seen_at  TEXT                       -- ISO-8601 UTC of last accepted report
);

-- For existing databases, add the column with:
--   ALTER TABLE servers ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'active';

-- Fast lookup of a server by its key hash during report auth.
CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_api_key_hash ON servers(api_key_hash);

-- Full report history. The latest per server is queryable by reported_at.
CREATE TABLE IF NOT EXISTS server_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL,
  cpu_percent   REAL,
  ram_used_mb   INTEGER,
  ram_total_mb  INTEGER,
  disk_json     TEXT,                       -- JSON array of per-volume objects
  uptime_seconds INTEGER,
  services_json TEXT,                       -- JSON array of watched services + summary
  av_status     TEXT,                       -- JSON blob of AV info
  patch_status  TEXT,                       -- JSON blob of patch info
  meta_json     TEXT,                       -- JSON: hostname, os_version, local_ip, agent_version
  reported_at   TEXT NOT NULL,              -- ISO-8601 UTC
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

-- History queries for a single server ordered by time (trend views).
CREATE INDEX IF NOT EXISTS idx_reports_server_time
  ON server_reports(server_id, reported_at DESC);

-- Weekly check runs. Separate from the 5-minute telemetry above: each row is
-- one scheduled audit that produced pass/warn/fail findings.
CREATE TABLE IF NOT EXISTS check_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id      TEXT NOT NULL,
  overall_status TEXT NOT NULL,             -- pass | warn | fail
  pass_count     INTEGER NOT NULL DEFAULT 0,
  warn_count     INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  results_json   TEXT NOT NULL,             -- JSON array of {id,title,status,detail,value}
  agent_version  TEXT,
  run_at         TEXT NOT NULL,             -- ISO-8601 UTC
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

-- Latest / historical check runs for a server.
CREATE INDEX IF NOT EXISTS idx_check_runs_server_time
  ON check_runs(server_id, run_at DESC);
