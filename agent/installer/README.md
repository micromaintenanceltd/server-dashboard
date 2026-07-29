# Building the signed MML Server Agent installer

This folder builds `mml-agent-setup-<version>.exe`: a single signed installer a
technician runs on a server. It asks for the **company name**, auto-detects the
**hostname**, self-enrolls the server (which **creates the dashboard item**),
writes `config.json`, and installs the Windows service.

```
installer/
  mml-agent.iss             Inno Setup script (wizard + install steps)
  mml-agent-service.xml     WinSW service definition
  build.ps1                 Build + sign orchestration
  vendor/                   Put the WinSW binary here (not committed)
  Output/                   Compiled installer lands here
```

## How the installed product is structured

The installer lays down three files in `C:\Program Files\MML\Server Agent`:

| File | What it is |
| ---- | ---------- |
| `mml-agent.exe` | The agent itself (Node bundled in by pkg). Subcommands: `enroll`, `run`, `once`. |
| `mml-agent-service.exe` | WinSW service wrapper (runs `mml-agent.exe run` as a service). |
| `mml-agent-service.xml` | WinSW config: service name, auto-start, restart-on-failure, log rolling. |

At install time it also creates `config.json` (from enrollment) and a `logs\`
folder. The service runs as LocalSystem so it can read service state and Windows
Update history. It still makes **outbound HTTPS only** and opens no inbound port.

## One-time prerequisites on the build machine

1. **Node + pkg** already handled by the agent's `npm install` (dev dependency
   `@yao-pkg/pkg`).

2. **WinSW binary.** Download `WinSW-x64.exe` from
   https://github.com/winsw/winsw/releases, rename it to
   `mml-agent-service.exe`, and place it in `installer/vendor/`. WinSW is a
   widely used, permissively licensed service wrapper. (You may also sign this
   binary with your own certificate if you want the whole payload signed.)

3. **Inno Setup 6.** Install from https://jrsoftware.org/isdl.php. `ISCC.exe`
   should be on PATH or at `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`.

4. **Azure Trusted Signing** (for signing). Set up a Trusted Signing account and
   certificate profile in Azure, then install the signing tooling:
   - the Windows SDK (provides `signtool.exe`), and
   - the Trusted Signing dlib (`Azure.CodeSigning.Dlib.dll`) plus a metadata
     JSON describing your account. See Microsoft's Trusted Signing docs.
   - The build machine authenticates to Azure (e.g. `az login` or a service
     principal with the Trusted Signing Certificate Profile Signer role).

   The metadata JSON looks like:

   ```json
   {
     "Endpoint": "https://weu.codesigning.azure.net/",
     "CodeSigningAccountName": "mml-signing",
     "CertificateProfileName": "mml-agent"
   }
   ```

## Building

Set the deploy-specific values (kept out of source control) and run the build:

```powershell
$env:MML_API_URL      = "https://mml-dashboard-api.<your-subdomain>.workers.dev"
$env:MML_ENROLL_TOKEN = "<the ENROLL_TOKEN you set on the Worker>"

# Unsigned (for testing the flow):
.\build.ps1 -Version 0.1.0

# Signed with Azure Trusted Signing:
$env:MML_ATS_DLIB     = "C:\path\to\Azure.CodeSigning.Dlib.dll"
$env:MML_ATS_METADATA = "C:\path\to\metadata.json"
.\build.ps1 -Version 0.1.0 -Sign
```

The `ENROLL_TOKEN` and API URL are baked into the installer at compile time via
Inno preprocessor defines. They are never written into the repo. The enrollment
token does live inside the distributed `setup.exe` (this is the accepted
trade-off for hands-off enrollment); treat the installer as sensitive, rotate
the token periodically with `wrangler secret put ENROLL_TOKEN`, and rebuild.

## What the technician sees

1. Runs `mml-agent-setup-<version>.exe` (a signed installer, so SmartScreen is
   satisfied and no publisher warning appears).
2. Clicks through, enters the **company name** (and optional location) on the
   Client details page.
3. Installer registers the server, installs and starts the service.
4. Within a minute the server appears on the dashboard and goes Online.

## Notes on signing scope

- Signing the **installer** is what stops SmartScreen warning end users, and is
  the main requirement.
- Optionally sign `mml-agent.exe` too (build.ps1 does this with `-Sign`) so the
  on-disk service binary is also signed.
- `mml-agent-service.exe` (WinSW) is third-party; sign it yourself if you want
  every shipped binary to carry your signature.
