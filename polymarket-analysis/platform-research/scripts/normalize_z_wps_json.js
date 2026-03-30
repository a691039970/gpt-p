const fs = require("fs");
const path = require("path");

function readJsonWithBom(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function clean(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim();
}

function firstNumber(value) {
  const match = clean(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeTimestamp(detailText) {
  const lines = clean(detailText).split("\n").map(clean).filter(Boolean);
  const timestamps = lines.filter((line) => /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(line));
  return timestamps[0] ? `${timestamps[0].replace(" ", "T")}Z` : null;
}

function normalizeClosedAt(detailText) {
  const lines = clean(detailText).split("\n").map(clean).filter(Boolean);
  const timestamps = lines.filter((line) => /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(line));
  return timestamps[1] ? `${timestamps[1].replace(" ", "T")}Z` : null;
}

function normalizeDateOnly(value) {
  const match = clean(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? `${match[0]}T00:00:00Z` : null;
}

function parseSelection(selectionText) {
  const lines = clean(selectionText).split("\n").map(clean).filter(Boolean);
  const outcome = lines[0] || null;
  const matchup = lines[1] || null;
  const marketType = lines.find((line) => /让球盘|大小盘|独赢盘/.test(line)) || null;
  const tournament = lines.find((line) => /@ \d{4}-\d{2}-\d{2}/.test(line)) || null;

  return {
    outcome,
    matchup,
    marketType,
    tournament,
    selectionSide: inferSelectionSide(outcome, marketType),
    handicapValue: inferHandicapValue(outcome),
    totalValue: inferTotalValue(outcome),
    lines,
  };
}

function inferSelectionSide(outcome, marketType) {
  const text = clean(`${outcome || ""} ${marketType || ""}`);
  if (!text) return null;
  if (/大盘|over/i.test(text)) return "over";
  if (/小盘|under/i.test(text)) return "under";
  if (/和局|draw/i.test(text)) return "draw";
  if (/让球盘/.test(text)) {
    if (/[+-]\d+(\.\d+)?/.test(text)) return "handicap";
    return "handicap";
  }
  if (/独赢盘/.test(text)) return "winner";
  return "selection";
}

function inferHandicapValue(outcome) {
  const match = clean(outcome).match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function inferTotalValue(outcome) {
  const match = clean(outcome).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function inferCategory(sport, selection) {
  const text = `${sport || ""} ${selection || ""}`;
  if (/电子竞技/.test(text)) {
    if (/Dota 2/i.test(text)) return "Dota2";
    if (/Counter-Strike|CS2/i.test(text)) return "CS2";
    if (/LoL|League of Legends/i.test(text)) return "LoL";
    if (/Valorant/i.test(text)) return "Valorant";
    return "Esports";
  }
  if (/足球/.test(text)) return "Football";
  if (/篮球/.test(text)) return "Basketball";
  return "Other";
}

function normalizeRow(row, sourceFile) {
  const detailLines = clean(row["详细信息"]).split("\n").map(clean).filter(Boolean);
  const parsedSelection = parseSelection(row["选择队伍"]);
  const sport = detailLines[1] || null;
  const eventStart = normalizeDateOnly(parsedSelection.tournament || "");
  const amountRaw = clean(row["投注金额 (CNY)"]);
  const amount = firstNumber(amountRaw);
  const closedAt = normalizeClosedAt(row["详细信息"]);
  const winLoss = firstNumber(row["输赢"]);
  const statusText = clean(row["状态"]);
  const result =
    /输/.test(statusText) ? "loss" : /赢|预期盈利/.test(statusText) ? "win" : /走/.test(statusText) ? "push" : null;

  return {
    platform: "z",
    timestamp: normalizeTimestamp(row["详细信息"]),
    title: [parsedSelection.outcome, parsedSelection.matchup, parsedSelection.tournament]
      .filter(Boolean)
      .join(" | "),
    slug: null,
    outcome: parsedSelection.outcome,
    side: "BUY",
    price: firstNumber(row["赔率"]),
    size: amount,
    category: inferCategory(sport, row["选择队伍"]),
    event_start_time: eventStart,
    transaction_hash: null,
    result,
    realized_pnl: winLoss,
    unrealized_pnl: null,
    closed_at: closedAt,
    source_file: sourceFile,
    notes: [
      detailLines[0] ? `bet_id=${detailLines[0]}` : null,
      sport ? `sport=${sport}` : null,
      parsedSelection.marketType ? `market_type=${parsedSelection.marketType}` : null,
      parsedSelection.selectionSide ? `selection_side=${parsedSelection.selectionSide}` : null,
      parsedSelection.handicapValue !== null ? `handicap_value=${parsedSelection.handicapValue}` : null,
      parsedSelection.totalValue !== null ? `total_value=${parsedSelection.totalValue}` : null,
      parsedSelection.matchup ? `matchup=${parsedSelection.matchup}` : null,
      row["预期盈利"] ? `expected_profit=${clean(row["预期盈利"])}` : null,
      row["输赢"] ? `win_loss=${clean(row["输赢"])}` : null,
      row["状态"] ? `status=${statusText}` : null,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error("Usage: node normalize_z_wps_json.js <input-json> <output-json>");
    process.exit(1);
  }

  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputPath);
  const payload = readJsonWithBom(absoluteInput);
  const rows = (payload.rows || [])
    .map((row) => normalizeRow(row, absoluteInput))
    .filter((row) => row.timestamp && row.title && row.size !== null);

  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(
    absoluteOutput,
    JSON.stringify(
      {
        normalized_at: new Date().toISOString(),
        source_file: absoluteInput,
        row_count: rows.length,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ outputPath: absoluteOutput, rowCount: rows.length }, null, 2));
}

main();
