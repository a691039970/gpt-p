const refreshBtn = document.getElementById("refreshBtn");
const filterAllBtn = document.getElementById("filterAllBtn");
const filterFollowBtn = document.getElementById("filterFollowBtn");
const filterObserveBtn = document.getElementById("filterObserveBtn");
const hoursSelect = document.getElementById("hoursSelect");
const beforeDateTimeInput = document.getElementById("beforeDateTimeInput");
const clearDateFilterBtn = document.getElementById("clearDateFilterBtn");
const statusText = document.getElementById("statusText");
const summaryGrid = document.getElementById("summaryGrid");
const walletSummaryGrid = document.getElementById("walletSummaryGrid");
const minPnlInput = document.getElementById("minPnlInput");
const maxPnlInput = document.getElementById("maxPnlInput");
const clearPnlFilterBtn = document.getElementById("clearPnlFilterBtn");
const positionsFilterStatus = document.getElementById("positionsFilterStatus");
const positionsBody = document.getElementById("positionsBody");
const recentTradesBody = document.getElementById("recentTradesBody");
const signalsBody = document.getElementById("signalsBody");
const paperTradesBody = document.getElementById("paperTradesBody");

let currentSignals = [];
let currentWalletPositions = [];
let currentFilter = "all";
let currentHours = 0;
let currentBeforeTimestamp = null;
let currentMinPnl = null;
let currentMaxPnl = null;

function labelDecision(decision) {
  if (decision === "follow") return "\u8ddf";
  if (decision === "observe") return "\u89c2\u5bdf";
  return "\u4e0d\u8ddf";
}

function labelReason(reason) {
  if (reason === "trial_rule_match") return "\u7b26\u5408\u8bd5\u884c\u89c4\u5219";
  if (reason === "time_discounted") return "\u65f6\u95f4\u6743\u91cd\u6253\u6298";
  if (reason === "price_too_low") return "\u4ef7\u683c\u8fc7\u4f4e";
  if (reason === "category_not_in_trial") return "\u4e0d\u5728\u8bd5\u884c\u54c1\u7c7b";
  if (reason === "tier_not_defined") return "\u4ed3\u4f4d\u6863\u4f4d\u672a\u5b9a\u4e49";
  return reason || "";
}

function labelCategory(category) {
  if (category === "Basketball") return "\u7bee\u7403";
  if (category === "CS2") return "CS2";
  if (category === "Dota2") return "Dota2";
  if (category === "LoL") return "LOL";
  if (category === "Valorant") return "\u65e0\u754f\u5951\u7ea6";
  if (category === "CoD") return "\u4f7f\u547d\u53ec\u5524";
  if (category === "Other") return "\u5176\u4ed6";
  return category || "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badgeClass(decision) {
  if (decision === "follow") return "badge follow";
  if (decision === "observe") return "badge observe";
  return "badge skip";
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "\u65e0";
  return Number(value).toFixed(digits);
}

function formatLocalDateTime(value) {
  if (!value) return "\u65e0";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildCards(target, cards) {
  target.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <h3>${escapeHtml(card.title)}</h3>
          <p><strong>${escapeHtml(card.value)}</strong></p>
          <p>${escapeHtml(card.hint)}</p>
        </article>
      `
    )
    .join("");
}

function buildSummary(signals) {
  const followCount = signals.filter((row) => row.decision === "follow").length;
  const observeCount = signals.filter((row) => row.decision === "observe").length;
  const skipCount = signals.filter((row) => row.decision === "skip").length;
  const totalUnits = signals
    .filter((row) => row.decision !== "skip")
    .reduce((sum, row) => sum + Number(row.finalUnits || 0), 0);

  buildCards(summaryGrid, [
    { title: "\u53ef\u8ddf", value: followCount, hint: "\u5f53\u524d\u89c4\u5219\u4e0b\u53ef\u76f4\u63a5\u8bd5\u884c\u7684\u76d8\u53e3" },
    { title: "\u89c2\u5bdf", value: observeCount, hint: "\u4fdd\u7559\uff0c\u4f46\u56e0\u65f6\u95f4\u6743\u91cd\u88ab\u6253\u6298" },
    { title: "\u4e0d\u8ddf", value: skipCount, hint: "\u4e0d\u5728\u8bd5\u884c\u8303\u56f4\u6216\u4ef7\u683c\u592a\u4f4e" },
    { title: "\u5efa\u8bae\u603b\u4ed3\u4f4d", value: formatNumber(totalUnits), hint: "\u6240\u6709\u975e\u4e0d\u8ddf\u4fe1\u53f7\u7684\u5efa\u8bae\u4ed3\u4f4d\u603b\u548c" },
  ]);
}

function buildWalletSummary(snapshot) {
  buildCards(walletSummaryGrid, [
    { title: "\u6301\u4ed3\u6570", value: snapshot.totals?.count ?? 0, hint: "\u5f53\u524d\u516c\u5f00\u53ef\u89c1\u7684\u672a\u5e73\u4ed3\u6301\u4ed3" },
    { title: "\u521d\u59cb\u6295\u5165", value: formatNumber(snapshot.totals?.initialValue), hint: "\u6309\u5747\u4ef7\u4f30\u7b97\u7684\u6301\u4ed3\u521d\u59cb\u4ef7\u503c" },
    { title: "\u5f53\u524d\u4ef7\u503c", value: formatNumber(snapshot.totals?.currentValue), hint: "\u5f53\u524d\u6301\u4ed3\u603b\u4ef7\u503c" },
    { title: "\u5f53\u524d\u6d6e\u76c8\u4e8f", value: formatNumber(snapshot.totals?.cashPnl), hint: "\u5f53\u524d\u672a\u5b9e\u73b0\u76c8\u4e8f" },
  ]);
}

function applyPositionFilter(positions) {
  return (positions || []).filter((row) => {
    const percentPnl = Number(row.percentPnl);
    if (currentMinPnl !== null && percentPnl < currentMinPnl) return false;
    if (currentMaxPnl !== null && percentPnl > currentMaxPnl) return false;
    return true;
  });
}

function updatePositionsFilterStatus(totalCount, filteredCount) {
  const parts = [`显示 ${filteredCount} / ${totalCount} 个持仓`];
  if (currentMinPnl !== null) {
    parts.push(`最低 ${formatNumber(currentMinPnl, 1)}%`);
  }
  if (currentMaxPnl !== null) {
    parts.push(`最高 ${formatNumber(currentMaxPnl, 1)}%`);
  }
  positionsFilterStatus.textContent = parts.join(" | ");
}

function renderPositions(positions) {
  const filtered = applyPositionFilter(positions);
  updatePositionsFilterStatus((positions || []).length, filtered.length);
  positionsBody.innerHTML = filtered
    .slice(0, 40)
    .map(
      (row) => `
        <tr>
          <td class="market">
            <strong>${escapeHtml(row.title || "")}</strong>
            <span class="muted">${escapeHtml(row.slug || "")}</span>
          </td>
          <td>${escapeHtml(row.outcome || "")}</td>
          <td>${formatNumber(row.size, 2)}</td>
          <td>${formatNumber(row.avgPrice, 3)}</td>
          <td>${formatNumber(row.curPrice, 3)}</td>
          <td>${formatNumber(row.currentValue, 2)}</td>
          <td>${formatNumber(row.cashPnl, 2)}</td>
          <td>${formatNumber(row.percentPnl, 2)}%</td>
        </tr>
      `
    )
    .join("");
}

function renderRecentTrades(trades) {
  recentTradesBody.innerHTML = (trades || [])
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.tradeTimeUtc || "")}</td>
          <td class="market">
            <strong>${escapeHtml(row.title || "")}</strong>
            <span class="muted">${escapeHtml(row.slug || "")}</span>
          </td>
          <td>${escapeHtml(row.outcome || "")}</td>
          <td>${escapeHtml(row.side || "")}</td>
          <td>${formatNumber(row.price, 3)}</td>
          <td>${formatNumber(row.size, 2)}</td>
        </tr>
      `
    )
    .join("");
}

function applyFilter(signals) {
  let filtered = signals;
  if (currentHours > 0) {
    const cutoff = Date.now() - currentHours * 60 * 60 * 1000;
    filtered = filtered.filter((row) => new Date(row.tradeTimeUtc).getTime() >= cutoff);
  }

  if (currentBeforeTimestamp !== null) {
    filtered = filtered.filter((row) => new Date(row.tradeTimeUtc).getTime() <= currentBeforeTimestamp);
  }

  if (currentFilter === "follow") return filtered.filter((row) => row.decision === "follow");
  if (currentFilter === "observe") return filtered.filter((row) => row.decision === "observe");
  return filtered;
}

function updateStatusText(baseText, filteredSignals) {
  const parts = [baseText];
  if (currentHours > 0) {
    parts.push(`最近 ${currentHours} 小时`);
  }
  if (currentBeforeTimestamp !== null) {
    parts.push(`截止 ${formatLocalDateTime(currentBeforeTimestamp)}`);
  }
  if (currentFilter === "follow") {
    parts.push("\u53ea\u770b\u53ef\u8ddf");
  } else if (currentFilter === "observe") {
    parts.push("\u53ea\u770b\u89c2\u5bdf");
  }
  parts.push(`\u663e\u793a ${filteredSignals.length} \u6761`);
  statusText.textContent = parts.join(" | ");
}

function renderSignals(signals) {
  const filtered = applyFilter(signals);
  buildSummary(filtered);
  signalsBody.innerHTML = filtered
    .map(
      (row) => `
        <tr>
          <td><span class="${badgeClass(row.decision)}">${escapeHtml(labelDecision(row.decision))}</span></td>
          <td>${escapeHtml(labelCategory(row.category))}</td>
          <td class="market">
            <strong>${escapeHtml(row.title || "")}</strong>
            <span class="muted">${escapeHtml(row.slug || "")}</span>
          </td>
          <td>${escapeHtml(row.outcome || "")}</td>
          <td>${formatNumber(row.price, 3)}</td>
          <td>${formatNumber(row.size, 2)}</td>
          <td>${row.minutesBeforeStart === null ? "\u65e0" : formatNumber(row.minutesBeforeStart, 1)}</td>
          <td>${formatNumber(row.finalUnits, 2)}u</td>
          <td>
            <div class="actions">
              <button data-action="paper" data-title="${escapeHtml(row.title || "")}" data-slug="${escapeHtml(row.slug || "")}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">\u8bb0\u7eb8\u9762\u5355</button>
              <button class="secondary" data-action="placed" data-title="${escapeHtml(row.title || "")}" data-slug="${escapeHtml(row.slug || "")}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">\u5df2\u4e0b\u5355</button>
              <button class="secondary" data-action="skipped" data-title="${escapeHtml(row.title || "")}" data-slug="${escapeHtml(row.slug || "")}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">\u5df2\u8df3\u8fc7</button>
            </div>
            <div class="muted">${escapeHtml(labelReason(row.reason))}</div>
          </td>
        </tr>
      `
    )
    .join("");
  return filtered;
}

async function loadPaperTrades() {
  const response = await fetch("/api/paper-trades");
  const payload = await response.json();
  paperTradesBody.innerHTML = (payload.rows || [])
    .slice(0, 30)
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.recordedAt || "")}</td>
          <td class="market">
            <strong>${escapeHtml(row.title || "")}</strong>
            <span class="muted">${escapeHtml(row.slug || "")}</span>
          </td>
          <td>${escapeHtml(labelDecision(row.decision || ""))}</td>
          <td>${escapeHtml(row.units || "")}</td>
          <td>${escapeHtml(row.notes || "")}</td>
        </tr>
      `
    )
    .join("");
}

async function loadSignals() {
  statusText.textContent = "\u6b63\u5728\u5237\u65b0...";
  const response = await fetch("/api/signals");
  const payload = await response.json();
  currentSignals = payload.signals || [];
  const filtered = renderSignals(currentSignals);
  updateStatusText(`\u5df2\u66f4\u65b0\uff1a${payload.updatedAt || ""}`, filtered);
}

async function loadWallet() {
  const response = await fetch("/api/wallet");
  const payload = await response.json();
  currentWalletPositions = payload.positions || [];
  buildWalletSummary(payload);
  renderPositions(currentWalletPositions);
  renderRecentTrades(payload.recentTrades || []);
}

async function addPaperTrade(button) {
  const action = button.dataset.action;
  const defaultNote =
    action === "placed"
      ? "\u5df2\u624b\u52a8\u4e0b\u5355"
      : action === "skipped"
      ? "\u672c\u6b21\u8df3\u8fc7"
      : "";

  const notes = window.prompt("\u7ed9\u8fd9\u7b14\u8bb0\u5f55\u52a0\u4e00\u53e5\u5907\u6ce8\uff1a", defaultNote);
  const payload = {
    title: button.dataset.title,
    slug: button.dataset.slug,
    decision: button.dataset.decision,
    units: button.dataset.units,
    action,
    notes: notes || "",
  };

  await fetch("/api/paper-trades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await loadPaperTrades();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  await addPaperTrade(button);
});

refreshBtn.addEventListener("click", async () => {
  await loadWallet();
  await loadSignals();
  await loadPaperTrades();
});

filterAllBtn.addEventListener("click", () => {
  currentFilter = "all";
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "\u5df2\u5e94\u7528\u7b5b\u9009", filtered);
});

filterFollowBtn.addEventListener("click", () => {
  currentFilter = "follow";
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "\u5df2\u5e94\u7528\u7b5b\u9009", filtered);
});

filterObserveBtn.addEventListener("click", () => {
  currentFilter = "observe";
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "\u5df2\u5e94\u7528\u7b5b\u9009", filtered);
});

hoursSelect.addEventListener("change", () => {
  currentHours = Number(hoursSelect.value || 0);
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "\u5df2\u5e94\u7528\u7b5b\u9009", filtered);
});

beforeDateTimeInput.addEventListener("change", () => {
  const timestamp = beforeDateTimeInput.value ? new Date(beforeDateTimeInput.value).getTime() : Number.NaN;
  currentBeforeTimestamp = Number.isNaN(timestamp) ? null : timestamp;
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "\u5df2\u5e94\u7528\u7b5b\u9009", filtered);
});

clearDateFilterBtn.addEventListener("click", () => {
  beforeDateTimeInput.value = "";
  currentBeforeTimestamp = null;
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "\u5df2\u5e94\u7528\u7b5b\u9009", filtered);
});

minPnlInput.addEventListener("input", () => {
  const value = minPnlInput.value === "" ? null : Number(minPnlInput.value);
  currentMinPnl = value === null || Number.isNaN(value) ? null : value;
  renderPositions(currentWalletPositions);
});

maxPnlInput.addEventListener("input", () => {
  const value = maxPnlInput.value === "" ? null : Number(maxPnlInput.value);
  currentMaxPnl = value === null || Number.isNaN(value) ? null : value;
  renderPositions(currentWalletPositions);
});

clearPnlFilterBtn.addEventListener("click", () => {
  minPnlInput.value = "";
  maxPnlInput.value = "";
  currentMinPnl = null;
  currentMaxPnl = null;
  renderPositions(currentWalletPositions);
});

Promise.all([loadWallet(), loadSignals(), loadPaperTrades()]).catch((error) => {
  statusText.textContent = `\u52a0\u8f7d\u5931\u8d25\uff1a${error.message}`;
});
