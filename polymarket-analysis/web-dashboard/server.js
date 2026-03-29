const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = 3187;
const WALLET = "0x490b4fE78B2FB36f733FeF1b340759e03500eec9";
const REVIEW_WALLET = "0x115edF00e95798fcE4B1c2786942Dc4A5da7f21c";
const STATIC_DIR = path.join(__dirname, "public");
const PAPER_LOG_PATH = path.join(__dirname, "paper-trades.json");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const TARGET_CATEGORIES = new Set(["Basketball", "CS2", "Dota2", "LoL"]);
const API_TIMEOUT_MS = 2500;
const BACKGROUND_TIMEOUT_MS = 5000;
const LIVE_POLL_INTERVAL_SEC = 8;
const REVIEW_INTERVAL_MIN = 5;

const liveClients = new Set();
const seenSourceTradeHashes = new Set();
const matchedSignalKeys = new Map();
let latestSourceTrades = [];
const runtimeState = {
  mode: "platform-centric",
  walletSource: {
    address: WALLET,
    role: "signal-source",
    deliveryMode: "polling_active",
    status: "starting",
    pollIntervalSec: LIVE_POLL_INTERVAL_SEC,
    lastTradeHash: null,
    lastSeenAt: null,
    lastPolledAt: null,
    lastBroadcastAt: null,
    newTradeCount: 0,
  },
  reviewTarget: {
    address: REVIEW_WALLET,
    role: "execution-review",
    reviewMode: "five_minute_check_active",
    status: "starting",
    reviewIntervalMin: REVIEW_INTERVAL_MIN,
    lastCheckedAt: null,
    lastMatchedTradeAt: null,
    matchedSignalCount: 0,
    notes: "Only verify whether B followed the same market/outcome BUY signal. Amount checks stay disabled.",
  },
  dashboard: {
    hideWalletPanels: true,
    focus: "pending execution and platform research",
    hideMatchedSuggestions: true,
  },
};

const POSITIONS_CACHE_PATH = path.join(
  OUTPUT_DIR,
  "0x490b4fe78b2fb36f733fef1b340759e03500eec9_positions.json"
);
const TRADES_CACHE_PATH = path.join(
  OUTPUT_DIR,
  "0x490b4fe78b2fb36f733fef1b340759e03500eec9_trades.json"
);
const BUY_TIMING_CACHE_PATH = path.join(
  OUTPUT_DIR,
  "0x490b4fe78b2fb36f733fef1b340759e03500eec9_trades_buy_timing.json"
);

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendFile(res, filePath, contentType) {
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    json(res, 404, { error: "not_found" });
  });
  res.writeHead(200, { "Content-Type": contentType });
  stream.pipe(res);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("body_too_large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function runPowerShellJson(command, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr || stdout || error.message;
          reject(new Error(detail.trim() || "powershell_command_failed"));
          return;
        }

        try {
          const raw = String(stdout || "");
          const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
          resolve(JSON.parse(normalized));
        } catch (parseError) {
          reject(new Error(`powershell_json_parse_failed: ${parseError.message}`));
        }
      }
    );
  });
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastSse(event, payload) {
  for (const client of liveClients) {
    writeSse(client, event, payload);
  }
}

function buildDecisionReasonCatalog() {
  return [
    {
      code: "trial_rule_match",
      label: "可跟",
      summary: "属于当前试行品类，价格未低于阈值，且时间权重没有被打折。",
      modelIntent: "优先复制当前最接近平台有效信号的盘口。",
    },
    {
      code: "time_discounted",
      label: "观察",
      summary: "信号可能有效，但离比赛开始较远或已过时，第一枪复制价值下降。",
      modelIntent: "避免过早跟入导致平台后续修正、补仓或对冲时失真。",
    },
    {
      code: "price_too_low",
      label: "不跟",
      summary: "价格过低，常见于尾盘残差、流动性差或极端赔率区域。",
      modelIntent: "减少为了追赔率而吃进低质量 alpha 的情况。",
    },
    {
      code: "category_not_in_trial",
      label: "不跟",
      summary: "当前只试行 Basketball、CS2、Dota2、LoL，其他品类暂不纳入。",
      modelIntent: "先把平台优势验证在样本更稳定的品类上，避免策略空间过大。",
    },
  ];
}

function buildPlatformContext() {
  return {
    viewpoint: "platform-over-person",
    thesis:
      "The current dashboard treats the observed wallet as one platform signal outlet, not as a person to imitate blindly. The long-term goal is to compare platform-quality signal streams and only surface executable opportunities.",
    addresses: {
      signalSource: WALLET,
      reviewTarget: REVIEW_WALLET,
    },
    platforms: [
      {
        id: "z",
        label: "Z平台",
        status: "research_target",
        note: "Primary platform under long-run strength hypothesis.",
      },
      {
        id: "p",
        label: "P平台",
        status: "research_target",
        note: "Comparison platform for style and cycle studies.",
      },
      {
        id: "r",
        label: "R平台",
        status: "reference_only",
        note: "Mentioned in research thesis, but current local data feed is not available.",
      },
    ],
    currentExecutionRules: {
      side: "BUY only",
      focusCategories: Array.from(TARGET_CATEGORIES),
      unitMode: "u-based sizing",
      firstSignalOnly: true,
      noAutoTrade: true,
      hideMatchedSuggestions: true,
      reviewRule:
        "B address review only checks whether the same market/outcome BUY was followed within an acceptable window. Amount verification remains disabled.",
    },
    decisionReasons: buildDecisionReasonCatalog(),
    nextBuildTargets: [
      "Real-time delivery when A emits a new trade",
      "Five-minute review loop for B follow correctness",
      "Hide completed B-followed items from the active window",
      "Shift dashboard language from wallet copy-trading to platform signal monitoring",
      "Prepare unified Z/P platform research schema",
    ],
  };
}

function buildSignalKey(row) {
  return `${row.slug || ""}::${row.outcome || ""}`;
}

function withReviewState(signals) {
  return signals
    .map((signal) => {
      const review = matchedSignalKeys.get(buildSignalKey(signal));
      return {
        ...signal,
        reviewStatus: review ? "matched" : "pending",
        reviewMatchedAt: review?.matchedAt || null,
      };
    });
}

function applyReviewStateToSignals(signals) {
  return withReviewState(signals).filter(
    (signal) => !(runtimeState.dashboard.hideMatchedSuggestions && signal.reviewStatus === "matched")
  );
}

function updateMatchedSignalState(reviewTrades, signals) {
  const matchedTradesByKey = new Map();

  for (const trade of reviewTrades) {
    if (trade.side !== "BUY") continue;
    const key = buildSignalKey(trade);
    if (!matchedTradesByKey.has(key)) {
      matchedTradesByKey.set(key, trade);
    }
  }

  matchedSignalKeys.clear();
  for (const signal of signals) {
    const key = buildSignalKey(signal);
    const matchedTrade = matchedTradesByKey.get(key);
    if (!matchedTrade) continue;
    matchedSignalKeys.set(key, {
      matchedAt: new Date(Number(matchedTrade.timestamp) * 1000).toISOString(),
      transactionHash: matchedTrade.transactionHash || null,
      slug: matchedTrade.slug || signal.slug,
      outcome: matchedTrade.outcome || signal.outcome,
    });
  }

  runtimeState.reviewTarget.matchedSignalCount = matchedSignalKeys.size;
  const latestMatch = Array.from(matchedSignalKeys.values())
    .map((item) => item.matchedAt)
    .filter(Boolean)
    .sort()
    .pop();
  runtimeState.reviewTarget.lastMatchedTradeAt = latestMatch || null;
}

function getCategory(title) {
  if (/Counter-Strike/i.test(title)) return "CS2";
  if (/Dota 2/i.test(title)) return "Dota2";
  if (/LoL:/i.test(title)) return "LoL";
  if (/Valorant/i.test(title)) return "Valorant";
  if (/Call of Duty/i.test(title)) return "CoD";
  if (/vs\.|Spread:|O\/U/i.test(title)) return "Basketball";
  return "Other";
}

function getBaseUnits(category, size) {
  if (category === "Basketball") {
    if (size < 666) return 1.0;
    if (size < 835) return 1.5;
    if (size < 1160) return 2.0;
    return 2.5;
  }
  if (category === "CS2") {
    if (size < 249) return 1.0;
    if (size < 802) return 1.5;
    if (size < 1509) return 2.0;
    return 2.5;
  }
  if (category === "Dota2") {
    if (size < 205) return 1.0;
    if (size < 400) return 1.5;
    if (size < 571) return 2.0;
    return 2.5;
  }
  if (category === "LoL") {
    if (size < 243) return 1.0;
    if (size < 352) return 1.5;
    if (size < 394) return 2.0;
    return 2.5;
  }
  return 0;
}

function getTimeMultiplier(minutesBeforeStart) {
  if (minutesBeforeStart < 0) return 0.7;
  if (minutesBeforeStart <= 60) return 1.0;
  if (minutesBeforeStart <= 180) return 0.8;
  return 0.6;
}

async function fetchJson(url, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "codex-polymarket-dashboard/1.0",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`request_failed_${response.status}`);
  }

  return response.json();
}

async function fetchTrades(wallet, timeoutMs = API_TIMEOUT_MS) {
  const url = `https://data-api.polymarket.com/trades?user=${wallet}&limit=200&offset=0`;
  try {
    const payload = await fetchJson(url, timeoutMs);
    return Array.isArray(payload) ? payload : payload.value || [];
  } catch (error) {
    const psCommand = `Invoke-RestMethod -Uri '${url}' | ConvertTo-Json -Depth 8`;
    const payload = await runPowerShellJson(psCommand, Math.max(timeoutMs, 8000));
    return Array.isArray(payload) ? payload : payload.value || [];
  }
}

async function fetchPositions(wallet, timeoutMs = API_TIMEOUT_MS) {
  const url = `https://data-api.polymarket.com/positions?user=${wallet}&limit=100&sortBy=CURRENT&sortDirection=DESC`;
  const payload = await fetchJson(url, timeoutMs);
  return Array.isArray(payload) ? payload : payload.value || [];
}

async function fetchMarketBySlug(slug, timeoutMs = API_TIMEOUT_MS) {
  const url = `https://gamma-api.polymarket.com/markets/slug/${slug}`;
  return fetchJson(url, timeoutMs);
}

function extractStartTime(market) {
  const candidates = [
    market?.gameStartTime,
    market?.startDateIso,
    market?.startDate,
    market?.events?.[0]?.startTime,
  ];
  const raw = candidates.find(Boolean);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function buildSignals() {
  const trades = await fetchTrades(WALLET);
  const buys = trades.filter((item) => item.side === "BUY");
  const latestBySlug = new Map();

  for (const trade of buys) {
    if (!latestBySlug.has(trade.slug)) {
      latestBySlug.set(trade.slug, trade);
    }
  }

  const signals = [];
  for (const trade of latestBySlug.values()) {
    const category = getCategory(trade.title || "");
    let market = null;
    let gameStartTime = null;
    let minutesBeforeStart = null;

    try {
      market = await fetchMarketBySlug(trade.slug);
      gameStartTime = extractStartTime(market);
      if (gameStartTime) {
        minutesBeforeStart = (gameStartTime.getTime() - Number(trade.timestamp) * 1000) / 60000;
      }
    } catch (error) {
      // leave timing fields null; UI will show missing timing.
    }

    const size = Number(trade.size);
    const price = Number(trade.price);
    let decision = "skip";
    let reason = "category_not_in_trial";
    let baseUnits = 0;
    let timeMultiplier = 0;
    let finalUnits = 0;

    if (TARGET_CATEGORIES.has(category)) {
      if (price < 0.1) {
        reason = "price_too_low";
      } else {
        baseUnits = getBaseUnits(category, size);
        timeMultiplier = minutesBeforeStart === null ? 0.6 : getTimeMultiplier(minutesBeforeStart);
        finalUnits = Math.round(baseUnits * timeMultiplier * 100) / 100;
        if (timeMultiplier < 1) {
          decision = "observe";
          reason = "time_discounted";
        } else {
          decision = "follow";
          reason = "trial_rule_match";
        }
      }
    }

    signals.push({
      wallet: WALLET,
      tradeTimeUtc: new Date(Number(trade.timestamp) * 1000).toISOString(),
      gameStartTimeUtc: gameStartTime ? gameStartTime.toISOString() : null,
      minutesBeforeStart: minutesBeforeStart === null ? null : Math.round(minutesBeforeStart * 100) / 100,
      category,
      title: trade.title,
      slug: trade.slug,
      outcome: trade.outcome,
      price,
      size,
      decision,
      reason,
      baseUnits,
      timeMultiplier,
      finalUnits,
      transactionHash: trade.transactionHash,
    });
  }

  return signals.sort((a, b) => new Date(b.tradeTimeUtc) - new Date(a.tradeTimeUtc));
}

function buildSignalsFromCache() {
  if (!fileExists(BUY_TIMING_CACHE_PATH)) {
    return [];
  }

  const rows = readJsonFile(BUY_TIMING_CACHE_PATH);
  const latestBySlug = new Map();
  for (const row of rows) {
    if (!latestBySlug.has(row.slug)) {
      latestBySlug.set(row.slug, row);
    }
  }

  const signals = [];
  for (const row of latestBySlug.values()) {
    const category = row.category || getCategory(row.title || "");
    const size = Number(row.size || 0);
    const price = Number(row.price || 0);
    const minutesBeforeStart =
      row.minutesBeforeStart === null || row.minutesBeforeStart === undefined
        ? null
        : Number(row.minutesBeforeStart);

    let decision = "skip";
    let reason = "category_not_in_trial";
    let baseUnits = 0;
    let timeMultiplier = 0;
    let finalUnits = 0;

    if (TARGET_CATEGORIES.has(category)) {
      if (price < 0.1) {
        reason = "price_too_low";
      } else {
        baseUnits = getBaseUnits(category, size);
        timeMultiplier = minutesBeforeStart === null ? 0.6 : getTimeMultiplier(minutesBeforeStart);
        finalUnits = Math.round(baseUnits * timeMultiplier * 100) / 100;
        if (timeMultiplier < 1) {
          decision = "observe";
          reason = "time_discounted";
        } else {
          decision = "follow";
          reason = "trial_rule_match";
        }
      }
    }

    signals.push({
      wallet: WALLET,
      tradeTimeUtc: row.tradeTimeUtc,
      gameStartTimeUtc: row.gameStartTimeUtc,
      minutesBeforeStart,
      category,
      title: row.title,
      slug: row.slug,
      outcome: row.outcome,
      price,
      size,
      decision,
      reason,
      baseUnits,
      timeMultiplier,
      finalUnits,
      transactionHash: row.transactionHash || "",
    });
  }

  return signals.sort((a, b) => new Date(b.tradeTimeUtc) - new Date(a.tradeTimeUtc));
}

async function buildWalletSnapshot() {
  const [positions, trades] = await Promise.all([fetchPositions(WALLET), fetchTrades(WALLET)]);

  const normalizedPositions = positions.map((item) => ({
    title: item.title,
    outcome: item.outcome,
    size: Number(item.size || 0),
    avgPrice: Number(item.avgPrice || 0),
    curPrice: Number(item.curPrice || 0),
    currentValue: Number(item.currentValue || 0),
    cashPnl: Number(item.cashPnl || 0),
    percentPnl: Number(item.percentPnl || 0),
    endDate: item.endDate || null,
    slug: item.slug || "",
  }));

  const recentTrades = trades.slice(0, 30).map((item) => ({
    tradeTimeUtc: new Date(Number(item.timestamp) * 1000).toISOString(),
    title: item.title,
    slug: item.slug,
    outcome: item.outcome,
    side: item.side,
    price: Number(item.price || 0),
    size: Number(item.size || 0),
    transactionHash: item.transactionHash,
  }));

  const totals = normalizedPositions.reduce(
    (acc, item) => {
      acc.initialValue += item.avgPrice * item.size;
      acc.currentValue += item.currentValue;
      acc.cashPnl += item.cashPnl;
      return acc;
    },
    { initialValue: 0, currentValue: 0, cashPnl: 0 }
  );

  return {
    wallet: WALLET,
    updatedAt: new Date().toISOString(),
    positions: normalizedPositions,
    recentTrades,
    totals: {
      count: normalizedPositions.length,
      initialValue: Math.round(totals.initialValue * 100) / 100,
      currentValue: Math.round(totals.currentValue * 100) / 100,
      cashPnl: Math.round(totals.cashPnl * 100) / 100,
    },
  };
}

function buildWalletSnapshotFromCache() {
  const positions = fileExists(POSITIONS_CACHE_PATH) ? readJsonFile(POSITIONS_CACHE_PATH) : [];
  const trades = fileExists(TRADES_CACHE_PATH) ? readJsonFile(TRADES_CACHE_PATH) : [];

  const normalizedPositions = positions.map((item) => ({
    title: item.title,
    outcome: item.outcome,
    size: Number(item.size || 0),
    avgPrice: Number(item.avgPrice || 0),
    curPrice: Number(item.curPrice || 0),
    currentValue: Number(item.currentValue || 0),
    cashPnl: Number(item.cashPnl || 0),
    percentPnl: Number(item.percentPnl || 0),
    endDate: item.endDate || null,
    slug: item.slug || "",
  }));

  const recentTrades = trades.slice(0, 30).map((item) => ({
    tradeTimeUtc: new Date(Number(item.timestamp) * 1000).toISOString(),
    title: item.title,
    slug: item.slug,
    outcome: item.outcome,
    side: item.side,
    price: Number(item.price || 0),
    size: Number(item.size || 0),
    transactionHash: item.transactionHash || "",
  }));

  const totals = normalizedPositions.reduce(
    (acc, item) => {
      acc.initialValue += item.avgPrice * item.size;
      acc.currentValue += item.currentValue;
      acc.cashPnl += item.cashPnl;
      return acc;
    },
    { initialValue: 0, currentValue: 0, cashPnl: 0 }
  );

  return {
    wallet: WALLET,
    updatedAt: new Date().toISOString(),
    positions: normalizedPositions,
    recentTrades,
    totals: {
      count: normalizedPositions.length,
      initialValue: Math.round(totals.initialValue * 100) / 100,
      currentValue: Math.round(totals.currentValue * 100) / 100,
      cashPnl: Math.round(totals.cashPnl * 100) / 100,
    },
    source: "cache",
  };
}

async function loadSignalsForReview() {
  const cachedSignals = buildSignalsFromCache();
  if (cachedSignals.length > 0) {
    return cachedSignals;
  }

  try {
    return await buildSignals();
  } catch {
    return [];
  }
}

async function loadAllSignalsForArchive() {
  const cachedSignals = buildSignalsFromCache();
  if (cachedSignals.length > 0) {
    return withReviewState(cachedSignals);
  }

  try {
    return withReviewState(await buildSignals());
  } catch {
    return [];
  }
}

async function pollSourceTrades() {
  runtimeState.walletSource.lastPolledAt = new Date().toISOString();

  try {
    const trades = await fetchTrades(WALLET, BACKGROUND_TIMEOUT_MS);
    const recentTrades = trades.slice(0, 30).map((item) => ({
      tradeTimeUtc: new Date(Number(item.timestamp) * 1000).toISOString(),
      title: item.title,
      slug: item.slug,
      outcome: item.outcome,
      side: item.side,
      price: Number(item.price || 0),
      size: Number(item.size || 0),
      transactionHash: item.transactionHash || "",
    }));

    latestSourceTrades = recentTrades;

    const newTrades = [];
    for (const trade of trades) {
      if (!trade.transactionHash) continue;
      if (seenSourceTradeHashes.has(trade.transactionHash)) continue;
      seenSourceTradeHashes.add(trade.transactionHash);
      newTrades.push(trade);
    }

    runtimeState.walletSource.status = "running";
    runtimeState.walletSource.lastError = null;
    runtimeState.walletSource.lastSeenAt = recentTrades[0]?.tradeTimeUtc || runtimeState.walletSource.lastSeenAt;
    runtimeState.walletSource.lastTradeHash = recentTrades[0]?.transactionHash || runtimeState.walletSource.lastTradeHash;

    if (newTrades.length > 0) {
      runtimeState.walletSource.newTradeCount += newTrades.length;
      runtimeState.walletSource.lastBroadcastAt = new Date().toISOString();
      broadcastSse(
        "source-trade",
        newTrades.slice(0, 10).map((trade) => ({
          tradeTimeUtc: new Date(Number(trade.timestamp) * 1000).toISOString(),
          title: trade.title,
          slug: trade.slug,
          outcome: trade.outcome,
          side: trade.side,
          price: Number(trade.price || 0),
          size: Number(trade.size || 0),
          transactionHash: trade.transactionHash || "",
        }))
      );
    }
  } catch (error) {
    runtimeState.walletSource.status = "degraded";
    runtimeState.walletSource.lastError = error.message;
  }
}

async function reviewFollowExecution() {
  runtimeState.reviewTarget.lastCheckedAt = new Date().toISOString();

  try {
    const [reviewTrades, activeSignals] = await Promise.all([
      fetchTrades(REVIEW_WALLET, BACKGROUND_TIMEOUT_MS),
      loadSignalsForReview(),
    ]);
    updateMatchedSignalState(reviewTrades, activeSignals);
    runtimeState.reviewTarget.status = "running";
    runtimeState.reviewTarget.lastError = null;
    broadcastSse("review-status", {
      updatedAt: new Date().toISOString(),
      matchedSignalCount: runtimeState.reviewTarget.matchedSignalCount,
      lastMatchedTradeAt: runtimeState.reviewTarget.lastMatchedTradeAt,
    });
  } catch (error) {
    runtimeState.reviewTarget.status = "degraded";
    runtimeState.reviewTarget.lastError = error.message;
  }
}

function loadPaperTrades() {
  if (!fs.existsSync(PAPER_LOG_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(PAPER_LOG_PATH, "utf8"));
  } catch {
    return [];
  }
}

function savePaperTrades(rows) {
  fs.writeFileSync(PAPER_LOG_PATH, JSON.stringify(rows, null, 2));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/platform-context") {
    return json(res, 200, {
      updatedAt: new Date().toISOString(),
      context: buildPlatformContext(),
      runtimeState,
    });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/runtime-status") {
    return json(res, 200, {
      updatedAt: new Date().toISOString(),
      runtimeState,
      liveClientCount: liveClients.size,
    });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/live-updates") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write("\n");
    liveClients.add(res);
    writeSse(res, "hello", {
      updatedAt: new Date().toISOString(),
      runtimeState,
      message: "SSE channel ready. Polling loop is scaffolded but not auto-started yet.",
    });
    req.on("close", () => {
      liveClients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/signals") {
    try {
      const signals = applyReviewStateToSignals(await buildSignals());
      return json(res, 200, { wallet: WALLET, signals, updatedAt: new Date().toISOString() });
    } catch (error) {
      const signals = applyReviewStateToSignals(buildSignalsFromCache());
      return json(res, 200, {
        wallet: WALLET,
        signals,
        updatedAt: new Date().toISOString(),
        source: "cache",
        warning: `live_fetch_failed: ${error.message}`,
      });
    }
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/review-archive") {
    try {
      const signals = (await loadAllSignalsForArchive())
        .filter((signal) => signal.reviewStatus === "matched")
        .sort((a, b) => new Date(b.reviewMatchedAt || 0) - new Date(a.reviewMatchedAt || 0));
      return json(res, 200, {
        wallet: WALLET,
        reviewTarget: REVIEW_WALLET,
        rows: signals,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return json(res, 200, {
        wallet: WALLET,
        reviewTarget: REVIEW_WALLET,
        rows: [],
        updatedAt: new Date().toISOString(),
        warning: `review_archive_failed: ${error.message}`,
      });
    }
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/wallet") {
    try {
      const snapshot = await buildWalletSnapshot();
      return json(res, 200, snapshot);
    } catch (error) {
      const snapshot = buildWalletSnapshotFromCache();
      return json(res, 200, {
        ...snapshot,
        warning: `live_fetch_failed: ${error.message}`,
      });
    }
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/paper-trades") {
    return json(res, 200, { rows: loadPaperTrades() });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/paper-trades") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const rows = loadPaperTrades();
      const nextRow = {
        id: `${Date.now()}`,
        recordedAt: new Date().toISOString(),
        ...payload,
      };
      rows.unshift(nextRow);
      savePaperTrades(rows);
      broadcastSse("paper-trade", nextRow);
      return json(res, 200, { ok: true, rows });
    } catch (error) {
      return json(res, 400, { error: "paper_trade_write_failed", detail: error.message });
    }
  }

  if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
    return sendFile(res, path.join(STATIC_DIR, "index.platform.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/app.js") {
    return sendFile(res, path.join(STATIC_DIR, "app.js"), "application/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/app.fixed.js") {
    return sendFile(res, path.join(STATIC_DIR, "app.fixed.js"), "application/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/app.platform.js") {
    return sendFile(res, path.join(STATIC_DIR, "app.platform.js"), "application/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/styles.css") {
    return sendFile(res, path.join(STATIC_DIR, "styles.css"), "text/css; charset=utf-8");
  }

  return json(res, 404, { error: "not_found" });
});

pollSourceTrades().catch(() => {});
reviewFollowExecution().catch(() => {});
setInterval(() => {
  pollSourceTrades().catch(() => {});
}, LIVE_POLL_INTERVAL_SEC * 1000);
setInterval(() => {
  reviewFollowExecution().catch(() => {});
}, REVIEW_INTERVAL_MIN * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
});
