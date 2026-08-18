#!/bin/bash
# Commodity Dashboard — macOS launcher.
#
# Starts the Python price server if nothing is listening on port 8000 yet,
# opens the dashboard in a borderless Chrome app window (no tabs/address
# bar), and shuts the server down automatically when that window closes.
# Mirrors launch.ps1 from the Windows version of this repo.

set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
port=8000
url="http://localhost:$port"

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
}
trap cleanup EXIT INT TERM

# --- open a borderless Chrome app window ---
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$chrome" ] || fail "Google Chrome was not found. Install it to use the dashboard."

# A dedicated --user-data-dir forces a standalone Chrome process instead of
# handing off to an already-running instance (which would exit immediately,
# making it impossible to detect the window closing and shut the server down).
profile_dir="$HOME/Library/Application Support/commodity-dashboard/chrome-profile"
"$chrome" --app="$url" --window-size=1000,860 \
    "--user-data-dir=$profile_dir" --no-first-run --no-default-browser-check &
chrome_pid=$!

# Block until the app window is closed (the dedicated Chrome process exits),
# then let the EXIT trap shut the server down.
wait "$chrome_pid"
exit 0
