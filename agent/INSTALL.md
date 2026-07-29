# MML Server Agent: how it works and how to install it

This is the lightweight agent that runs on each monitored server. It collects
health data and sends it to the dashboard API. It does nothing else.

## How it works (exactly)

### One direction only

Communication is strictly **server to cloud**. The agent makes outbound HTTPS
`POST` requests and nothing else:

- It opens **no inbound ports** and runs **no listener**. Nothing on the network
  can connect to it or send it commands.
- The API's reply is used **only** to check whether the request was accepted (the
  HTTP status code) and to write a log line. The response body is never parsed as
  instructions and is never executed. See `src/report.js`.
- The only local commands the agent ever runs are a fixed set of **read-only**
  PowerShell queries hardcoded in the source (`Get-CimInstance`, `Get-Service`,
  `Get-Process`, and a Windows Update *search*). None come from the API, and none
  change anything on the server.

Result: the dashboard and API **cannot make any change to a monitored server**.
There is no channel for it to do so. If the cloud side were fully compromised,
the worst it could do to a server is stop receiving its reports.

This holds for enrollment too (below): enrollment is the agent making an outbound
call and *storing* the key it gets back in its own config file. Nothing from the
API is executed.

### What happens each cycle

1. On start, and then every `intervalMinutes` (default 5), the agent gathers:
   - CPU %, RAM used/total, uptime
   - Disk usage per fixed volume (used/total, % free)
   - Each service in the `watchServices` watchlist, flagging any critical one
     that is not running
   - Bitdefender GravityZone status (installed / running, best-effort last scan)
   - Windows patch status (last update installed, pending update count)
   - Hostname, OS version, local IP
2. It `POST`s that JSON to `POST /api/report`, with its unique API key as a
   `Bearer` token.
3. The Worker validates the key, stores the report, and updates live status.
4. Each collector is best-effort: a failed query nulls just that field; a failed
   send is logged and retried next cycle. The loop never crashes the service.

### Authentication and enrollment

Each server has its **own** API key. Reporting always uses that per-server key,
which the Worker stores only as a SHA-256 hash (never recoverable). If a key is
exposed, rotate it from the Admin page; the old key dies immediately and you
re-run the installer (or edit `config.json`) on that one server.

The key is obtained **automatically at install time** by enrollment:

- The installer carries a shared **enrollment token** and the Worker URL (baked
  in when the installer is built, not stored in the repo).
- During install the agent calls `POST /api/enroll` with that token plus the
  **company name** you typed and the machine's **hostname**.
- The Worker creates the dashboard record and returns this server's unique
  reporting key, which the agent writes into `config.json`. The enrollment token
  is not written to disk.
- The enrollment token can only create a server record and hand back a key. It
  cannot read dashboard data or manage servers, and it is rate limited.

### The single executable

Everything is one file, `mml-agent.exe` (Node is bundled in), with subcommands:

| Command | Who runs it | What it does |
| ------- | ----------- | ------------ |
| `mml-agent.exe enroll --company "X" --api-url <url> --enroll-token <tok>` | the installer | Registers the server, writes `config.json` |
| `mml-agent.exe run` | the Windows service | The reporting loop |
| `mml-agent.exe once [--send]` | you, for diagnostics | Collect one report, print it, optionally send |

### Running as a Windows service

The installed product uses **WinSW** (`mml-agent-service.exe` + a matching
`.xml`) to run `mml-agent.exe run` as a service. The service:

- starts automatically at boot, no logged-in user needed,
- restarts itself if the process exits unexpectedly,
- writes rolling logs to a `logs\` folder in the install directory,
- runs as `LocalSystem`, which is what lets it read service state and the Windows
  Update history. That is local read access only; it opens no inbound network
  access.

---

## Installing on a server (the normal way)

Use the signed installer. One file, no Node install, no manual config.

### Prerequisites

- The signed `mml-agent-setup-<version>.exe` (from the build box, see
  `installer/README.md`).
- The company (client) name for this server.
- Outbound HTTPS (443) to the Worker URL allowed. No inbound rules needed.

### Steps

1. Copy `mml-agent-setup-<version>.exe` to the server and run it (it will prompt
   for elevation; installing a service needs admin).
2. Click through the wizard. On the **Client details** page, enter the company
   (client) name and, optionally, the site/location. The server name is detected
   automatically.
3. Finish. The installer registers the server, then installs and starts the
   service.
4. Within a minute the server appears on the dashboard and goes **Online**.

### Verify

- `Get-Service "MML Server Agent"` shows `Running`.
- The server is listed on the dashboard (it appears immediately as Pending on
  enrollment, then Online after the first report).
- Logs are in `C:\Program Files\MML\Server Agent\logs\` if needed.

### Re-running the installer

Running it again on the same server for the same company re-provisions it: it
reuses the same dashboard record and issues a fresh key. Safe for repair or
upgrade.

### Tuning the watchlist

The installer writes a sensible default `config.json` (Bitdefender + common
services). To watch client-specific services (SQL, a backup agent, a line-of-
business service), edit `C:\Program Files\MML\Server Agent\config.json` and add
entries to `watchServices` using the exact Windows **service name** (not the
display name), then restart the service:

```powershell
Restart-Service "MML Server Agent"
```

### Uninstalling

Uninstall "MML Server Agent" from Apps & features (or Programs and Features).
That stops and removes the service and deletes the files. It does not remove the
server's record from the dashboard; delete that on the Admin page if you want it
gone.

---

## Appendix: running from source (development only)

For local development you can run the agent directly with Node instead of the
packaged exe. This path uses `node-windows` for the service and a hand-filled
`config.json` (no enrollment).

```bash
cd agent
npm install
copy config.example.json config.json   # set apiUrl + a key (from the Admin page)
npm run once            # collect one report, print it (no send)
npm run once -- --send  # collect and send one
npm run run:agent       # run the loop in the foreground
```

You can also self-enrol from source instead of pasting a key:

```bash
npm run enroll -- --company "Acme Ltd" --api-url http://localhost:8787 --enroll-token <token>
```

To install as a service from source (dev), from an Administrator prompt:

```bash
npm run install-service      # node-windows; logs in agent\daemon\
npm run uninstall-service
```

---

## Quick troubleshooting

| Symptom | Check |
| ------- | ----- |
| Server never appears on the dashboard | On the server, run `"C:\Program Files\MML\Server Agent\mml-agent.exe" once --send` and read the error. Usually blocked outbound 443 or a wrong Worker URL. |
| Enrollment failed during install | The enrollment token or API URL baked into the installer is wrong or the token was rotated. Rebuild the installer with the current values. |
| Shows Online then goes Stale/Offline | Service stopped or the machine lost outbound access. Check `Get-Service "MML Server Agent"` and the `logs\` folder. |
| A watched service shows Stopped but is running | Use the exact Windows service **name** in `config.json` (e.g. `MSSQLSERVER`). `Get-Service` shows real names. |
| AV last scan shows "not available" | Expected. GravityZone does not expose a reliable local last-scan value on Server OS; installed/running status is still reported. |
