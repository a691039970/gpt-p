const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function includesAny(text, patterns) {
  const value = String(text || "").toLowerCase();
  return patterns.some((pattern) => value.includes(pattern.toLowerCase()));
}

function filterRows(rows, mode) {
  if (mode === "football_like") {
    return rows.filter((row) =>
      includesAny(`${row.category || ""} ${row.title || ""} ${row.notes || ""}`, [
        "football",
        "fifa",
        "西甲",
        "世界杯",
        "欧足联",
        "瑞典-vs-波兰",
      ])
    );
  }

  if (mode === "esports_like") {
    return rows.filter((row) =>
      includesAny(`${row.category || ""} ${row.title || ""}`, ["cs2", "dota", "lol", "valorant", "esports"])
    );
  }

  return rows;
}

function main() {
  const inputPath = process.argv[2];
  const mode = process.argv[3];
  const outputPath = process.argv[4];

  if (!inputPath || !mode || !outputPath) {
    console.error("Usage: node slice_platform_rows.js <input-json> <mode> <output-json>");
    process.exit(1);
  }

  const payload = readJson(inputPath);
  const rows = payload.rows || [];
  const slicedRows = filterRows(rows, mode);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outputPath),
    JSON.stringify(
      {
        sliced_at: new Date().toISOString(),
        mode,
        source_file: path.resolve(inputPath),
        row_count: slicedRows.length,
        rows: slicedRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ mode, rowCount: slicedRows.length, outputPath: path.resolve(outputPath) }, null, 2));
}

main();
