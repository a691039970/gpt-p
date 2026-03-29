const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function average(values) {
  if (!values.length) return null;
  return sum(values) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function numericSummary(rows, field) {
  const values = rows
    .map((row) => row[field])
    .filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)))
    .map(Number);

  if (!values.length) {
    return {
      count: 0,
      min: null,
      median: null,
      mean: null,
      max: null,
    };
  }

  return {
    count: values.length,
    min: Math.min(...values),
    median: median(values),
    mean: average(values),
    max: Math.max(...values),
  };
}

function timeSummary(rows) {
  const values = rows
    .map((row) => row.timestamp)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  if (!values.length) {
    return {
      count: 0,
      first: null,
      last: null,
      span_hours: null,
    };
  }

  return {
    count: values.length,
    first: new Date(values[0]).toISOString(),
    last: new Date(values[values.length - 1]).toISOString(),
    span_hours: (values[values.length - 1] - values[0]) / 3600000,
  };
}

function pnlBuckets(rows, field) {
  const values = rows
    .map((row) => row[field])
    .filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)))
    .map(Number);

  return {
    positive: values.filter((value) => value > 0).length,
    flat: values.filter((value) => value === 0).length,
    negative: values.filter((value) => value < 0).length,
  };
}

function buildPlatformSummary(rows) {
  return {
    row_count: rows.length,
    time: timeSummary(rows),
    categories: countBy(rows, (row) => row.category || "unknown"),
    side_counts: countBy(rows, (row) => row.side || "UNKNOWN"),
    price: numericSummary(rows, "price"),
    size: numericSummary(rows, "size"),
    realized_pnl: numericSummary(rows, "realized_pnl"),
    unrealized_pnl: numericSummary(rows, "unrealized_pnl"),
    realized_pnl_buckets: pnlBuckets(rows, "realized_pnl"),
    unrealized_pnl_buckets: pnlBuckets(rows, "unrealized_pnl"),
  };
}

function main() {
  const zPath = process.argv[2];
  const pPath = process.argv[3];
  const outputPath = process.argv[4];

  if (!zPath || !pPath || !outputPath) {
    console.error("Usage: node compare_platforms.js <z-json> <p-json> <output-json>");
    process.exit(1);
  }

  const zPayload = readJson(path.resolve(zPath));
  const pPayload = readJson(path.resolve(pPath));
  const zRows = zPayload.rows || [];
  const pRows = pPayload.rows || [];

  const summary = {
    generated_at: new Date().toISOString(),
    inputs: {
      z: path.resolve(zPath),
      p: path.resolve(pPath),
    },
    z: buildPlatformSummary(zRows),
    p: buildPlatformSummary(pRows),
    comparison_notes: [
      "z currently comes from a partially recovered legacy XLS export, so slug/outcome completeness is limited.",
      "p currently comes from Polymarket wallet cache data and is materially more structured.",
      "This report is a first-pass descriptive comparison, not a profitability verdict.",
    ],
  };

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
