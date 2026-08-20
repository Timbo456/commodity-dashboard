#!/bin/bash
# Commodity Dashboard — macOS launcher.
#
# Starts the Python price server if nothing is listening on port 8000 yet,
# opens the dashboard in a borderless Chrome app window (no tabs/address
# bar), and shuts the server down automatically when that window closes.
# Mirrors launch.ps1 from the Windows version of this repo.

set -u

# Resolve project root (where server.py lives)
script_dir="$(dirname "$0")"
if [ -f "$script_dir/server.py" ]; then
    # Bundled: server.py is alongside launch.sh in Resources/
    root="$script_dir"
else
    # Standalone: walk up to find server.py
    root="$script_dir"
    while [ "$root" != "/" ]; do
        if [ -f "$root/server.py" ]; then break; fi
        root="$(dirname "$root")"
    done
fi
[ -f "$root/server.py" ] || { echo "ERROR: server.py not found"; exit 1; }
port=8000
url="http://localhost:$port"
state_dir="$HOME/Library/Application Support/commodity-dashboard"
pidfile="$state_dir/launcher.pid"

# --- single instance: if another launcher is already running, just focus its window ---
if [ -f "$pidfile" ]; then
    old_pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
        osascript \
            -e 'tell application "System Events" to set frontmost of (first process whose name is "Google Chrome") to true' \
            >/dev/null 2>&1 || true
        exit 0
    fi
fi
mkdir -p "$state_dir"
echo $$ > "$pidfile"

fail() {
    osascript \
        -e "display dialog \"$1\" with title \"Commodity Dashboard\" buttons {\"OK\"} default button 1 with icon stop" \
        >/dev/null 2>&1 || true
    exit 1
}

# --- find python3 (GUI-launched apps get a minimal PATH, so check common spots) ---
python_cmd=""
if command -v python3 >/dev/null 2>&1; then
    python_cmd="python3"
else
    for candidate in \
        /Library/Frameworks/Python.framework/Versions/*/bin/python3 \
        /opt/homebrew/bin/python3 \
        /usr/local/bin/python3 \
        /usr/bin/python3; do
        if [ -x "$candidate" ]; then python_cmd="$candidate"; break; fi
    done
fi
[ -n "$python_cmd" ] || fail "Python 3 was not found. Install it from https://www.python.org/downloads/macos/"

# --- start the server only if the port is free (attach to an existing one otherwise) ---
server_pid=""
if ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    "$python_cmd" "$root/server.py" &
    server_pid=$!

    # Wait for the server to start responding, up to 15 seconds. "/" is served
    # locally so this doesn't trigger a full price fetch on every probe.
    ready=false
    for _ in $(seq 1 30); do
        if curl -s --max-time 1 "$url/" >/dev/null 2>&1; then ready=true; break; fi
        sleep 0.5
    done
    $ready || { kill "$server_pid" 2>/dev/null; fail "The dashboard server did not start on port $port."; }
fi

cleanup() {
    # Only stop the server if this launch started it (skip if we attached to
    # one that was already running).
    [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
    rm -f "$pidfile"
}
trap cleanup EXIT INT TERM

# --- reap any orphaned dashboard Chrome windows left over from a previous run ---
profile_dir="$HOME/Library/Application Support/commodity-dashboard/chrome-profile"
mkdir -p "$state_dir"
for stale in $(pgrep -f "user-data-dir=$profile_dir" 2>/dev/null); do
    kill "$stale" 2>/dev/null || true
done
sleep 0.5

# --- open a borderless Chrome app window ---
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$chrome" ] || fail "Google Chrome was not found. Install it to use the dashboard."

# A dedicated --user-data-dir forces a standalone Chrome process instead of
# handing off to an already-running instance (which would exit immediately,
# making it impossible to detect the window closing and shut the server down).
"$chrome" --app="$url" --window-size=1000,860 \
    "--user-data-dir=$profile_dir" --no-first-run --no-default-browser-check &
chrome_pid=$!

# Wait for Chrome to fully start (the initial process exits immediately on macOS)
sleep 3

# On macOS, Chrome's initial process forks and exits. Poll for Chrome processes
# that have our unique profile marker in their command line. When all are gone,
# the user has closed our app window and we can shut down the server.
while true; do
    if ! pgrep -f "Google Chrome.*commodity-dashboard" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
exit 0
