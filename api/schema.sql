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
  created_at    TEXT NOT NULL,             -- ISO-8601 UTC
  last_seen_at  TEXT                       -- ISO-8601 UTC of last accepted report
);

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
