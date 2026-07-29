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
  // Secret bearer token required for admin routes (create/delete/rotate).
  ADMIN_TOKEN: string;
  // Secret bearer token that the installer uses to self-enrol a new server.
  // Separate from ADMIN_TOKEN: it can only create a server record and receive
  // that server's reporting key. It cannot read data or manage servers.
  ENROLL_TOKEN: string;
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
  created_at: string;
  last_seen_at: string | null;
}

export type ServerStatus = 'online' | 'stale' | 'offline' | 'pending';

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
  meta: ReportMeta;
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
