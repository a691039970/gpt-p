const refreshBtn = document.getElementById("refreshBtn");
const filterAllBtn = document.getElementById("filterAllBtn");
const filterFollowBtn = document.getElementById("filterFollowBtn");
const filterObserveBtn = document.getElementById("filterObserveBtn");
const hoursSelect = document.getElementById("hoursSelect");
const beforeDateTimeInput = document.getElementById("beforeDateTimeInput");
const clearDateFilterBtn = document.getElementById("clearDateFilterBtn");
const statusText = document.getElementById("statusText");
const summaryGrid = document.getElementById("summaryGrid");
const platformSummaryGrid = document.getElementById("platformSummaryGrid");
const reviewSummaryGrid = document.getElementById("reviewSummaryGrid");
const decisionReasons = document.getElementById("decisionReasons");
const recentTradesBody = document.getElementById("recentTradesBody");
const signalsBody = document.getElementById("signalsBody");
const reviewArchiveBody = document.getElementById("reviewArchiveBody");
const paperTradesBody = document.getElementById("paperTradesBody");

let currentSignals = [];
let currentFilter = "all";
let currentHours = 0;
let currentBeforeTimestamp = null;
let platformContext = null;
let runtimeStatus = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "无";
  return Number(value).toFixed(digits);
}

function formatLocalDateTime(value) {
  if (!value) return "未开始";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function badgeClass(decision) {
  if (decision === "follow") return "badge follow";
  if (decision === "observe") return "badge observe";
  return "badge skip";
}

function labelDecision(decision) {
  if (decision === "follow") return "跟";
  if (decision === "observe") return "观察";
  return "不跟";
}

function labelCategory(category) {
  if (category === "Basketball") return "篮球";
  if (category === "CS2") return "CS2";
  if (category === "Dota2") return "Dota2";
  if (category === "LoL") return "LoL";
  if (category === "Valorant") return "无畏契约";
  if (category === "CoD") return "使命召唤";
  if (category === "Other") return "其他";
  return category || "";
}

function labelReason(reason) {
  if (reason === "trial_rule_match") return "符合试行规则";
  if (reason === "time_discounted") return "时间权重打折";
  if (reason === "price_too_low") return "价格过低";
  if (reason === "category_not_in_trial") return "不在试行品类";
  if (reason === "tier_not_defined") return "仓位档位未定义";
  return reason || "";
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

function applySignalFilter(signals) {
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

function buildSignalSummary(signals) {
  const followCount = signals.filter((row) => row.decision === "follow").length;
  const observeCount = signals.filter((row) => row.decision === "observe").length;
  const skipCount = signals.filter((row) => row.decision === "skip").length;
  const totalUnits = signals
    .filter((row) => row.decision !== "skip")
    .reduce((sum, row) => sum + Number(row.finalUnits || 0), 0);

  buildCards(summaryGrid, [
    { title: "可跟", value: followCount, hint: "当前规则下可直接试行的盘口" },
    { title: "观察", value: observeCount, hint: "信号可能有效，但复制时点被打折" },
    { title: "不跟", value: skipCount, hint: "当前暂不复制的盘口" },
    { title: "建议总仓位", value: formatNumber(totalUnits), hint: "所有非 skip 信号的总仓位建议" },
  ]);
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

function renderSignals(signals) {
  const filtered = applySignalFilter(signals);
  buildSignalSummary(filtered);
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
          <td>${row.minutesBeforeStart === null ? "无" : formatNumber(row.minutesBeforeStart, 1)}</td>
          <td>${formatNumber(row.finalUnits, 2)}u</td>
          <td>
            <div class="actions">
              <button data-action="paper" data-title="${escapeHtml(row.title || "")}" data-slug="${escapeHtml(row.slug || "")}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">记纸面单</button>
              <button class="secondary" data-action="placed" data-title="${escapeHtml(row.title || "")}" data-slug="${escapeHtml(row.slug || "")}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">已下单</button>
              <button class="secondary" data-action="skipped" data-title="${escapeHtml(row.title || "")}" data-slug="${escapeHtml(row.slug || "")}" data-decision="${escapeHtml(row.decision)}" data-units="${formatNumber(row.finalUnits, 2)}">已跳过</button>
            </div>
            <div class="muted">${escapeHtml(labelReason(row.reason))}</div>
          </td>
        </tr>
      `
    )
    .join("");
  return filtered;
}

function renderDecisionReasons(reasons) {
  decisionReasons.innerHTML = (reasons || [])
    .map(
      (reason) => `
        <article class="summary-card">
          <h3>${escapeHtml(reason.label)}</h3>
          <p><strong>${escapeHtml(reason.code)}</strong></p>
          <p>${escapeHtml(reason.summary)}</p>
          <p>${escapeHtml(reason.modelIntent)}</p>
        </article>
      `
    )
    .join("");
}

function renderReviewArchive(rows) {
  reviewArchiveBody.innerHTML = (rows || [])
    .slice(0, 30)
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.reviewMatchedAt || "")}</td>
          <td class="market">
            <strong>${escapeHtml(row.title || "")}</strong>
            <span class="muted">${escapeHtml(row.slug || "")}</span>
          </td>
          <td>${escapeHtml(row.outcome || "")}</td>
          <td><span class="${badgeClass(row.decision)}">${escapeHtml(labelDecision(row.decision))}</span></td>
          <td>${formatNumber(row.finalUnits, 2)}u</td>
        </tr>
      `
    )
    .join("");
}

function renderPlatformStatus() {
  const context = platformContext?.context;
  const runtime = runtimeStatus?.runtimeState || platformContext?.runtimeState;

  if (!context || !runtime) return;

  buildCards(platformSummaryGrid, [
    {
      title: "视角",
      value: "平台对平台",
      hint: "地址只是平台信号流的出口，不是策略核心。",
    },
    {
      title: "A 实时递送",
      value: runtime.walletSource.status,
      hint: `计划 ${runtime.walletSource.pollIntervalSec} 秒轮询一次`,
    },
    {
      title: "B 五分钟复核",
      value: runtime.reviewTarget.status,
      hint: `计划每 ${runtime.reviewTarget.reviewIntervalMin} 分钟检查是否跟到同盘口同方向 BUY`,
    },
    {
      title: "活动窗口",
      value: runtime.dashboard.hideWalletPanels ? "只显示待处理机会" : "显示全量面板",
      hint: "已完成项目后续会自动归档退出主窗口。",
    },
  ]);

  buildCards(reviewSummaryGrid, [
    {
      title: "B 地址",
      value: runtime.reviewTarget.address,
      hint: "只验证是否跟到，不验证金额。",
    },
    {
      title: "上次复核",
      value: formatLocalDateTime(runtime.reviewTarget.lastCheckedAt),
      hint: "当前还没有启动自动复核循环。",
    },
    {
      title: "最近匹配",
      value: formatLocalDateTime(runtime.reviewTarget.lastMatchedTradeAt),
      hint: "用于标记 B 是否已经跟到当前建议。",
    },
    {
      title: "研究对象",
      value: (context.platforms || []).map((item) => item.label).join(" / "),
      hint: "当前优先聚焦 Z/P 平台研究，R 作为参考框架保留。",
    },
  ]);

  renderDecisionReasons(context.decisionReasons);
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
    parts.push("只看可跟");
  } else if (currentFilter === "observe") {
    parts.push("只看观察");
  }
  parts.push(`显示 ${filteredSignals.length} 条`);
  statusText.textContent = parts.join(" | ");
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
  statusText.textContent = "正在刷新...";
  const response = await fetch("/api/signals");
  const payload = await response.json();
  currentSignals = payload.signals || [];
  const filtered = renderSignals(currentSignals);
  updateStatusText(`已更新：${payload.updatedAt || ""}`, filtered);
}

async function loadWalletTrades() {
  const response = await fetch("/api/wallet");
  const payload = await response.json();
  renderRecentTrades(payload.recentTrades || []);
}

async function loadPlatformContext() {
  const response = await fetch("/api/platform-context");
  platformContext = await response.json();
  renderPlatformStatus();
}

async function loadRuntimeStatus() {
  const response = await fetch("/api/runtime-status");
  runtimeStatus = await response.json();
  renderPlatformStatus();
}

async function loadReviewArchive() {
  const response = await fetch("/api/review-archive");
  const payload = await response.json();
  renderReviewArchive(payload.rows || []);
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

function connectLiveUpdates() {
  const source = new EventSource("/api/live-updates");
  source.addEventListener("hello", async () => {
    await loadRuntimeStatus();
  });
  source.addEventListener("source-trade", async () => {
    await Promise.all([loadRuntimeStatus(), loadWalletTrades(), loadSignals()]);
  });
  source.addEventListener("review-status", async () => {
    await Promise.all([loadRuntimeStatus(), loadSignals(), loadReviewArchive()]);
  });
  source.addEventListener("paper-trade", async () => {
    await loadPaperTrades();
  });
  source.onerror = () => {
    statusText.textContent = "实时通道暂未连通，面板仍可手动刷新。";
  };
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  await addPaperTrade(button);
});

refreshBtn.addEventListener("click", async () => {
  await Promise.all([loadSignals(), loadWalletTrades(), loadPaperTrades(), loadRuntimeStatus(), loadReviewArchive()]);
});

filterAllBtn.addEventListener("click", () => {
  currentFilter = "all";
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "已应用筛选", filtered);
});

filterFollowBtn.addEventListener("click", () => {
  currentFilter = "follow";
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "已应用筛选", filtered);
});

filterObserveBtn.addEventListener("click", () => {
  currentFilter = "observe";
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "已应用筛选", filtered);
});

hoursSelect.addEventListener("change", () => {
  currentHours = Number(hoursSelect.value || 0);
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "已应用筛选", filtered);
});

beforeDateTimeInput.addEventListener("change", () => {
  const timestamp = beforeDateTimeInput.value ? new Date(beforeDateTimeInput.value).getTime() : Number.NaN;
  currentBeforeTimestamp = Number.isNaN(timestamp) ? null : timestamp;
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "已应用筛选", filtered);
});

clearDateFilterBtn.addEventListener("click", () => {
  beforeDateTimeInput.value = "";
  currentBeforeTimestamp = null;
  const filtered = renderSignals(currentSignals);
  updateStatusText(statusText.textContent.split(" | ")[0] || "已应用筛选", filtered);
});

Promise.all([loadPlatformContext(), loadRuntimeStatus(), loadWalletTrades(), loadSignals(), loadPaperTrades(), loadReviewArchive()])
  .then(() => {
    connectLiveUpdates();
  })
  .catch((error) => {
    statusText.textContent = `加载失败：${error.message}`;
  });
