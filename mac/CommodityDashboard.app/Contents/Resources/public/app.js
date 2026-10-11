const REFRESH_MS = 30000;
const NEWS_REFRESH_MS = 300000;
const WATCHLIST_KEY = "equities-watchlist";
const COLUMN_WIDTHS_KEY = "column-widths";
const MIN_COLUMN_PCT = 4;
const SYMBOL_RE = /^[A-Z0-9.\-^]{1,15}$/;

const updatedAtEl = document.getElementById("updated-at");
const commoditiesEl = document.getElementById("commodities-lines");
const equitiesEl = document.getElementById("equities-lines");
const equitiesEmptyEl = document.getElementById("equities-empty");
const tickerForm = document.getElementById("ticker-form");
const tickerInput = document.getElementById("ticker-input");
const tickerErrorEl = document.getElementById("ticker-error");
const newsListEl = document.getElementById("news-list");

function loadWatchlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

let watchlist = loadWatchlist();

function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  const decimals = value >= 100 ? 2 : value >= 10 ? 3 : 4;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMarketCap(value) {
  if (value === null || value === undefined) return "—";
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toLocaleString();
}

function formatDelta(change, changePercent) {
  if (change === null || change === undefined) return { text: "—", dir: "flat" };
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
  const sign = change > 0 ? "+" : "";
  const pct = changePercent === null || changePercent === undefined
    ? ""
    : ` (${sign}${changePercent.toFixed(2)}%)`;
  return { text: `${arrow} <span class="delta-abs">${sign}${change.toFixed(2)}</span>${pct}`, dir };
}

function lineHtml(c, { removable } = {}) {
  const removeBtn = removable
    ? `<button class="line-remove" data-symbol="${c.symbol}" title="Remove ${c.symbol}" aria-label="Remove ${c.symbol}">✕</button>`
    : "";

  if (c.error || c.price === null) {
    return `
      <div class="line is-error">
        <span class="line-name" title="${c.name}">${c.name}</span>
        <span class="line-symbol">${c.symbol}</span>
        <span class="line-error-text">Price unavailable</span>
        ${removeBtn}
      </div>`;
  }

  const delta = formatDelta(c.change, c.changePercent);
  const unit = c.unit ? `/${c.unit}` : "";
  const capCell = removable ? `<span class="line-cap">${formatMarketCap(c.marketCap)}</span>` : "";
  return `
    <div class="line">
      <span class="line-name" title="${c.name}">${c.name}</span>
      <span class="line-symbol">${c.symbol}</span>
      <span class="line-price">${formatPrice(c.price)}<span class="line-unit"><span class="line-ccy">${c.currency || ""}</span>${unit}</span></span>
      <span class="line-delta ${delta.dir}">${delta.text}</span>
      ${capCell}
      ${removeBtn}
    </div>`;
}

function renderCommodities(commodities) {
  commoditiesEl.innerHTML = commodities.map((c) => lineHtml(c)).join("");
}

let lastEquities = [];
const equitiesSort = { key: null, dir: "asc" };

function sortEquities(list) {
  if (!equitiesSort.key) return list;
  const sorted = [...list];
  sorted.sort((a, b) => {
    let result;
    if (equitiesSort.key === "name") {
      result = (a.name || a.symbol).localeCompare(b.name || b.symbol);
    } else {
      const field = equitiesSort.key;
      const av = a[field] ?? -Infinity;
      const bv = b[field] ?? -Infinity;
      result = av - bv;
    }
    return equitiesSort.dir === "asc" ? result : -result;
  });
  return sorted;
}

function updateSortArrows() {
  document.querySelectorAll(".sort-arrow").forEach((el) => {
    const isActive = el.dataset.key === equitiesSort.key;
    el.textContent = isActive ? (equitiesSort.dir === "asc" ? "▲" : "▼") : "↕";
    el.classList.toggle("active", isActive);
  });
}

function renderEquities() {
  equitiesEmptyEl.hidden = watchlist.length > 0;
  const rows = sortEquities(lastEquities);
  equitiesEl.innerHTML = rows.map((c) => lineHtml(c, { removable: true })).join("");

  equitiesEl.querySelectorAll(".line-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = btn.dataset.symbol;
      watchlist = watchlist.filter((s) => s !== symbol);
      saveWatchlist(watchlist);
      refreshEquities();
    });
  });
}

document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.sort;
    if (equitiesSort.key === key) {
      equitiesSort.dir = equitiesSort.dir === "asc" ? "desc" : "asc";
    } else {
      equitiesSort.key = key;
      equitiesSort.dir = key === "name" ? "asc" : "desc";
    }
    updateSortArrows();
    renderEquities();
  });
});

function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

function timeAgo(epochSeconds) {
  if (!epochSeconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderNews(items) {
  if (!items || items.length === 0) {
    newsListEl.innerHTML = `<div class="news-empty">No news available right now.</div>`;
    return;
  }
  newsListEl.innerHTML = items.map((item) => `
    <div class="news-item">
      <div class="news-meta">${escapeHtml(item.source)} · ${timeAgo(item.publishedAt)}</div>
      <a class="news-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
    </div>`).join("");
}

async function refreshNews() {
  try {
    const res = await fetch("/api/news");
    const data = await res.json();
    renderNews(data.items);
  } catch {
    // leave existing headlines in place on transient failure
  }
}

function setUpdatedAt(timestamp) {
  const time = new Date(timestamp * 1000);
  updatedAtEl.textContent = `Updated ${time.toLocaleTimeString()}`;
}

async function refreshCommodities() {
  try {
    const res = await fetch("/api/prices");
    const data = await res.json();
    renderCommodities(data.commodities);
    setUpdatedAt(data.generatedAt);
  } catch {
    updatedAtEl.textContent = "Connection error — retrying…";
  }
}

async function refreshEquities() {
  if (watchlist.length === 0) {
    lastEquities = [];
    renderEquities();
    return;
  }
  try {
    const res = await fetch(`/api/quote?symbols=${encodeURIComponent(watchlist.join(","))}`);
    const data = await res.json();
    lastEquities = data.equities;
    renderEquities();
  } catch {
    // leave existing rows in place on transient failure
  }
}

const bizScanBtn = document.getElementById("biz-scan");
const bizStatusEl = document.getElementById("biz-status");
const bizLinesEl = document.getElementById("biz-lines");
const bizHeaderEl = document.getElementById("biz-header");

function renderBizMentions(data) {
  const threads = data.threads || [];
  const posts = threads.reduce((sum, t) => sum + t.posts, 0);
  const links = threads
    .map((t, i) => `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">#${i + 1}</a>`)
    .join(" ");
  bizStatusEl.classList.remove("is-error");
  bizStatusEl.innerHTML =
    `${data.mentions.length} tickers across ${threads.length} live thread${threads.length === 1 ? "" : "s"} ` +
    `(${posts.toLocaleString()} posts) · ${links} · scanned ${new Date(data.generatedAt * 1000).toLocaleTimeString()}`;

  if (data.mentions.length === 0) {
    bizLinesEl.hidden = true;
    bizHeaderEl.hidden = true;
    return;
  }
  const max = data.mentions[0].count;
  bizLinesEl.innerHTML = data.mentions.map((m) => `
    <div class="line">
      <span class="biz-ticker">${escapeHtml(m.ticker)}</span>
      <span class="biz-company" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
      <span class="biz-bar"><span style="width:${(m.count / max) * 100}%"></span></span>
      <span class="biz-count">${m.count}</span>
    </div>`).join("");
  bizLinesEl.hidden = false;
  bizHeaderEl.hidden = false;
}

bizScanBtn.addEventListener("click", async () => {
  bizScanBtn.disabled = true;
  bizScanBtn.textContent = "Scanning…";
  try {
    const res = await fetch("/api/biz-mentions");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderBizMentions(data);
  } catch (err) {
    bizStatusEl.textContent = `Scan failed: ${err.message}`;
    bizStatusEl.classList.add("is-error");
  } finally {
    bizScanBtn.disabled = false;
    bizScanBtn.textContent = "Scan";
  }
});

// Drag-to-resize columns. Each header cell with data-col gets a handle on its
// right edge; dragging it moves width between that column and the next visible
// one (the total stays fixed). Widths are stored as --w-<col> vars on the
// section, so header and body rows stay aligned. Double-click resets.
function loadColumnWidths() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveColumnWidths(all) {
  try {
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(all));
  } catch {
    // widths just won't persist
  }
}

const columnWidths = loadColumnWidths();

function setupColumnResize(section, key) {
  const head = section.querySelector(".line-head");
  const cells = [...head.querySelectorAll("[data-col]")];

  const apply = (widths) => {
    for (const [col, pct] of Object.entries(widths)) {
      section.style.setProperty(`--w-${col}`, `${pct.toFixed(2)}%`);
    }
  };
  if (columnWidths[key]) apply(columnWidths[key]);

  cells.slice(0, -1).forEach((cell) => {
    const handle = document.createElement("span");
    handle.className = "col-resize";
    handle.title = "Drag to resize · double-click to reset";
    cell.appendChild(handle);

    handle.addEventListener("click", (e) => e.stopPropagation());
    handle.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      cells.forEach((c) => section.style.removeProperty(`--w-${c.dataset.col}`));
      delete columnWidths[key];
      saveColumnWidths(columnWidths);
    });

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const visible = cells.filter((c) => c.offsetWidth > 0);
      const next = visible[visible.indexOf(cell) + 1];
      if (!next) return;

      // Freeze every visible column at its rendered share first, so only the
      // two columns either side of the handle move.
      const rowWidth = head.getBoundingClientRect().width;
      const widths = {};
      visible.forEach((c) => {
        widths[c.dataset.col] = (c.getBoundingClientRect().width / rowWidth) * 100;
      });
      const a0 = widths[cell.dataset.col];
      const b0 = widths[next.dataset.col];
      const startX = e.clientX;

      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("col-resizing");

      const onMove = (ev) => {
        let d = ((ev.clientX - startX) / rowWidth) * 100;
        d = Math.max(MIN_COLUMN_PCT - a0, Math.min(b0 - MIN_COLUMN_PCT, d));
        widths[cell.dataset.col] = a0 + d;
        widths[next.dataset.col] = b0 - d;
        apply(widths);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        handle.classList.remove("dragging");
        document.body.classList.remove("col-resizing");
        columnWidths[key] = widths;
        saveColumnWidths(columnWidths);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  });
}

setupColumnResize(document.querySelector(".section-equities"), "equities");
setupColumnResize(document.querySelector(".section-commodities"), "commodities");
setupColumnResize(document.querySelector(".section-biz"), "biz");

function refreshAll() {
  refreshCommodities();
  refreshEquities();
}

tickerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const symbol = tickerInput.value.trim().toUpperCase();
  tickerErrorEl.hidden = true;

  if (!symbol) return;
  if (!SYMBOL_RE.test(symbol)) {
    tickerErrorEl.textContent = `"${symbol}" doesn't look like a valid ticker.`;
    tickerErrorEl.hidden = false;
    return;
  }
  if (watchlist.includes(symbol)) {
    tickerErrorEl.textContent = `${symbol} is already on your list.`;
    tickerErrorEl.hidden = false;
    return;
  }

  watchlist.push(symbol);
  saveWatchlist(watchlist);
  tickerInput.value = "";
  refreshEquities();
});

refreshAll();
refreshNews();
setInterval(refreshAll, REFRESH_MS);
setInterval(refreshNews, NEWS_REFRESH_MS);
