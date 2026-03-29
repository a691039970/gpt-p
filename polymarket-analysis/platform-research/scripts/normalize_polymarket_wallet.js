const fs = require("fs");
const path = require("path");

function inferCategory(title) {
  const text = String(title || "");
  if (/Counter-Strike/i.test(text)) return "CS2";
  if (/Dota 2/i.test(text)) return "Dota2";
  if (/LoL:/i.test(text)) return "LoL";
  if (/Valorant/i.test(text)) return "Valorant";
  if (/Call of Duty/i.test(text)) return "CoD";
  if (/vs\.|Spread:|O\/U/i.test(text)) return "Basketball";
  return "Other";
}

function readJsonWithBom(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function buildPositionMap(positions) {
  const map = new Map();
  for (const row of positions || []) {
    const key = `${row.slug || ""}::${row.outcome || ""}`;
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

function normalizeTrade(trade, platform, sourceFile, positionMap) {
  const key = `${trade.slug || ""}::${trade.outcome || ""}`;
  const matchingPosition = positionMap.get(key);
  return {
    platform,
    timestamp: new Date(Number(trade.timestamp) * 1000).toISOString(),
    title: trade.title || "",
    slug: trade.slug || "",
    outcome: trade.outcome || "",
    side: trade.side || "UNKNOWN",
    price: Number(trade.price || 0),
    size: Number(trade.size || 0),
    category: inferCategory(trade.title || ""),
    event_start_time: null,
    transaction_hash: trade.transactionHash || null,
    result: null,
    realized_pnl: null,
    unrealized_pnl: matchingPosition ? Number(matchingPosition.cashPnl || 0) : null,
    closed_at: null,
    source_file: sourceFile,
    notes: matchingPosition
      ? `position_percent_pnl=${Number(matchingPosition.percentPnl || 0)}`
      : null,
  };
}

function main() {
  const tradesPath = process.argv[2];
  const positionsPath = process.argv[3];
  const platform = process.argv[4];
  const outputPath = process.argv[5];

  if (!tradesPath || !positionsPath || !platform || !outputPath) {
    console.error(
      "Usage: node normalize_polymarket_wallet.js <trades-json> <positions-json> <platform> <output-json>"
    );
    process.exit(1);
  }

  const absoluteTrades = path.resolve(tradesPath);
  const absolutePositions = path.resolve(positionsPath);
  const absoluteOutput = path.resolve(outputPath);

  const trades = readJsonWithBom(absoluteTrades);
  const positions = readJsonWithBom(absolutePositions);
  const positionMap = buildPositionMap(positions);

  const rows = (trades || []).map((trade) =>
    normalizeTrade(trade, platform, absoluteTrades, positionMap)
  );

  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(
    absoluteOutput,
    JSON.stringify(
      {
        normalized_at: new Date().toISOString(),
        source_file: absoluteTrades,
        position_source_file: absolutePositions,
        platform,
        row_count: rows.length,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ outputPath: absoluteOutput, rowCount: rows.length, platform }, null, 2));
}

main();
