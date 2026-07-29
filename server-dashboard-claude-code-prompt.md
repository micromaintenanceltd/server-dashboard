# Claude Code Prompt: MML Server Dashboard

Copy everything below into Claude Code to start the build.

---

## Project brief

Build a server monitoring dashboard for Micro Maintenance Limited (MML), an MSP based in the UK.

We manage around 30 physical servers spread across client sites in the UK. Each server needs a lightweight agent that reports health data back to a central web app. Technicians will log into the web app to view live status across all servers.

## Architecture

**Backend and API**
- Cloudflare Workers for the API layer.
- Cloudflare D1 (SQLite) as the database.
- Durable Objects for live per-server state, so the dashboard can show near real-time status without hammering D1.

**Frontend**
- Next.js with TypeScript and Tailwind CSS.
- Deployed on Cloudflare Pages.
- Should match a clean, professional MSP dashboard look. Dark sidebar, card-based server list, status colour coding (green/amber/red).

**Agent**
- Node.js script that runs as a Windows service on each server.
- Use `node-windows` for service install/uninstall.
- No inbound ports. Agent only makes outbound HTTPS calls.
- Collects data every 5 minutes (configurable) and POSTs to the Worker API.

## Data the agent should collect

- CPU usage (%)
- RAM usage (used/total)
- Disk usage per volume (used/total, % free)
- System uptime
- Running services/processes (key ones we care about, plus flag any critical service that's stopped)
- AV status (Bitdefender GravityZone, agent installed/running, last scan date if available)
- Patch/update status (last update installed date, pending updates count if available)
- Hostname, OS version, local IP

## Authentication

- Per-server API key model.
- Each server is provisioned in the system with a unique API key before the agent is installed.
- Agent sends the key as a Bearer token on every request.
- Worker validates the key against D1 and maps it to the correct server record.
- Build an admin capability to generate, view, and revoke keys per server.

## Database schema (D1) — starting point, adjust as needed

**servers table**
- id (primary key)
- name
- client_name
- location
- api_key_hash
- created_at
- last_seen_at

**server_reports table**
- id (primary key)
- server_id (foreign key)
- cpu_percent
- ram_used_mb
- ram_total_mb
- disk_json (store per-volume disk data as JSON)
- uptime_seconds
- services_json
- av_status
- patch_status
- reported_at

Keep the latest report per server easily queryable, plus enough history for a basic trend view (last 24 hours, last 7 days).

## API routes (Worker)

- `POST /api/report` — agent submits a report. Requires Bearer token.
- `GET /api/servers` — list all servers with latest status. Requires user auth (technician login).
- `GET /api/servers/:id` — detail view for one server, including recent history.
- `POST /api/servers` — admin: create a new server record and generate its API key.
- `DELETE /api/servers/:id` — admin: remove a server.
- `POST /api/servers/:id/rotate-key` — admin: revoke and reissue a key.

## Frontend pages

- Login page (simple auth for technicians, can start with a shared login or basic user table, expand to proper auth later).
- Dashboard: grid/list of all servers, status colour, client name, location, last seen time.
- Server detail page: charts for CPU/RAM/disk over time, service status list, AV and patch status, raw last report.
- Admin page: add/remove servers, view and rotate API keys.

## Non-functional requirements

- Mark a server as "offline" or "stale" if no report received in over 15 minutes.
- Dashboard should auto-refresh (polling every 30-60 seconds is fine to start).
- All timestamps displayed in UK time (Europe/London).
- No em dashes anywhere in UI copy or generated content.
- Code should be clean and commented enough for a small internal team to maintain.

## Build order

1. Set up the Cloudflare Workers project with D1 binding. Build and test the `/api/report` and `/api/servers` routes with dummy data first.
2. Build the Node.js agent as a standalone script that collects the required data and POSTs it. Test it locally against the API.
3. Package the agent as a Windows service using `node-windows`.
4. Build the Next.js frontend on Cloudflare Pages, starting with the dashboard list view, then the detail view.
5. Add authentication for technicians.
6. Add the admin page for managing servers and API keys.
7. Add polish: status colours, auto-refresh, basic charts (a lightweight charting library is fine, keep bundle size sensible).

Ask me clarifying questions before starting if anything above is ambiguous, especially around authentication for technicians and how granular the service/process monitoring needs to be.
