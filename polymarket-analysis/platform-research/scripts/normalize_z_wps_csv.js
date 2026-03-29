const fs = require("fs");
const path = require("path");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((item) => String(item).length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function clean(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim();
}

function firstNumber(value) {
  const match = clean(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function inferCategory(sportLine, detailText) {
  const sport = clean(sportLine);
  if (sport.includes("电子竞技")) {
    if (/Dota 2/i.test(detailText)) return "Dota2";
    if (/Counter-Strike|CS2/i.test(detailText)) return "CS2";
    if (/LoL|League of Legends/i.test(detailText)) return "LoL";
    if (/Valorant/i.test(detailText)) return "Valorant";
    return "Esports";
  }
  if (sport.includes("足球")) return "Football";
  if (sport.includes("篮球")) return "Basketball";
  return sport || "unknown";
}

function normalizeTimestamp(value) {
  const match = clean(value).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  return match ? `${match[0].replace(" ", "T")}Z` : null;
}

function normalizeDateOnly(value) {
  const match = clean(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? `${match[0]}T00:00:00Z` : null;
}

function normalizeRow(row, sourceFile) {
  const [
    product,
    detailedInfo,
    selectionInfo,
    oddsInfo,
    amountInfo,
    expectedValue,
    status,
  ] = row;

  const detailLines = clean(detailedInfo).split("\n").map(clean).filter(Boolean);
  const selectionLines = clean(selectionInfo).split("\n").map(clean).filter(Boolean);

  const betId = detailLines[0] || null;
  const sport = detailLines[1] || null;
  const timestamp = normalizeTimestamp(detailLines[2] || "");
  const selection = selectionLines[0] || null;
  const matchup = selectionLines[1] || null;
  const marketType = selectionLines.find((line) => /盘|比赛|让球|大小盘|独赢/.test(line) && line !== matchup) || null;
  const tournamentLine = selectionLines.find((line) => /@ \d{4}-\d{2}-\d{2}/.test(line)) || null;
  const odds = firstNumber(oddsInfo);
  const stake = firstNumber(expectedValue) ?? firstNumber(amountInfo);
  const eventStart = normalizeDateOnly(tournamentLine || "");
  const category = inferCategory(sport, selectionInfo);

  return {
    platform: "z",
    timestamp,
    title: [selection, matchup, tournamentLine ? tournamentLine.replace(/^@\s*/, "") : null]
      .filter(Boolean)
      .join(" | "),
    slug: null,
    outcome: selection,
    side: "BUY",
    price: odds,
    size: stake,
    category,
    event_start_time: eventStart,
    transaction_hash: null,
    result: null,
    realized_pnl: null,
    unrealized_pnl: null,
    closed_at: null,
    source_file: sourceFile,
    notes: [
      `product=${clean(product)}`,
      betId ? `bet_id=${betId}` : null,
      sport ? `sport=${sport}` : null,
      marketType ? `market_type=${marketType}` : null,
      `amount_field=${clean(amountInfo)}`,
      `status=${clean(status)}`,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error("Usage: node normalize_z_wps_csv.js <input-csv> <output-json>");
    process.exit(1);
  }

  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputPath);
  const csvText = fs.readFileSync(absoluteInput, "utf8");
  const rows = parseCsv(csvText);
  const header = rows.shift() || [];

  const normalizedRows = rows
    .filter((row) => row.length >= 6)
    .map((row) => normalizeRow(row, absoluteInput))
    .filter((row) => row.timestamp && row.title && row.size !== null);

  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(
    absoluteOutput,
    JSON.stringify(
      {
        normalized_at: new Date().toISOString(),
        source_file: absoluteInput,
        header,
        row_count: normalizedRows.length,
        rows: normalizedRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ outputPath: absoluteOutput, rowCount: normalizedRows.length }, null, 2));
}

main();
