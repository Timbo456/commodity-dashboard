# Commodity Dashboard — Session Recap (paste this into a new Claude chat)

## What this is

A personal, locally-run web dashboard showing live commodity futures prices,
a user-editable stock watchlist, and an aggregated news feed. Built from
scratch across a long Claude Code session. Runs as a small Python HTTP
server (no framework, stdlib only) serving a vanilla HTML/CSS/JS frontend.
Packaged as a double-clickable desktop app on both Windows and macOS.

Repo: **https://github.com/Timbo456/commodity-dashboard** (public, personal
GitHub account — not the user's work account). Tagged release `v1.0` exists;
README has download badges pointing at GitHub Releases zips for both
platforms (built manually, not via CI — there is no `.github/workflows`).

Local path on this Windows machine:
`C:\Users\s.taylor\Desktop\Dashboard\commodity-dashboard`

## Why / intent

User wanted a real-time-ish personal finance/news dashboard they could run
locally without paying for data APIs, launched like a normal desktop app
(icon, no terminal window, closes cleanly) rather than something they have
to manually start from a terminal every time.

## Architecture

- **`server.py`** — Python 3 stdlib-only HTTP server (`http.server`,
  `urllib`, `concurrent.futures`). No pip dependencies except `certifi`
  (see `requirements.txt`). Three endpoints:
  - `GET /api/prices` — fixed list of ~13 commodity futures (gold, silver,
    oil, wheat, copper, etc.), grouped by category. Pulled from Yahoo
    Finance's **unauthenticated** chart endpoint
    (`query1.finance.yahoo.com/v8/finance/chart/{symbol}`) — no API key
    needed, works via plain `urllib` request with a browser User-Agent.
  - `GET /api/quote?symbols=AAPL,MSFT` — arbitrary equity tickers for the
    user's watchlist. Same chart endpoint for price/change, **plus**
    market cap pulled from Yahoo's `quoteSummary` endpoint, which
    *does* require a cookie+crumb auth flow (implemented — see gotcha
    below). Everything cached server-side for 10s per symbol.
  - `GET /api/news` — aggregates RSS from Al Jazeera, CNBC, Seeking Alpha,
    MarketWatch, and ZeroHedge (Reuters was attempted but their public RSS
    is genuinely discontinued — silently excluded). Cached 5 minutes.
  - All other GET requests serve static files from `./public`.
- **`public/`** — `index.html`, `style.css`, `app.js`. No build step, no
  framework, just fetch() polling the endpoints above every 30s (news every
  5 min) and re-rendering.
- Frontend state (the watchlist ticker list) persists in the browser's
  `localStorage`, **not** on the server — so it's per-browser, not
  synced across devices.

## Features built (roughly in order)

1. Commodity price grid → later condensed to compact table rows
2. Equities watchlist: add/remove tickers, persisted in localStorage
3. Two-column layout: Equities (left) / Commodities (right), News below
   full-width
4. Sortable Equities columns: Name (A–Z), % Change, and **Market Cap**
   (click column headers, arrow indicates direction)
5. News feed section, 5 outlets, sorted by recency
6. Visual passes: centered "News Dashboard" title in a Google Font (Space
   Grotesk), colored per-section accent dots/borders (blue=Equities,
   violet=Commodities, green=News — deliberately distinct from the
   red/green used for price gains/losses), grey theme → then switched to a
   **full dark theme** (currently pinned via `data-theme="dark"` on
   `<html>`, not following OS preference)
7. Desktop app packaging (see below)
8. Icon has gone through several redesigns: monkey → spider → pancakes →
   shark → angry-monkey → **current: a "howling monkey" (simple, modern,
   black square background, orange head, open howling mouth)** — this is
   the icon that should currently be in use everywhere (favicon **and**
   both desktop app icons).

## Desktop packaging

### Windows
- `launch.vbs` — silent VBScript entry point (avoids a console window
  flashing). Shortcut on the Desktop ("Commodity Dashboard.lnk") points to
  `wscript.exe` running this.
- `launch.ps1` — does the real work: starts `server.py` hidden, polls
  until it responds, then opens Chrome/Edge in `--app=` mode (no
  tabs/address bar) pointed at `localhost:8000`, using an **isolated
  `--user-data-dir`** so it always gets its own trackable process (see
  gotcha below). Waits for that window to close, then kills the server.
- `icon.ico` — used by the Desktop shortcut. Regenerated multiple times by
  downloading Twemoji-style PNG art and converting to `.ico` via
  PowerShell `System.Drawing`.

### macOS
- `mac/CommodityDashboard.app` — a hand-built `.app` bundle (not
  Electron despite earlier phrasing — it's a tiny **C launcher**
  (`mac/launcher.c`) that resolves its own bundle path via
  `_NSGetExecutablePath`, then execs `Contents/Resources/launch.sh`,
  which starts the same `server.py` and opens it in a browser app-window,
  same pattern as Windows). Built/maintained on the user's separate Mac —
  I (this session) have limited direct visibility into exactly how that
  build/sign step was done; check `mac/launcher.c` and
  `mac/CommodityDashboard.app/Contents/Info.plist` if picking this back up.
- Icon: `icon.icns` inside the bundle, kept in sync with the Windows
  `.ico`/favicon design each time it changed.

## Git / GitHub state (as of last check)

- Local repo, branch `master`, **working tree clean, fully pushed** to
  `origin/master` (confirmed via `git status` / `git log --oneline --all`).
- Tag `v1.0` exists.
- **Git identity for this repo is set LOCALLY (not global)** to the user's
  personal GitHub identity to keep their work email out of it:
  - name: `Timbo456`
  - email: `23407776+Timbo456@users.noreply.github.com` (GitHub's private
    noreply email — user has "keep email private" + "block pushes exposing
    email" enabled on GitHub)
  - Global git config on this machine is still their **work** identity
    (`SamRocklabs <s.taylor@scottautomation.com>`) — do NOT let that leak
    into this repo; always check `git config --local` here.
- **`git push` from this Windows machine's CLI hangs/times out** — Git
  Credential Manager wants an interactive browser auth flow that can't
  complete from an automated terminal. Workaround that works: push from
  **GitHub Desktop** instead (already signed into the personal `Timbo456`
  account there, separate from their work GitHub login used elsewhere on
  the same machine).

## Known gotchas / non-obvious things for whoever picks this up

- **`python` on this Windows machine resolves to a Windows Store
  app-execution-alias stub**, not the real interpreter — it spawns the
  real `pythoncore` interpreter as a *child* process. This matters if you
  ever need to track/kill the server process by PID: use
  `Get-Command python -All` and prefer the path that does **not** contain
  `WindowsApps` (see how `launch.ps1` does it) — otherwise you can end up
  killing a launcher stub while the real server orphans and keeps running.
- **Yahoo's `fc.yahoo.com` cookie-priming request always returns HTTP 404**
  even on success — the cookie is still set via `Set-Conversation-Cookie`
  regardless of status. Don't treat that 404 as a real failure (see
  `_get_crumb()` in `server.py` — it already catches this).
- **Chrome `--app=` mode hands off to an already-running Chrome instance**
  instead of spawning a new trackable process if Chrome is already open —
  this broke the "close window → kill server" logic until a dedicated
  `--user-data-dir` was added to force an isolated process. Already fixed,
  just don't remove that flag.
- **Windows icon cache is extremely stubborn.** `ie4uinit.exe
  -ClearIconCache` alone often isn't enough; deleting
  `%LocalAppData%\Microsoft\Windows\Explorer\iconcache_*.db` plus
  restarting `explorer.exe` is more reliable. Pinned taskbar/Start icons
  cache *separately* from the Desktop icon and may need an unpin/re-pin to
  refresh even after all that.
- The Browser preview tool in this environment sometimes can't
  `navigate` directly to `localhost` (policy-blocked) — use
  `preview_start` with the URL instead, which opens it as a dev-server
  preview tab and works fine.
- Screenshot tool in the Browser pane has been flaky this session
  ("pane not displayed" timeouts) — falling back to
  `javascript_exec`-based `getComputedStyle`/`innerText` checks to verify
  UI changes has been reliable when screenshots fail.

## Unresolved / in-progress as of the last message

The Windows Desktop shortcut icon was showing a **stale pancakes icon**
even after the `.ico` file content was correctly updated to the howling
monkey design (verified by re-rendering the `.ico` back to a PNG — the
shapes were correct, just an icon-cache display problem, not a wrong
file). Steps taken, most aggressive last:
1. `ie4uinit.exe -ClearIconCache` + Explorer restart — didn't fully fix it.
2. Deleted the icon cache `.db` files directly + Explorer restart — user
   reported still stale.
3. **Deleted and recreated the Desktop shortcut `.lnk` file from scratch**
   (new file, same target/icon path) + another cache clear + Explorer
   restart — this was the last action taken. **Waiting on user
   confirmation whether the Desktop icon now shows correctly.** If still
   stale, next step is likely checking whether it's pinned to
   taskbar/Start (separate cache, needs unpin/re-pin) rather than the
   Desktop icon itself.

## How to resume

Open a new Claude Code session with working directory set to
`C:\Users\s.taylor\Desktop\Dashboard\commodity-dashboard` (or paste this
whole doc in as context), then pick up wherever the user wants to continue
— most likely: confirm the icon situation, or the next feature request.
