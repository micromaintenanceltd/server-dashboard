# MML Server Dashboard

Server monitoring for Micro Maintenance Limited. A lightweight agent runs on each
client server, reports health data over outbound HTTPS to a Cloudflare Worker API,
and technicians view live status in a Next.js dashboard.

## Components

| Folder  | What it is | Stack |
| ------- | ---------- | ----- |
| `api/`  | The API and data store | Cloudflare Worker (Hono) + D1 (SQLite) + Durable Objects |
| `agent/`| Per-server data collector, runs as a Windows service | Node.js + node-windows |
| `web/`  | Technician dashboard | Next.js + TypeScript + Tailwind, static export for Cloudflare Pages |

### How it fits together

```
 Windows server                Cloudflare                      Browser (office)
+----------------+       +------------------------+        +--------------------+
|  MML agent     |  HTTPS |  Worker API (Hono)    |        |  Next.js dashboard |
|  (node-windows)| -----> |  POST /api/report      |        |  (Cloudflare Pages)|
|  every 5 min   |  Bearer|                        | <----- |  GET /api/servers  |
+----------------+  key   |  D1  <--- history      |  IP    |  polls every 30s   |
                          |  Durable Objects <-- live state + stale alarm        |
                          +------------------------+        +--------------------+
```

- **Agent auth:** each server has a unique API key. The agent sends it as a Bearer
  token on every report. The Worker stores only a SHA-256 hash of the key.
- **Dashboard access:** there is no technician login. The read/admin routes are
  restricted by an **IP allowlist** (your office WAN IP), configurable without code
  changes. See [Locking down access](#locking-down-access).
- **Admin actions** (create/delete/rotate keys) additionally require an admin token.
- **Live state + offline detection:** each server has a Durable Object holding its
  latest snapshot and an alarm. If no report arrives within `STALE_AFTER_MINUTES`
  (default 15) the server is marked offline. The dashboard also computes
  online/stale/offline live from the last-seen time.

## Data collected each cycle

CPU %, RAM used/total, disk usage per volume, uptime, watched services (with any
stopped critical service flagged), Bitdefender GravityZone AV status, Windows patch
status (last update + pending count), and host metadata (hostname, OS, local IP).

## Weekly checks

Alongside the 5-minute telemetry, the agent runs a weekly audit (default Monday
07:00 UK, catch-up if the server was off). Each check returns pass / warn / fail:
Windows Server Backup success, required services running, disk space, pending
updates, last update installed, antivirus, pending reboot, Windows Firewall, and
event-log error volume. Results appear on the dashboard per server (list badge
and a detail panel). Checks are configurable and the required-services list is
per server. See [agent/INSTALL.md](agent/INSTALL.md).

## Local settings page

While the service runs it serves a settings page on `http://127.0.0.1:8000`
(loopback only). A technician on the server can adjust what that server reports:
connection, interval, watched services, the weekly check schedule, which checks
run and their thresholds. It is not reachable from the network; the central hub
cannot change any server.

---

## Local development

You need Node.js 18+ (tested on 24) and npm. Everything runs locally with no
Cloudflare account required (wrangler uses a local SQLite file).

### 1. API

```bash
cd api
npm install
cp .dev.vars.example .dev.vars      # local admin token etc. (already present)
npm run db:init:local               # create the local D1 schema
npm run dev                         # wrangler dev on http://localhost:8787
```

Quick check:

```bash
curl http://localhost:8787/api/health
```

Create a server and grab its key (uses the local admin token from `.dev.vars`):

```bash
curl -X POST http://localhost:8787/api/servers \
  -H "Authorization: Bearer local-dev-admin-token-change-me" \
  -H "Content-Type: application/json" \
  -d '{"name":"DC01","client_name":"Acme Ltd","location":"Leeds HQ"}'
```

### 2. Agent

```bash
cd agent
npm install
cp config.example.json config.json  # then paste apiUrl + the key from above
npm run once                        # collect one report and print it (dry run)
npm run once -- --send              # collect and POST it to the API
npm start                           # run the loop (report now, then every interval)
```

`config.json` holds `apiUrl`, `apiKey`, `intervalMinutes`, the AV product/service
names, and the `watchServices` critical-service watchlist.

### 3. Web dashboard

```bash
cd web
npm install
# .env.local already points NEXT_PUBLIC_API_BASE at http://localhost:8787
npm run dev                         # http://localhost:3000
```

Open http://localhost:3000. On the Admin page, paste the admin token
(`local-dev-admin-token-change-me` locally) once, then add servers and manage keys.

---

## Deploying to Cloudflare

> Not required for local work. Do this when you are ready to go live.

### API (Worker + D1)

```bash
cd api
npx wrangler d1 create mml_dashboard          # paste the returned id into wrangler.toml
npm run db:init:remote                         # create the schema in the real DB
npx wrangler secret put ADMIN_TOKEN            # set a strong admin token
npx wrangler secret put ENROLL_TOKEN           # set the installer's enrollment token
# Set the IP allowlist (comma separated WAN IPs / CIDRs) in wrangler.toml [vars]
npm run deploy
```

Note the deployed Worker URL (e.g. `https://mml-dashboard-api.<sub>.workers.dev`).

### Web (Pages)

Set `NEXT_PUBLIC_API_BASE` to the Worker URL, then:

```bash
cd web
NEXT_PUBLIC_API_BASE=https://mml-dashboard-api.<sub>.workers.dev npm run build
npx wrangler pages deploy out --project-name mml-dashboard
```

(Or connect the repo in the Cloudflare Pages dashboard with build command
`npm run build`, output directory `out`, and the `NEXT_PUBLIC_API_BASE` env var.)

### Agent on each server (signed installer + auto-enrollment)

Build the signed installer once, then run it on each server. Full detail in
[agent/installer/README.md](agent/installer/README.md) and
[agent/INSTALL.md](agent/INSTALL.md).

Build (on your build machine, with Inno Setup, WinSW, and Azure Trusted Signing
set up):

```powershell
cd agent\installer
$env:MML_API_URL      = "https://mml-dashboard-api.<sub>.workers.dev"
$env:MML_ENROLL_TOKEN = "<the ENROLL_TOKEN you set on the Worker>"
.\build.ps1 -Version 0.1.0 -Sign
```

Install (on each server): run `mml-agent-setup-<version>.exe`, enter the client
company name when prompted (the hostname is detected automatically), and finish.
The installer self-enrolls the server, which **creates the dashboard item**,
writes its unique key to `config.json`, and installs and starts the service. The
server appears on the dashboard within a minute.

The agent makes outbound HTTPS only. No inbound ports are opened. See
[agent/INSTALL.md](agent/INSTALL.md) for the from-source/dev path.

---

## Locking down access

There is no technician login. Protect the dashboard by IP:

1. **API (Worker):** set `DASHBOARD_IP_ALLOWLIST` in `wrangler.toml` to your office
   WAN IP(s) or CIDR range(s), comma separated, e.g. `203.0.113.10, 198.51.100.0/24`.
   The `/api/report` route is exempt (agents connect from client sites and use their
   Bearer key). An empty allowlist allows all (local dev only).
2. **Pages (static site):** the Worker allowlist does not cover the static assets
   served by Pages. Restrict the Pages site too, either with a **Cloudflare Access**
   policy (Zero Trust > Access > Applications, add an IP-range rule so matching IPs
   pass with no login prompt) or a **WAF custom rule** blocking all but your WAN IP.

If your office IP is dynamic, prefer Cloudflare Access with email one-time-pin as a
simple login instead. The code is structured so a proper user table can be added
later without reworking the API.

---

## API reference

| Method | Route | Auth | Purpose |
| ------ | ----- | ---- | ------- |
| POST   | `/api/report` | Server Bearer key | Agent submits a 5-minute health report |
| POST   | `/api/checks` | Server Bearer key | Agent submits a weekly check run |
| POST   | `/api/enroll` | Enroll token | Installer self-registers a server, gets its key |
| GET    | `/api/servers` | IP allowlist | List servers + latest status |
| GET    | `/api/servers/:id` | IP allowlist | One server + 7-day history |
| POST   | `/api/servers` | IP + admin token | Create a server, generate a key |
| DELETE | `/api/servers/:id` | IP + admin token | Remove a server (and its history) |
| POST   | `/api/servers/:id/rotate-key` | IP + admin token | Revoke and reissue a key |

`/api/report` and `/api/enroll` are the only routes exempt from the IP allowlist,
because agents and installers connect from client sites. Both use their own
bearer tokens instead.

## Notes

- All timestamps display in UK time (Europe/London), handling GMT/BST automatically.
- History is kept per report; the detail view charts the last 7 days.
- API keys are shown once at creation/rotation and never stored in recoverable form.
