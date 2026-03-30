const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function buildDedupKey(row) {
  return [
    row.platform || "",
    row.timestamp || "",
    row.title || "",
    row.outcome || "",
    row.price ?? "",
    row.size ?? "",
  ].join("::");
}

function main() {
  const outputPath = process.argv[2];
  const inputPaths = process.argv.slice(3);

  if (!outputPath || inputPaths.length === 0) {
    console.error("Usage: node merge_platform_json.js <output-json> <input1> <input2> ...");
    process.exit(1);
  }

  const allRows = [];
  const seen = new Set();

  for (const inputPath of inputPaths) {
    const payload = readJson(inputPath);
    for (const row of payload.rows || []) {
      const key = buildDedupKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      allRows.push(row);
    }
  }

  allRows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outputPath),
    JSON.stringify(
      {
        merged_at: new Date().toISOString(),
        source_files: inputPaths.map((item) => path.resolve(item)),
        row_count: allRows.length,
        rows: allRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ outputPath: path.resolve(outputPath), rowCount: allRows.length }, null, 2));
}

main();
