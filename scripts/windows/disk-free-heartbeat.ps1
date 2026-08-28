###############################################################################
# IPODhan - DB host disk-free heartbeat (Windows PowerShell)
#
# Why this exists: the Windows VPS 103.118.16.189 is the ONLY Postgres host for
# every app. Twice (2026-06-13 issue #15, 2026-08-28) it filled to zero and the
# first signal was production writes failing with "No space left on device".
# Nothing watched the drive. This is that watch.
#
# Usage:
#   .\scripts\windows\disk-free-heartbeat.ps1                  # measure + page
#   .\scripts\windows\disk-free-heartbeat.ps1 -SelfTest        # fixture tests
#   .\scripts\windows\disk-free-heartbeat.ps1 -Register        # install task
#   .\scripts\windows\disk-free-heartbeat.ps1 -FreeGbOverride 2.5 -DryRun
#
# Exit codes: 0 = ran (any severity), 1 = self-test failed, 2 = measure failed.
###############################################################################

param(
    [string]$Drive = 'C',
    [double]$P1Gb = 10,
    [double]$P0Gb = 3,
    [Nullable[double]]$FreeGbOverride = $null,
    [switch]$SelfTest,
    [switch]$Register,
    [switch]$DryRun,
    [string]$StateFile = "$env:ProgramData\IPODhan\disk-free-state.json"
)

$ErrorActionPreference = 'Stop'

# --- pure classification: the one place thresholds are decided -------------
function Get-DiskSeverity {
    param([double]$FreeGb, [double]$P1Gb, [double]$P0Gb)
    if ($FreeGb -lt $P0Gb) { return 'P0' }
    if ($FreeGb -lt $P1Gb) { return 'P1' }
    return 'info'
}

# info is a daily heartbeat; P1/P0 page once per severity per day
function Get-DedupeKey {
    param([string]$Severity, [datetime]$Now)
    return "disk-free-{0}-{1}" -f $Severity, $Now.ToString('yyyy-MM-dd')
}

if ($SelfTest) {
    $fail = 0
    $cases = @(
        @{ free = 0.02; p1 = 10; p0 = 3; want = 'P0'   ; why = '2026-08-28 real value (19.8 MB)' },
        @{ free = 1.35; p1 = 10; p0 = 3; want = 'P0'   ; why = 'post-relief value, still critical' },
        @{ free = 2.99; p1 = 10; p0 = 3; want = 'P0'   ; why = 'just under P0 floor' },
        @{ free = 3.00; p1 = 10; p0 = 3; want = 'P1'   ; why = 'exactly at P0 floor is not P0' },
        @{ free = 9.99; p1 = 10; p0 = 3; want = 'P1'   ; why = 'just under P1' },
        @{ free = 10.0; p1 = 10; p0 = 3; want = 'info' ; why = 'exactly at P1 is healthy' },
        @{ free = 60.0; p1 = 10; p0 = 3; want = 'info' ; why = 'healthy' }
    )
    foreach ($c in $cases) {
        $got = Get-DiskSeverity -FreeGb $c.free -P1Gb $c.p1 -P0Gb $c.p0
        if ($got -ne $c.want) { "FAIL free=$($c.free) want=$($c.want) got=$got  ($($c.why))"; $fail++ }
        else { "ok   free=$($c.free) -> $got  ($($c.why))" }
    }
    $k1 = Get-DedupeKey -Severity 'P0' -Now ([datetime]'2026-08-28T01:00:00')
    $k2 = Get-DedupeKey -Severity 'P0' -Now ([datetime]'2026-08-28T23:00:00')
    $k3 = Get-DedupeKey -Severity 'P0' -Now ([datetime]'2026-08-29T01:00:00')
    if ($k1 -ne $k2) { "FAIL dedupe key changed within the same day: $k1 vs $k2"; $fail++ } else { "ok   dedupe stable within a day: $k1" }
    if ($k1 -eq $k3) { "FAIL dedupe key did not roll over to the next day: $k1"; $fail++ } else { "ok   dedupe rolls over next day: $k3" }
    if ($fail -gt 0) { "SELF-TEST FAILED ($fail)"; exit 1 }
    "SELF-TEST PASSED ($($cases.Count + 2) assertions)"; exit 0
}

if ($Register) {
    $me = $MyInvocation.MyCommand.Path
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$me`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
    $principal = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType S4U -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName 'IPODhan-DiskFree' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    "Registered scheduled task IPODhan-DiskFree (every 15 min, S4U Administrator)"
    exit 0
}

# --- measure ---------------------------------------------------------------
if ($null -ne $FreeGbOverride) {
    $freeGb = [double]$FreeGbOverride
    $source = 'override'
} else {
    try {
        $d = Get-PSDrive $Drive -ErrorAction Stop
        $freeGb = [math]::Round($d.Free / 1GB, 3)
        $source = 'measured'
    } catch {
        # A measure failure is itself a signal - never report 0 free as if measured.
        Write-Error "could not read drive ${Drive}: $($_.Exception.Message)"
        exit 2
    }
}

$severity = Get-DiskSeverity -FreeGb $freeGb -P1Gb $P1Gb -P0Gb $P0Gb
$now = Get-Date
$dedupeKey = Get-DedupeKey -Severity $severity -Now $now

# --- persist for the nightly audit (read even when the Notifier is down) ----
try {
    $stateDir = Split-Path $StateFile -Parent
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    [pscustomobject]@{
        drive          = $Drive
        free_gb        = $freeGb
        severity       = $severity
        measured_at    = $now.ToUniversalTime().ToString('o')
        source         = $source
        p1_threshold   = $P1Gb
        p0_threshold   = $P0Gb
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
} catch {
    Write-Host "[STATE-FAIL] could not write ${StateFile}: $($_.Exception.Message)"
}

"$($now.ToString('yyyy-MM-dd HH:mm:ss'))  ${Drive}: free=${freeGb} GB  severity=$severity  source=$source"

# info severity pages at most once a day; P0/P1 page every run (Notifier dedupes)
if ($severity -eq 'info') {
    $stamp = "$env:ProgramData\IPODhan\disk-free-last-info.txt"
    $today = $now.ToString('yyyy-MM-dd')
    if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $today)) {
        "info heartbeat already sent today - not paging"
        exit 0
    }
    Set-Content -Path $stamp -Value $today -Encoding UTF8
}

$body = @{
    project   = 'ipodhan'
    severity  = $severity
    type      = 'disk-free'
    title     = "DB host ${Drive}: ${freeGb} GB free"
    body      = "Windows VPS 103.118.16.189 (only Postgres host). ${Drive}: ${freeGb} GB free. Thresholds: P1 < ${P1Gb} GB, P0 < ${P0Gb} GB. Runbook: docs/16-database/db-host-disk.md"
    dedupeKey = $dedupeKey
} | ConvertTo-Json -Compress

if ($DryRun) { "[DRY-RUN] would POST: $body"; exit 0 }

# --- page (fail-open: a Notifier outage must never break the box) ----------
# A scheduled task does NOT inherit an interactive user's environment, so fall back to
# GLOBAL.env (the box's credential SSOT). Without this the task would run every 15 minutes
# and silently never page - a monitor that cannot alert is worse than no monitor, because
# its green looks like health.
$key = $env:NOTIFIER_KEY_IPODHAN
$url = $env:NOTIFIER_URL
$fallbackKey = $null
if (-not $key -or -not $url) {
    foreach ($p in @('C:\Abhay\GLOBAL.env', 'D:\Abhay\GLOBAL.env')) {
        if (-not (Test-Path $p)) { continue }
        foreach ($line in Get-Content $p) {
            # NOTIFIER_KEY_IPODHAN is the project-specific name the gateway validates;
            # GLOBAL.env currently only carries the generic NOTIFIER_KEY, so accept either.
            if (-not $key -and $line -match '^\s*NOTIFIER_KEY_IPODHAN\s*=\s*(.+?)\s*$') { $key = $Matches[1].Trim('"').Trim("'") }
            if (-not $url -and $line -match '^\s*NOTIFIER_URL\s*=\s*(.+?)\s*$')          { $url = $Matches[1].Trim('"').Trim("'") }
            if (-not $fallbackKey -and $line -match '^\s*NOTIFIER_KEY\s*=\s*(.+?)\s*$')  { $fallbackKey = $Matches[1].Trim('"').Trim("'") }
        }
        break
    }
}
if (-not $key) { $key = $fallbackKey }
if (-not $url) { $url = 'http://127.0.0.1:3300' }
$url = $url.TrimEnd('/') + '/notify'
if (-not $key) {
    "[NOTIFY-SKIP] NOTIFIER_KEY_IPODHAN not set - would page $severity ($dedupeKey)"
    exit 0
}
try {
    Invoke-RestMethod -Uri $url -Method Post -TimeoutSec 5 `
        -Headers @{ 'X-Api-Key' = $key; 'Content-Type' = 'application/json' } -Body $body | Out-Null
    "[NOTIFY] sent $severity ($dedupeKey)"
} catch {
    "[NOTIFY-FAIL] $dedupeKey : $($_.Exception.Message)"
}
exit 0
