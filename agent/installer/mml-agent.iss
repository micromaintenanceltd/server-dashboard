; Inno Setup script for the MML Server Agent.
;
; Fresh install:
;   1. asks the technician for the company (client) name,
;   2. installs the agent to Program Files,
;   3. self-enrols the server (auto-detecting the hostname), which creates the
;      dashboard item and writes config.json with this server's key,
;   4. installs and starts the Windows service (via WinSW).
;
; In-place upgrade (config.json already present, incl. an older install):
;   - no prompts; the existing config.json / key is kept (no re-enrol),
;   - the running service is stopped so its binaries can be replaced,
;   - the service registration is refreshed and started on the new version.
;
; The Worker API URL and the enrollment token are baked in at BUILD time via
; preprocessor defines, so they are NOT stored in this file. build.ps1 passes
; them, e.g:
;   iscc /DApiUrl=https://... /DEnrollToken=<token> /DAppVersion=0.3.0 mml-agent.iss
;
; Requirements in this folder before building (see installer/README.md):
;   ..\dist\mml-agent.exe           (built with `npm run build:exe`)
;   vendor\mml-agent-service.exe    (WinSW binary, renamed)
;   mml-agent-service.xml           (this repo)

#ifndef ApiUrl
  #error You must pass /DApiUrl=<worker url> to iscc (see build.ps1).
#endif
#ifndef EnrollToken
  #error You must pass /DEnrollToken=<token> to iscc (see build.ps1).
#endif
#ifndef AppVersion
  #define AppVersion "0.3.1"
#endif

#define AppName "MML Server Agent"
#define Publisher "Micro Maintenance Limited"
#define ServiceId "MMLServerAgent"

[Setup]
AppId={{4C6F2C1E-3B2A-4E5D-9F7A-2B9E1D6A7C01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={autopf}\MML\Server Agent
DisableProgramGroupPage=yes
DisableDirPage=auto
UninstallDisplayName={#AppName}
; Installing a service and writing to Program Files requires admin.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
OutputDir=Output
OutputBaseFilename=mml-agent-setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Applied to the produced installer by the signing step (see build.ps1).
; SignTool=azuretrustedsigning $f

[Files]
; config.json / state.json / logs are NOT listed here, so an upgrade preserves
; the enrollment and history.
Source: "..\dist\mml-agent.exe";          DestDir: "{app}"; Flags: ignoreversion
Source: "vendor\mml-agent-service.exe";   DestDir: "{app}"; Flags: ignoreversion
Source: "mml-agent-service.xml";          DestDir: "{app}"; Flags: ignoreversion

[Run]
; On upgrade only: remove the old service registration (the service was already
; stopped before files were copied). Skipped on a fresh install.
Filename: "{app}\mml-agent-service.exe"; Parameters: "uninstall"; \
  Check: IsUpgradeCheck; Flags: runhidden waituntilterminated

; Fresh install only: enrol this server (creates the dashboard item, writes
; config.json). Upgrades keep the existing config and key.
Filename: "{app}\mml-agent.exe"; Parameters: "{code:BuildEnrollArgs}"; \
  StatusMsg: "Registering this server with the dashboard..."; \
  Check: NeedsEnrollCheck; Flags: runhidden waituntilterminated

; Install (or re-register) the service on the new binaries, and start it.
Filename: "{app}\mml-agent-service.exe"; Parameters: "install"; \
  StatusMsg: "Installing the MML Server Agent service..."; \
  Flags: runhidden waituntilterminated
Filename: "{app}\mml-agent-service.exe"; Parameters: "start"; \
  StatusMsg: "Starting the MML Server Agent service..."; \
  Flags: runhidden waituntilterminated

; Lock down the install folder so ONLY SYSTEM and local Administrators can read
; it. config.json holds the per-server API key, so standard/RDP users must not
; be able to read it. Well-known SIDs are used (S-1-5-18 = LocalSystem,
; S-1-5-32-544 = Administrators) to avoid localisation issues:
;   /inheritance:r  drop inherited ACEs (removes the default Users: Read)
;   (OI)(CI)F       full control, inherited by files and subfolders
;   /T /C           apply to existing children too, continue past locked files
Filename: "{sys}\icacls.exe"; \
  Parameters: """{app}"" /inheritance:r /grant:r ""*S-1-5-18:(OI)(CI)F"" ""*S-1-5-32-544:(OI)(CI)F"" /T /C"; \
  StatusMsg: "Securing configuration (restricting access to administrators)..."; \
  Flags: runhidden waituntilterminated

[UninstallRun]
; First deregister from the dashboard (removes this server's record), then stop
; and remove the service before files are deleted.
Filename: "{app}\mml-agent.exe";         Parameters: "deregister"; Flags: runhidden waituntilterminated; RunOnceId: "DeregisterMmlAgent"
Filename: "{app}\mml-agent-service.exe"; Parameters: "stop";       Flags: runhidden waituntilterminated; RunOnceId: "StopMmlAgent"
Filename: "{app}\mml-agent-service.exe"; Parameters: "uninstall";  Flags: runhidden waituntilterminated; RunOnceId: "RemoveMmlAgent"

[UninstallDelete]
; Remove generated files the installer did not lay down.
Type: files;          Name: "{app}\config.json"
Type: files;          Name: "{app}\state.json"
Type: filesandordirs; Name: "{app}\logs"

[Code]
var
  CompanyPage: TInputQueryWizardPage;
  NeedsEnroll: Boolean;   { True on a fresh install (no config.json present). }

function ConfigExists(): Boolean;
begin
  Result := FileExists(ExpandConstant('{autopf}\MML\Server Agent\config.json'));
end;

procedure InitializeWizard;
begin
  NeedsEnroll := not ConfigExists();

  CompanyPage := CreateInputQueryPage(wpSelectDir,
    'Client details',
    'Which client does this server belong to?',
    'Enter the company (client) name as it should appear in the dashboard. ' +
    'The server name is detected automatically from this machine.');
  CompanyPage.Add('Company / client name:', False);
  CompanyPage.Add('Location / site (optional):', False);
end;

{ Skip the company prompt on an upgrade. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = CompanyPage.ID) and (not NeedsEnroll);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = CompanyPage.ID) and NeedsEnroll then
  begin
    if Trim(CompanyPage.Values[0]) = '' then
    begin
      MsgBox('Please enter the company (client) name.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Before files are copied, stop any running service so its exe is not locked.
  This is what makes an in-place upgrade possible. Harmless if not installed. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec(ExpandConstant('{sys}\net.exe'), 'stop {#ServiceId}', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
    Sleep(1500);
  end;
end;

function NeedsEnrollCheck(): Boolean;
begin
  Result := NeedsEnroll;
end;

function IsUpgradeCheck(): Boolean;
begin
  Result := not NeedsEnroll;
end;

function QuoteArg(const S: String): String;
begin
  Result := '"' + S + '"';
end;

{ Build the argument string for `mml-agent.exe enroll`. Location is only added
  when entered, so an empty value never becomes a stray argument. }
function BuildEnrollArgs(Param: String): String;
var
  Company, Location, Args: String;
begin
  Company := Trim(CompanyPage.Values[0]);
  Location := Trim(CompanyPage.Values[1]);

  Args := 'enroll' +
          ' --company ' + QuoteArg(Company) +
          ' --api-url ' + QuoteArg('{#ApiUrl}') +
          ' --enroll-token ' + QuoteArg('{#EnrollToken}');

  if Location <> '' then
    Args := Args + ' --location ' + QuoteArg(Location);

  Result := Args;
end;
