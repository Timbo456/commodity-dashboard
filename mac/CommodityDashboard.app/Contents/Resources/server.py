"""
Commodity + equities price dashboard server.

Serves the static frontend from ./public and proxies live prices from Yahoo
Finance's public chart API (browser calls are blocked by CORS, so this runs
server-side and the frontend polls the /api/* endpoints instead).

Run:
    python server.py

Then open http://localhost:8000
"""

import http.cookiejar
import json
import re
import ssl
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse, parse_qs

PORT = 8000
PUBLIC_DIR = Path(__file__).parent / "public"
CACHE_TTL_SECONDS = 10
NEWS_CACHE_TTL_SECONDS = 300
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-\^]{1,15}$")
MAX_EQUITY_SYMBOLS = 30
ITEMS_PER_SOURCE = 8
MAX_NEWS_ITEMS = 40

# python.org Python on macOS ships without a CA store, so TLS verification
# fails for sites that don't send their full chain. Prefer certifi's bundle.
try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

# (display name, RSS feed URL)
NEWS_SOURCES = [
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ("CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
    ("Seeking Alpha", "https://seekingalpha.com/feed.xml"),
    ("Reuters", "https://www.reutersagency.com/feed/?best-topics=business-finance"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("ZeroHedge", "https://feeds.feedburner.com/zerohedge/feed"),
]

# (symbol, display name, category, unit)
COMMODITIES = [
    ("GC=F", "Gold", "Precious Metals", "oz"),
    ("SI=F", "Silver", "Precious Metals", "oz"),
    ("PL=F", "Platinum", "Precious Metals", "oz"),
    ("CL=F", "WTI Crude Oil", "Energy", "bbl"),
    ("BZ=F", "Brent Crude Oil", "Energy", "bbl"),
    ("NG=F", "Natural Gas", "Energy", "MMBtu"),
    ("ZW=F", "Wheat", "Agriculture", "bu"),
    ("ZC=F", "Corn", "Agriculture", "bu"),
    ("ZS=F", "Soybeans", "Agriculture", "bu"),
    ("KC=F", "Coffee", "Agriculture", "lb"),
    ("SB=F", "Sugar", "Agriculture", "lb"),
    ("HG=F", "Copper", "Industrial Metals", "lb"),
    ("ALI=F", "Aluminum", "Industrial Metals", "tonne"),
]

_quote_cache = {}  # symbol -> (data_dict, fetched_at)

# Market cap isn't in the unauthenticated chart endpoint's payload, so a
# separate cookie+crumb authenticated call is needed for it. Failures here
# are non-fatal — price/change data still comes from _fetch_meta regardless.
_yahoo_cookie_jar = http.cookiejar.CookieJar()
_yahoo_opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(_yahoo_cookie_jar),
    urllib.request.HTTPSHandler(context=SSL_CONTEXT),
)
_crumb_cache = {"value": None, "fetched_at": 0}
CRUMB_TTL_SECONDS = 3600


def _get_crumb(force=False):
    now = time.time()
    if not force and _crumb_cache["value"] and (now - _crumb_cache["fetched_at"]) < CRUMB_TTL_SECONDS:
        return _crumb_cache["value"]

    # This ping always 404s but sets the auth cookie via Set-Cookie regardless
    # of status — only the cookie side effect matters here.
    req = urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": USER_AGENT})
    try:
        _yahoo_opener.open(req, timeout=8).read()
    except urllib.error.HTTPError:
        pass

    req = urllib.request.Request(
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        headers={"User-Agent": USER_AGENT},
    )
    crumb = _yahoo_opener.open(req, timeout=8).read().decode("utf-8").strip()
    _crumb_cache["value"] = crumb
    _crumb_cache["fetched_at"] = now
    return crumb


def _fetch_market_cap(symbol, retry=True):
    try:
        crumb = _get_crumb()
        url = (
            f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{quote(symbol)}"
            f"?modules=price&crumb={quote(crumb)}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        payload = json.loads(_yahoo_opener.open(req, timeout=8).read())
        result = payload.get("quoteSummary", {}).get("result")
        if not result:
            if retry:
                _get_crumb(force=True)
                return _fetch_market_cap(symbol, retry=False)
            return None
        return result[0]["price"].get("marketCap", {}).get("raw")
    except (urllib.error.URLError, KeyError, IndexError, ValueError):
        return None


def _fetch_meta(symbol):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
        f"?interval=1m&range=1d"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=8, context=SSL_CONTEXT) as resp:
        payload = json.loads(resp.read())
    return payload["chart"]["result"][0]["meta"]


def _build_quote(symbol, name, category, unit, meta):
    price = meta.get("regularMarketPrice")
    prev_close = meta.get("previousClose") or meta.get("chartPreviousClose")
    change = None
    change_percent = None
    if price is not None and prev_close:
        change = price - prev_close
        change_percent = (change / prev_close) * 100
    return {
        "symbol": symbol,
        "name": name,
        "category": category,
        "unit": unit,
        "price": price,
        "previousClose": prev_close,
        "change": change,
        "changePercent": change_percent,
        "currency": meta.get("currency", "USD"),
        "marketTime": meta.get("regularMarketTime"),
        "marketCap": None,
        "error": None,
    }


def _error_quote(symbol, name, category, unit, exc):
    return {
        "symbol": symbol,
        "name": name,
        "category": category,
        "unit": unit,
        "price": None,
        "previousClose": None,
        "change": None,
        "changePercent": None,
        "currency": None,
        "marketTime": None,
        "marketCap": None,
        "error": str(exc),
    }


def fetch_commodity(entry):
    symbol, name, category, unit = entry
    try:
        meta = _fetch_meta(symbol)
        return _build_quote(symbol, name, category, unit, meta)
    except (urllib.error.URLError, KeyError, IndexError, ValueError) as exc:
        return _error_quote(symbol, name, category, unit, exc)


def fetch_equity(symbol):
    try:
        meta = _fetch_meta(symbol)
        name = meta.get("shortName") or meta.get("longName") or symbol
        result = _build_quote(symbol, name, "Equities", "", meta)
        result["marketCap"] = _fetch_market_cap(symbol)
        return result
    except (urllib.error.URLError, KeyError, IndexError, ValueError) as exc:
        return _error_quote(symbol, symbol, "Equities", "", exc)


def cached(symbol, fetch_fn):
    now = time.time()
    entry = _quote_cache.get(symbol)
    if entry and (now - entry[1]) < CACHE_TTL_SECONDS:
        return entry[0]
    data = fetch_fn()
    _quote_cache[symbol] = (data, now)
    return data


def get_commodity_prices():
    with ThreadPoolExecutor(max_workers=len(COMMODITIES)) as pool:
        results = list(
            pool.map(lambda e: cached(e[0], lambda e=e: fetch_commodity(e)), COMMODITIES)
        )
    return {"generatedAt": int(time.time()), "commodities": results}


def get_equity_quotes(symbols):
    if not symbols:
        return {"generatedAt": int(time.time()), "equities": []}
    with ThreadPoolExecutor(max_workers=len(symbols)) as pool:
        results = list(
            pool.map(lambda s: cached(s, lambda s=s: fetch_equity(s)), symbols)
        )
    return {"generatedAt": int(time.time()), "equities": results}


def fetch_feed(source_name, url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=8, context=SSL_CONTEXT) as resp:
            raw = resp.read()
        root = ET.fromstring(raw)
        channel = root.find("channel")
        items = channel.findall("item") if channel is not None else root.findall(".//item")

        results = []
        for item in items[:ITEMS_PER_SOURCE]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub_date_raw = item.findtext("pubDate")
            published_at = None
            if pub_date_raw:
                try:
                    published_at = int(parsedate_to_datetime(pub_date_raw).timestamp())
                except (ValueError, TypeError):
                    published_at = None
            if title and link:
                results.append({
                    "title": title,
                    "link": link,
                    "source": source_name,
                    "publishedAt": published_at,
                })
        return {"source": source_name, "items": results, "error": None}
    except (urllib.error.URLError, ET.ParseError, TimeoutError) as exc:
        return {"source": source_name, "items": [], "error": str(exc)}


_news_cache = {"data": None, "fetched_at": 0}


def get_news():
    now = time.time()
    if _news_cache["data"] and (now - _news_cache["fetched_at"]) < NEWS_CACHE_TTL_SECONDS:
        return _news_cache["data"]

    with ThreadPoolExecutor(max_workers=len(NEWS_SOURCES)) as pool:
        feed_results = list(
            pool.map(lambda s: fetch_feed(s[0], s[1]), NEWS_SOURCES)
        )

    all_items = [item for feed in feed_results for item in feed["items"]]
    all_items.sort(key=lambda i: i["publishedAt"] or 0, reverse=True)

    sources = [{"name": f["source"], "ok": f["error"] is None} for f in feed_results]

    data = {
        "generatedAt": int(now),
        "items": all_items[:MAX_NEWS_ITEMS],
        "sources": sources,
    }
    _news_cache["data"] = data
    _news_cache["fetched_at"] = now
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, rel_path):
        file_path = (PUBLIC_DIR / rel_path).resolve()
        if PUBLIC_DIR.resolve() not in file_path.parents and file_path != PUBLIC_DIR.resolve():
            self.send_error(403)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }
        ctype = content_types.get(file_path.suffix, "application/octet-stream")
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/prices":
            try:
                self._send_json(get_commodity_prices())
            except Exception as exc:  # keep the server alive on unexpected errors
                self._send_json({"error": str(exc)}, status=500)
            return

        if parsed.path == "/api/quote":
            qs = parse_qs(parsed.query)
            raw_symbols = (qs.get("symbols", [""])[0]).split(",")
            symbols = []
            for s in raw_symbols:
                s = s.strip().upper()
                if s and SYMBOL_RE.match(s) and s not in symbols:
                    symbols.append(s)
            symbols = symbols[:MAX_EQUITY_SYMBOLS]
            try:
                self._send_json(get_equity_quotes(symbols))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        if parsed.path == "/api/news":
            try:
                self._send_json(get_news())
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        rel = parsed.path.lstrip("/") or "index.html"
        self._send_file(rel)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Dashboard running at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
