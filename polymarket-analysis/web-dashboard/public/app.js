const refreshBtn = document.getElementById("refreshBtn");
const filterAllBtn = document.getElementById("filterAllBtn");
const filterFollowBtn = document.getElementById("filterFollowBtn");
const filterObserveBtn = document.getElementById("filterObserveBtn");
const hoursSelect = document.getElementById("hoursSelect");
const statusText = document.getElementById("statusText");
const summaryGrid = document.getElementById("summaryGrid");
const walletSummaryGrid = document.getElementById("walletSummaryGrid");
const positionsBody = document.getElementById("positionsBody");
const recentTradesBody = document.getElementById("recentTradesBody");
const signalsBody = document.getElementById("signalsBody");
const paperTradesBody = document.getElementById("paperTradesBody");
let currentSignals = [];
let currentFilter = "all";
let currentHours = 0;

function labelDecision(decision) {
  if (decision === "follow") return "跟";
  if (decision === "observe") return "观察";
  return "不跟";
}

function labelReason(reason) {
  if (reason === "trial_rule_match") return "符合试行规则";
  if (reason === "time_discounted") return "时间权重打折";
  if (reason === "price_too_low") return "价格过低";
  if (reason === "category_not_in_trial") return "不在试行品类";
  if (reason === "tier_not_defined") return "仓位档位未定义";
  return reason || "";
}

function labelCategory(category) {
  if (category === "Basketball") return "篮球";
  if (category === "CS2") return "CS2";
  if (category === "Dota2") return "Dota2";
  if (category === "LoL") return "LOL";
  if (category === "Valorant") return "无畏契约";
  if (category === "CoD") return "使命召唤";
  if (category === "Other") return "其他";
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
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "无";
  return Number(value).toFixed(digits);
}

function buildSummary(signals) {
  const followCount = signals.filter((row) => row.decision === "follow").length;
  const observeCount = signals.filter((row) => row.decision === "observe").length;
  const skipCount = signals.filter((row) => row.decision === "skip").length;
  const totalUnits = signals
    .filter((row) => row.decision !== "skip")
    .reduce((sum, row) => sum + Number(row.finalUnits || 0), 0);

  const cards = [
    { title: "可跟", value: followCount, hint: "当前规则下可直接试行的盘口" },
    { title: "观察", value: observeCount, hint: "保留，但因时间权重被打折" },
    { title: "不跟", value: skipCount, hint: "不在试行范围或价格太低" },
    { title: "建议总仓位", value: formatNumber(totalUnits), hint: "非不跟信号的建议仓位总和" },
  ];

  summaryGrid.innerHTML = cards
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

function buildWalletSummary(snapshot) {
  const cards = [
    { title: "持仓数", value: snapshot.totals.count, hint: "当前公开可见的未平仓持仓" },
    { title: "初始投入", value: formatNumber(snapshot.totals.initialValue), hint: "按均价估算的持仓初始价值" },
    { title: "当前价值", value: formatNumber(snapshot.totals.currentValue), hint: "当前持仓总价值" },
    { title: "当前浮盈亏", value: formatNumber(snapshot.totals.cashPnl), hint: "当前未实现盈亏" },
  ];

  walletSummaryGrid.innerHTML = cards
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

function renderPositions(positions) {
  positionsBody.innerHTML = positions
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
  recentTradesBody.innerHTML = trades
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

  if (currentFilter === "follow") {
    return filtered.filter((row) => row.decision === "follow");
  }
  if (currentFilter === "observe") {
    return filtered.filter((row) => row.decision === "observe");
  }
  return filtered;
}

function renderSignals(signals) {
  const filtered = applyFilter(signals);
  signalsBody.innerHTML = filtered
    .map(
      (row) => `
        <tr>
          <td><span class="${badgeClass(row.decision)}">${escapeHtml(labelDecision(row.decision))}</span></td>
          <td>${escapeHtml(labelCategory(row.category))}</td>
          <td class="market">
            <strong>${escapeHtml(row.title)}</strong>
            <span class="muted">${escapeHtml(row.slug)}</span>
          </td>
          <td>${escapeHtml(row.outcome)}</td>
          <td>${formatNumber(row.price, 3)}</td>
          <td>${formatNumber(row.size, 2)}</td>
          <td>${row.minutesBeforeStart === null ? "无" : formatNumber(row.minutesBeforeStart, 1)}</td>
          <td>${formatNumber(row.finalUnits, 2)}u</td>
          <td>
            <div class="actions">
              <button data-action="paper" data-title="${escapeHtml(row.title)}" data-slug="${escapeHtml(row.slug)}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">记纸面单</button>
              <button class="secondary" data-action="placed" data-title="${escapeHtml(row.title)}" data-slug="${escapeHtml(row.slug)}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">已下单</button>
              <button class="secondary" data-action="skipped" data-title="${escapeHtml(row.title)}" data-slug="${escapeHtml(row.slug)}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">已跳过</button>
            </div>
            <div class="muted">${escapeHtml(labelReason(row.reason))}</div>
          </td>
        </tr>
      `
    )
    .join("");
}

async function loadPaperTrades() {
  const response = await fetch("/api/paper-trades");
  const payload = await response.json();
  paperTradesBody.innerHTML = payload.rows
    .slice(0, 30)
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.recordedAt || "")}</td>
          <td class="market"><strong>${escapeHtml(row.title || "")}</strong><span class="muted">${escapeHtml(row.slug || "")}</span></td>
          <td>${escapeHtml(labelDecision(row.decision || ""))}</td>
          <td>${escapeHtml(row.units || "")}</td>
          <td>${escapeHtml(row.notes || "")}</td>
        </tr>
      `
    )
    .join("");
}

async function loadSignals() {
  statusText.textContent = "正在刷新...";
  const response = await fetch("/api/signals");
  const payload = await response.json();
  currentSignals = payload.signals;
  buildSummary(currentSignals);
  renderSignals(currentSignals);
  statusText.textContent = `已更新：${payload.updatedAt}`;
}

async function loadWallet() {
  const response = await fetch("/api/wallet");
  const payload = await response.json();
  buildWalletSummary(payload);
  renderPositions(payload.positions);
  renderRecentTrades(payload.recentTrades);
}

async function addPaperTrade(button) {
  const action = button.dataset.action;
  const defaultNote =
    action === "placed"
      ? "已手动下单"
      : action === "skipped"
      ? "本次跳过"
      : "";
  const notes = window.prompt("给这笔记录加一句备注：", defaultNote);
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
  renderSignals(currentSignals);
});

filterFollowBtn.addEventListener("click", () => {
  currentFilter = "follow";
  renderSignals(currentSignals);
});

filterObserveBtn.addEventListener("click", () => {
  currentFilter = "observe";
  renderSignals(currentSignals);
});

hoursSelect.addEventListener("change", () => {
  currentHours = Number(hoursSelect.value || 0);
  renderSignals(currentSignals);
});

Promise.all([loadWallet(), loadSignals(), loadPaperTrades()]).catch((error) => {
  statusText.textContent = `加载失败：${error.message}`;
});
