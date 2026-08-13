# Starts the dashboard server, opens it in a borderless app window, and
# shuts the server down automatically when that window is closed.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = 8000
$url = "http://localhost:$port"

# If a server is already listening on this port (e.g. left over from a
# previous run), don't spawn a second one.
$serverProcess = $null
$portInUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if (-not $portInUse) {
    # "python" alone can resolve to the Windows Store app-execution-alias,
    # which spawns the real interpreter as a *child* process and then may
    # exit itself — tracking that PID would lose the real server on cleanup.
    # Prefer a real interpreter path.
    $pythonCmd = Get-Command python -All -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notmatch 'WindowsApps' } |
        Select-Object -First 1
    if (-not $pythonCmd) {
        $pythonCmd = Get-Command python -ErrorAction Stop | Select-Object -First 1
    }

    $serverProcess = Start-Process -FilePath $pythonCmd.Source -ArgumentList "server.py" -WindowStyle Hidden -PassThru

    # Wait for the server to start responding, up to 15 seconds.
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            Invoke-WebRequest -Uri "$url/api/prices" -UseBasicParsing -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
}

# Prefer Chrome, fall back to Edge, both support --app mode (no tabs/address bar).
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$chromeX86 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$edgeAlt = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"

$browser = @($chrome, $chromeX86, $edge, $edgeAlt) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
    # A dedicated --user-data-dir forces a standalone Chrome/Edge process
    # instead of handing off to an already-running instance of the browser
    # (which would exit immediately, making it impossible to detect the
    # window closing and safely shut the server down afterwards).
    $profileDir = Join-Path $root ".app-profile"
    $browserProcess = Start-Process -FilePath $browser `
        -ArgumentList "--app=$url", "--window-size=1000,860", `
            "--user-data-dir=$profileDir", "--no-first-run", "--no-default-browser-check" `
        -PassThru
    Wait-Process -Id $browserProcess.Id -ErrorAction SilentlyContinue
} else {
    # No Chrome/Edge found — fall back to the default browser (regular tab).
    Start-Process $url
}

# Only stop the server if this launch started it (skip if we attached to one
# that was already running). Stop by whoever now owns the port rather than
# just the original PID, in case the launched process handed off to a child.
if ($serverProcess) {
    $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if ($owner) {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    } elseif (-not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
