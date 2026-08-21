# Commodity Dashboard

A local commodity & equities dashboard with a live news feed. Prices via Yahoo Finance (delayed ~15–20 min), refreshing every 30s; news refreshes every 5 minutes.

## Download

[![Download for macOS](https://img.shields.io/badge/Download%20for-macOS-F97316?style=for-the-badge)](https://github.com/Timbo456/commodity-dashboard/releases/latest/download/CommodityDashboard-macOS.zip)
[![Download for Windows](https://img.shields.io/badge/Download%20for-Windows-F97316?style=for-the-badge)](https://github.com/Timbo456/commodity-dashboard/releases/latest/download/CommodityDashboard-Windows.zip)

### macOS

Unzip, then drag `CommodityDashboard.app` to Applications. If Gatekeeper warns on first launch: right-click the app → **Open**.

### Windows

Requires [Python 3](https://www.python.org/downloads/) and Chrome or Edge. Unzip, then double-click `launch.vbs`. Closing the dashboard window shuts the local server down automatically.

## Run from source

```bash
pip install -r requirements.txt
python server.py
# open http://localhost:8000
```
