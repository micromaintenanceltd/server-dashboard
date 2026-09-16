; Inno Setup script for the MML Server Agent.
;
; Produces a single setup.exe that:
;   1. asks the technician for the company (client) name,
;   2. installs the agent to Program Files,
;   3. self-enrols the server (auto-detecting the hostname), which creates the
;      dashboard item and writes config.json with this server's key,
;   4. installs and starts the Windows service (via WinSW).
;
; The Worker API URL and the enrollment token are baked in at BUILD time via
; preprocessor defines, so they are NOT stored in this file. build.ps1 passes
; them, e.g:
;   iscc /DApiUrl=https://... /DEnrollToken=<token> /DAppVersion=0.1.0 mml-agent.iss
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
  #define AppVersion "0.1.0"
#endif

#define AppName "MML Server Agent"
#define Publisher "Micro Maintenance Limited"

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
Source: "..\dist\mml-agent.exe";          DestDir: "{app}"; Flags: ignoreversion
Source: "vendor\mml-agent-service.exe";   DestDir: "{app}"; Flags: ignoreversion
Source: "mml-agent-service.xml";          DestDir: "{app}"; Flags: ignoreversion

[Run]
; 1. Enrol this server (creates the dashboard item, writes config.json).
Filename: "{app}\mml-agent.exe"; Parameters: "{code:BuildEnrollArgs}"; \
  StatusMsg: "Registering this server with the dashboard..."; \
  Flags: runhidden waituntilterminated

; 2. Install the Windows service.
Filename: "{app}\mml-agent-service.exe"; Parameters: "install"; \
  StatusMsg: "Installing the MML Server Agent service..."; \
  Flags: runhidden waituntilterminated

; 3. Start it now.
Filename: "{app}\mml-agent-service.exe"; Parameters: "start"; \
  StatusMsg: "Starting the MML Server Agent service..."; \
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
Type: filesandordirs; Name: "{app}\logs"

[Code]
var
  CompanyPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  { A single custom page asking for the client/company name and optional site. }
  CompanyPage := CreateInputQueryPage(wpSelectDir,
    'Client details',
    'Which client does this server belong to?',
    'Enter the company (client) name as it should appear in the dashboard. ' +
    'The server name is detected automatically from this machine.');
  CompanyPage.Add('Company / client name:', False);
  CompanyPage.Add('Location / site (optional):', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  { Require a company name before leaving the custom page. }
  if CurPageID = CompanyPage.ID then
  begin
    if Trim(CompanyPage.Values[0]) = '' then
    begin
      MsgBox('Please enter the company (client) name.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Escape a double quote for a command-line argument (rare, but safe). }
function QuoteArg(const S: String): String;
begin
  Result := '"' + S + '"';
end;

{ Build the full argument string for `mml-agent.exe enroll`. The location flag
  is only included when a location was entered, so an empty value never turns
  into a stray argument. }
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
