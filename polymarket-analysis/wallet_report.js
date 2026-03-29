const fs = require("fs");
const path = require("path");

const API_BASE = "https://data-api.polymarket.com";

function buildUrl(endpoint, params) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "codex-polymarket-analysis/1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed ${response.status}: ${body}`);
  }

  return response.json();
}

function formatNumber(value, digits = 6) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return Number(value).toFixed(digits);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return `${Number(value).toFixed(2)}%`;
}

function formatDate(value) {
  if (!value && value !== 0) {
    return "N/A";
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function summarizePositions(positions) {
  const totalCurrentValue = positions.reduce((sum, item) => sum + Number(item.currentValue || 0), 0);
  const totalInitialValue = positions.reduce((sum, item) => sum + Number(item.initialValue || 0), 0);
  const totalCashPnl = positions.reduce((sum, item) => sum + Number(item.cashPnl || 0), 0);

  return {
    count: positions.length,
    totalCurrentValue,
    totalInitialValue,
    totalCashPnl,
  };
}

function summarizeTrades(trades) {
  const buyCount = trades.filter((item) => item.side === "BUY").length;
  const sellCount = trades.filter((item) => item.side === "SELL").length;
  const latestTrade = trades[0] || null;

  return {
    count: trades.length,
    buyCount,
    sellCount,
    latestTrade,
  };
}

function renderReport(wallet, positions, trades) {
  const positionSummary = summarizePositions(positions);
  const tradeSummary = summarizeTrades(trades);

  const lines = [];
  lines.push(`Wallet: ${wallet}`);
  lines.push("");
  lines.push("Current Positions");
  lines.push(`- Count: ${positionSummary.count}`);
  lines.push(`- Total initial value: ${formatNumber(positionSummary.totalInitialValue)}`);
  lines.push(`- Total current value: ${formatNumber(positionSummary.totalCurrentValue)}`);
  lines.push(`- Total unrealized PnL: ${formatNumber(positionSummary.totalCashPnl)}`);
  lines.push("");

  positions.forEach((item, index) => {
    lines.push(`Position ${index + 1}`);
    lines.push(`- Market: ${item.title || "N/A"}`);
    lines.push(`- Outcome: ${item.outcome || "N/A"}`);
    lines.push(`- Size: ${formatNumber(item.size)}`);
    lines.push(`- Avg price: ${formatNumber(item.avgPrice)}`);
    lines.push(`- Current price: ${formatNumber(item.curPrice)}`);
    lines.push(`- Current value: ${formatNumber(item.currentValue)}`);
    lines.push(`- Cash PnL: ${formatNumber(item.cashPnl)}`);
    lines.push(`- Percent PnL: ${formatPercent(item.percentPnl)}`);
    lines.push(`- End date: ${formatDate(item.endDate)}`);
    lines.push("");
  });

  lines.push("Recent Trades");
  lines.push(`- Count fetched: ${tradeSummary.count}`);
  lines.push(`- BUY trades: ${tradeSummary.buyCount}`);
  lines.push(`- SELL trades: ${tradeSummary.sellCount}`);
  if (tradeSummary.latestTrade) {
    lines.push(`- Latest trade time: ${formatDate(tradeSummary.latestTrade.timestamp)}`);
    lines.push(`- Latest market: ${tradeSummary.latestTrade.title || "N/A"}`);
    lines.push(`- Latest side: ${tradeSummary.latestTrade.side || "N/A"}`);
    lines.push(`- Latest outcome: ${tradeSummary.latestTrade.outcome || "N/A"}`);
    lines.push(`- Latest price: ${formatNumber(tradeSummary.latestTrade.price)}`);
    lines.push(`- Latest size: ${formatNumber(tradeSummary.latestTrade.size)}`);
  }
  lines.push("");

  trades.slice(0, 10).forEach((item, index) => {
    lines.push(`Trade ${index + 1}`);
    lines.push(`- Time: ${formatDate(item.timestamp)}`);
    lines.push(`- Market: ${item.title || "N/A"}`);
    lines.push(`- Side: ${item.side || "N/A"}`);
    lines.push(`- Outcome: ${item.outcome || "N/A"}`);
    lines.push(`- Price: ${formatNumber(item.price)}`);
    lines.push(`- Size: ${formatNumber(item.size)}`);
    lines.push(`- Transaction: ${item.transactionHash || "N/A"}`);
    lines.push("");
  });

  return lines.join("\n");
}

async function main() {
  const wallet = process.argv[2];
  const outputDir = process.argv[3] || path.join(process.cwd(), "output");

  if (!wallet) {
    throw new Error("Usage: node wallet_report.js <wallet> [outputDir]");
  }

  const positionsUrl = buildUrl("/positions", {
    user: wallet,
    limit: 50,
    sortBy: "CURRENT",
    sortDirection: "DESC",
  });

  const tradesUrl = buildUrl("/trades", {
    user: wallet,
    limit: 100,
  });

  const [positionsRaw, tradesRaw] = await Promise.all([
    fetchJson(positionsUrl),
    fetchJson(tradesUrl),
  ]);

  const positions = Array.isArray(positionsRaw) ? positionsRaw : positionsRaw.value || [];
  const trades = Array.isArray(tradesRaw) ? tradesRaw : tradesRaw.value || [];

  const report = renderReport(wallet, positions, trades);
  fs.mkdirSync(outputDir, { recursive: true });

  const safeWallet = wallet.toLowerCase();
  fs.writeFileSync(path.join(outputDir, `${safeWallet}_positions.json`), JSON.stringify(positions, null, 2));
  fs.writeFileSync(path.join(outputDir, `${safeWallet}_trades.json`), JSON.stringify(trades, null, 2));
  fs.writeFileSync(path.join(outputDir, `${safeWallet}_report.txt`), report);

  process.stdout.write(report);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
