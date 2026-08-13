const REFRESH_MS = 30000;
const NEWS_REFRESH_MS = 300000;
const WATCHLIST_KEY = "equities-watchlist";
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

function formatDelta(change, changePercent) {
  if (change === null || change === undefined) return { text: "—", dir: "flat" };
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
  const sign = change > 0 ? "+" : "";
  const pct = changePercent === null || changePercent === undefined
    ? ""
    : ` (${sign}${changePercent.toFixed(2)}%)`;
  return { text: `${arrow} ${sign}${change.toFixed(2)}${pct}`, dir };
}

function lineHtml(c, { removable } = {}) {
  const removeBtn = removable
    ? `<button class="line-remove" data-symbol="${c.symbol}" title="Remove ${c.symbol}" aria-label="Remove ${c.symbol}">✕</button>`
    : "";

  if (c.error || c.price === null) {
    return `
      <div class="line is-error">
        <span class="line-name">${c.name}</span>
        <span class="line-symbol">${c.symbol}</span>
        <span class="line-error-text">Price unavailable</span>
        ${removeBtn}
      </div>`;
  }

  const delta = formatDelta(c.change, c.changePercent);
  const unit = c.unit ? `/${c.unit}` : "";
  return `
    <div class="line">
      <span class="line-name">${c.name}</span>
      <span class="line-symbol">${c.symbol}</span>
      <span class="line-price">${formatPrice(c.price)}<span class="line-unit">${c.currency || ""}${unit}</span></span>
      <span class="line-delta ${delta.dir}">${delta.text}</span>
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
      const av = a.changePercent ?? -Infinity;
      const bv = b.changePercent ?? -Infinity;
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
