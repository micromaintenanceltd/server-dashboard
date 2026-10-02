// Shared types and the Worker environment bindings.

export interface Env {
  // D1 database binding (see wrangler.toml).
  DB: D1Database;
  // Durable Object namespace for per-server live state.
  SERVER_STATE: DurableObjectNamespace;
  // Durable Object namespace for the enrollment rate limiter (single instance).
  ENROLL_LIMITER: DurableObjectNamespace;
  // Comma separated WAN IPs / CIDR ranges allowed to hit tech + admin routes.
  DASHBOARD_IP_ALLOWLIST: string;
  // Minutes without a report before a server is considered stale/offline.
  STALE_AFTER_MINUTES: string;
  // Secret bearer token that the installer uses to self-enrol a new server.
  // It can only create a server record and receive that server's reporting key.
  // It cannot read data or manage servers.
  ENROLL_TOKEN: string;

  // --- Built-in login (dashboard users) ---
  // Secret used to sign session/MFA tokens (HS256). Keep it long and random.
  AUTH_SECRET: string;
  // One-time secret that authorises creating the very first admin account via
  // POST /api/auth/setup (only works while there are no users yet).
  BOOTSTRAP_TOKEN: string;

  // Shared password a technician must enter on an agent's local settings page
  // (127.0.0.1:8000) to save changes. The agent verifies it against this via
  // POST /api/verify-settings-password, so it lives only here, not on agents.
  // Optional: if unset, agents cannot authorise local settings changes.
  SETTINGS_PASSWORD?: string;

  // Secret bearer token used by the release publisher (build.ps1 -Publish) to
  // register a newly-built agent version in the dashboard. Publishing records
  // the version/URL/SHA-256 as PENDING; an admin approves it in the dashboard
  // before any server installs it. Optional: if unset, publishing is disabled.
  RELEASE_TOKEN?: string;
}

// A server row as stored in D1.
export interface ServerRow {
  id: string;
  name: string;
  client_name: string;
  location: string | null;
  api_key_hash: string;
  api_key_prefix: string | null;
  current_status: ServerStatus;
  desired_state: DesiredState;
  created_at: string;
  last_seen_at: string | null;
}

export type ServerStatus = 'online' | 'stale' | 'offline' | 'pending';
export type DesiredState = 'active' | 'decommission';

// The payload an agent POSTs to /api/report.
export interface ReportPayload {
  cpu_percent: number;
  ram_used_mb: number;
  ram_total_mb: number;
  disk: DiskVolume[];
  uptime_seconds: number;
  services: ServiceInfo;
  av: AvStatus;
  patch: PatchStatus;
  pings?: PingResult[];
  meta: ReportMeta;
}

// One LAN ping-monitor result.
export interface PingResult {
  name: string;
  host: string;
  ok: boolean;
  rtt_ms?: number | null;
}

export interface DiskVolume {
  mount: string; // e.g. "C:"
  used_gb: number;
  total_gb: number;
  free_percent: number;
}

export interface ServiceInfo {
  // The watched services and their state.
  watched: WatchedService[];
  // Any watched service that is critical and not running.
  stopped_critical: string[];
  // Optional light summary of top processes.
  top_processes?: { name: string; cpu_percent?: number; mem_mb?: number }[];
}

export interface WatchedService {
  name: string;
  display_name?: string;
  running: boolean;
  critical: boolean;
}

export interface AvStatus {
  product: string; // e.g. "Bitdefender GravityZone"
  installed: boolean;
  running: boolean;
  last_scan?: string | null; // ISO date if known
  notes?: string;
}

export interface PatchStatus {
  last_update_installed?: string | null; // ISO date if known
  pending_updates?: number | null;
  notes?: string;
}

export interface ReportMeta {
  hostname: string;
  os_version: string;
  local_ip: string;
  agent_version?: string;
}

// --- Weekly checks ---

export type CheckStatus = 'pass' | 'warn' | 'fail';

// One finding within a check run.
export interface CheckResult {
  id: string; // stable check id, e.g. "windows-server-backup"
  title: string; // human label, e.g. "Windows Server Backup"
  status: CheckStatus;
  detail: string; // short human explanation of the result
  value?: unknown; // optional structured value (numbers, dates, lists)
}

// The payload an agent POSTs to /api/checks for a weekly run.
export interface CheckRunPayload {
  results: CheckResult[];
  run_at?: string; // agent-side time; the API stamps its own too
  agent_version?: string;
}
