<#
.SYNOPSIS
  Keeps a local SSH port-forward to the VPS PostgreSQL alive for local dev tools.
.DESCRIPTION
  Local scraper/web dev tools reach the VPS Postgres through localhost:15432; an ssh
  process started from inside a tool call dies with that call, so this keeper is meant
  to run detached (-Detach) and restarts ssh automatically whenever it exits.
#>

param(
  [int]$LocalPort = 15432,
  [string]$RemoteHost = "localhost",
  [int]$RemotePort = 5432,
  [string]$SshHost = "103.118.16.189",
  [string]$SshUser = "Administrator",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\ipodhan_vps",
  [int]$RestartDelaySeconds = 5,
  [switch]$Detach,
  [switch]$Stop,
  [switch]$Status
)

$ForwardTag = "-L ${LocalPort}:${RemoteHost}:${RemotePort}"
$ScriptName = Split-Path -Leaf $PSCommandPath

function Test-PortOpen {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(2000, $false)
    if ($ok -and $client.Connected) {
      $client.EndConnect($async)
      $client.Close()
      return $true
    }
    $client.Close()
    return $false
  } catch {
    return $false
  }
}

function Get-MatchingProcesses {
  $selfId = $PID
  Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $selfId -and (
      ($_.Name -eq "ssh.exe" -and $_.CommandLine -and $_.CommandLine.Contains($ForwardTag)) -or
      ($_.Name -like "powershell*" -and $_.CommandLine -and $_.CommandLine.Contains($ScriptName) -and $_.CommandLine.Contains("$LocalPort"))
    )
  }
}

if ($Stop) {
  $procs = Get-MatchingProcesses
  if (-not $procs) {
    Write-Host "No keeper or ssh process found for port $LocalPort."
    exit 0
  }
  foreach ($p in $procs) {
    Write-Host "Stopping PID $($p.ProcessId) ($($p.Name))"
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { Write-Host "  failed: $_" }
  }
  exit 0
}

if ($Status) {
  $open = Test-PortOpen -Port $LocalPort
  $procs = Get-MatchingProcesses
  if ($open) {
    Write-Host "Port ${LocalPort}: OPEN"
  } else {
    Write-Host "Port ${LocalPort}: CLOSED"
  }
  if ($procs) {
    foreach ($p in $procs) {
      Write-Host "  PID $($p.ProcessId): $($p.Name)"
    }
  } else {
    Write-Host "  no matching ssh/keeper PIDs"
  }
  if ($open) { exit 0 } else { exit 1 }
}

if ($Detach) {
  $argList = @(
    "-NoProfile", "-File", "`"$PSCommandPath`"",
    "-LocalPort", "$LocalPort",
    "-RemoteHost", "`"$RemoteHost`"",
    "-RemotePort", "$RemotePort",
    "-SshHost", "`"$SshHost`"",
    "-SshUser", "`"$SshUser`"",
    "-KeyPath", "`"$KeyPath`"",
    "-RestartDelaySeconds", "$RestartDelaySeconds"
  )
  $proc = Start-Process -FilePath "powershell" -ArgumentList $argList -WindowStyle Hidden -PassThru
  Write-Host "Started detached tunnel keeper, PID $($proc.Id) (port $LocalPort)"
  exit 0
}

if (-not (Test-Path $KeyPath)) {
  Write-Error "SSH key not found at $KeyPath"
  exit 2
}

while ($true) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] starting ssh tunnel: localhost:$LocalPort -> ${RemoteHost}:${RemotePort} via $SshUser@$SshHost"
  & ssh -i $KeyPath -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -N -L "${LocalPort}:${RemoteHost}:${RemotePort}" "$SshUser@$SshHost"
  $exitCode = $LASTEXITCODE
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] ssh exited (code $exitCode); restarting in $RestartDelaySeconds s"
  Start-Sleep -Seconds $RestartDelaySeconds
}
