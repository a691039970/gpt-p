const fs = require("fs");
const path = require("path");

function clean(value) {
  return String(value || "")
    .replace(/[!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCategory(text) {
  const hay = text.toLowerCase();
  if (hay.includes("dota")) return "Dota2";
  if (hay.includes("counter-strike") || hay.includes("cs2")) return "CS2";
  if (hay.includes("lol") || hay.includes("league of legends")) return "LoL";
  if (hay.includes("fifa")) return "FIFA";
  if (hay.includes("valorant")) return "Valorant";
  if (hay.includes("basketball") || hay.includes("nba")) return "Basketball";
  return null;
}

function buildTitle(lines) {
  const filtered = (lines || []).filter((line) => {
    const value = clean(line);
    if (!value) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
    if (/^@\s*\d{4}-\d{2}-\d{2}/.test(value)) return false;
    if (/^[:(]/.test(value)) return false;
    if (/^\d+(\.\d+)?$/.test(value)) return false;
    return true;
  });
  return filtered.join(" | ") || null;
}

function buildEventStart(lines) {
  const raw = (lines || []).find((line) => /^@\s*\d{4}-\d{2}-\d{2}/.test(clean(line)));
  if (!raw) return null;
  const date = clean(raw).replace(/^@\s*/, "");
  return `${date}T00:00:00Z`;
}

function normalizeRecord(record, sourceFile) {
  const title = buildTitle(record.extracted_lines);
  const side = "BUY";
  const price = record.odds_raw ? Number(record.odds_raw) : null;
  const size = record.stake_raw ? Number(record.stake_raw) : null;
  const eventStart = buildEventStart(record.extracted_lines);
  const category = inferCategory(`${title || ""} ${(record.extracted_lines || []).join(" ")}`);

  return {
    platform: "z",
    timestamp: record.timestamp_raw ? `${record.timestamp_raw.replace(" ", "T")}Z` : null,
    title,
    slug: null,
    outcome: null,
    side,
    price,
    size,
    category,
    event_start_time: eventStart,
    transaction_hash: null,
    result: null,
    realized_pnl: record.payout_raw ? Number(record.payout_raw) - Number(record.stake_raw || 0) : null,
    unrealized_pnl: null,
    closed_at: null,
    source_file: sourceFile,
    notes: `source_bet_id=${record.source_bet_id}; extracted_lines=${(record.extracted_lines || []).join(" || ")}`,
  };
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error("Usage: node normalize_z_staging.js <staging-json> <normalized-json>");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  const rows = (payload.records || [])
    .map((record) => normalizeRecord(record, payload.source_file))
    .filter((row) => row.timestamp && row.size !== null);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outputPath),
    JSON.stringify(
      {
        normalized_at: new Date().toISOString(),
        source_file: payload.source_file,
        row_count: rows.length,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ outputPath: path.resolve(outputPath), rowCount: rows.length }, null, 2));
}

main();
