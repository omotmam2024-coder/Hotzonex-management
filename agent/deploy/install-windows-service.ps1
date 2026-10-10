# Installs the Hotzonex Router Agent as a Windows service using NSSM (https://nssm.cc).
# Run in PowerShell as Administrator from the agent folder, after:
#   npm install
#   npm run build
# and after filling in .env. Requires nssm.exe on PATH (e.g. `winget install NSSM.NSSM`).

$ErrorActionPreference = 'Stop'
$ServiceName = 'HotzonexAgent'
$AgentDir = (Resolve-Path "$PSScriptRoot\..").Path
$Node = (Get-Command node).Source
$LogDir = Join-Path $AgentDir 'logs'

if (-not (Test-Path (Join-Path $AgentDir 'dist\index.js'))) { throw 'dist\index.js not found. Run "npm run build" first.' }
if (-not (Test-Path (Join-Path $AgentDir '.env'))) { throw '.env not found. Copy .env.example to .env and fill it in.' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  nssm stop $ServiceName | Out-Null
  nssm remove $ServiceName confirm | Out-Null
}

nssm install $ServiceName $Node 'dist\index.js'
nssm set $ServiceName AppDirectory $AgentDir
nssm set $ServiceName DisplayName 'Hotzonex Router Agent'
nssm set $ServiceName Description 'Runs router jobs for Hotzonex Cloud on the local network.'
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppExit Default Restart
nssm set $ServiceName AppRestartDelay 5000
nssm set $ServiceName AppStdout (Join-Path $LogDir 'agent.log')
nssm set $ServiceName AppStderr (Join-Path $LogDir 'agent-error.log')
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 10485760
nssm start $ServiceName

Write-Host "Service $ServiceName installed and started. Logs: $LogDir"
