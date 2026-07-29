// Shapes returned by the Worker API. Kept loose where the payload is JSON blobs.

export type ServerStatus = 'online' | 'stale' | 'offline' | 'pending';

export interface DiskVolume {
  mount: string;
  used_gb: number;
  total_gb: number;
  free_percent: number;
}

export interface WatchedService {
  name: string;
  display_name?: string;
  running: boolean;
  critical: boolean;
}

export interface ServicesInfo {
  watched?: WatchedService[];
  stopped_critical?: string[];
  top_processes?: { name: string; cpu_percent?: number; mem_mb?: number }[];
}

export interface LatestSummary {
  cpu_percent: number | null;
  ram_used_mb: number | null;
  ram_total_mb: number | null;
  disk: DiskVolume[];
  uptime_seconds: number | null;
  services: ServicesInfo;
  reported_at: string;
}

export interface ServerListItem {
  id: string;
  name: string;
  client_name: string;
  location: string | null;
  status: ServerStatus;
  last_seen_at: string | null;
  api_key_prefix: string | null;
  latest: LatestSummary | null;
}

export interface ServersResponse {
  servers: ServerListItem[];
  stale_after_minutes: number;
}

export interface HistoryPoint {
  cpu_percent: number | null;
  ram_used_mb: number | null;
  ram_total_mb: number | null;
  disk: DiskVolume[];
  reported_at: string;
}

export interface ServerDetail {
  server: {
    id: string;
    name: string;
    client_name: string;
    location: string | null;
    status: ServerStatus;
    last_seen_at: string | null;
    created_at: string;
    api_key_prefix: string | null;
  };
  latest_report: {
    cpu_percent: number | null;
    ram_used_mb: number | null;
    ram_total_mb: number | null;
    disk: DiskVolume[];
    uptime_seconds: number | null;
    services: ServicesInfo;
    av: Record<string, unknown>;
    patch: Record<string, unknown>;
    meta: Record<string, unknown>;
    reported_at: string;
  } | null;
  history: HistoryPoint[];
  stale_after_minutes: number;
}
