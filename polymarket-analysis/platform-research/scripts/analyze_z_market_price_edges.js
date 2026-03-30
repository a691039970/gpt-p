#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function writeJson(filePath, data) {
  fs.writeFileSync(path.resolve(filePath), JSON.stringify(data, null, 2));
}

function parseArgs(argv) {
  if (argv.length < 4) {
    console.error('Usage: node analyze_z_market_price_edges.js <input.json> <output.json>');
    process.exit(1);
  }
  return {
    inputPath: path.resolve(argv[2]),
    outputPath: path.resolve(argv[3]),
  };
}

function marketTypeFromNotes(notes) {
  if (!notes) return 'unknown';
  const match = String(notes).match(/market_type=([^;]+)/);
  return match ? match[1].trim() : 'unknown';
}

function priceBucket(price) {
  if (!Number.isFinite(price)) return 'unknown';
  if (price < 1.5) return '<1.5';
  if (price < 1.8) return '1.5-1.79';
  if (price < 2.1) return '1.8-2.09';
  if (price < 2.5) return '2.1-2.49';
  if (price < 3.0) return '2.5-2.99';
  if (price < 4.0) return '3.0-3.99';
  return '4.0+';
}

function summarizeRows(rows) {
  const count = rows.length;
  const pnlSum = rows.reduce((sum, row) => sum + row.realized_pnl, 0);
  const positive = rows.filter((row) => row.realized_pnl > 0).length;
  const negative = rows.filter((row) => row.realized_pnl < 0).length;
  const flat = rows.filter((row) => row.realized_pnl === 0).length;
  return {
    count,
    pnl_sum: pnlSum,
    pnl_avg: count ? pnlSum / count : 0,
    positive,
    negative,
    flat,
    win_rate: count ? positive / count : 0,
  };
}

function topBottom(rows, sortKey, limit, minCount) {
  const filtered = rows.filter((row) => row.count >= minCount);
  return {
    top: [...filtered].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, limit),
    bottom: [...filtered].sort((a, b) => a[sortKey] - b[sortKey]).slice(0, limit),
  };
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const rows = (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && Number.isFinite(row.price))
    .map((row) => ({
      ...row,
      market_type: marketTypeFromNotes(row.notes),
      price_bucket: priceBucket(row.price),
    }));

  const marketMap = new Map();
  const priceMap = new Map();
  const comboMap = new Map();
  const focusCategories = new Set(['Dota2', 'LoL', 'CS2', 'Basketball', 'Football']);
  const categoryCombo = new Map();

  for (const row of rows) {
    const marketKey = row.market_type;
    const priceKey = row.price_bucket;
    const comboKey = `${row.market_type} | ${row.price_bucket}`;
    const catComboKey = `${row.category} | ${row.market_type} | ${row.price_bucket}`;

    if (!marketMap.has(marketKey)) marketMap.set(marketKey, []);
    if (!priceMap.has(priceKey)) priceMap.set(priceKey, []);
    if (!comboMap.has(comboKey)) comboMap.set(comboKey, []);

    marketMap.get(marketKey).push(row);
    priceMap.get(priceKey).push(row);
    comboMap.get(comboKey).push(row);

    if (focusCategories.has(row.category)) {
      if (!categoryCombo.has(catComboKey)) categoryCombo.set(catComboKey, []);
      categoryCombo.get(catComboKey).push(row);
    }
  }

  const marketRows = [...marketMap.entries()].map(([label, bucketRows]) => ({ label, ...summarizeRows(bucketRows) }));
  const priceRows = [...priceMap.entries()].map(([label, bucketRows]) => ({ label, ...summarizeRows(bucketRows) }));
  const comboRows = [...comboMap.entries()].map(([label, bucketRows]) => ({ label, ...summarizeRows(bucketRows) }));
  const categoryComboRows = [...categoryCombo.entries()].map(([label, bucketRows]) => ({ label, ...summarizeRows(bucketRows) }));

  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    sample: summarizeRows(rows),
    by_market_type: marketRows.sort((a, b) => b.count - a.count),
    by_price_bucket: priceRows.sort((a, b) => b.count - a.count),
    highlights: {
      best_market_types: topBottom(marketRows, 'pnl_avg', 10, 80).top,
      worst_market_types: topBottom(marketRows, 'pnl_avg', 10, 80).bottom,
      best_price_buckets: topBottom(priceRows, 'pnl_avg', 10, 150).top,
      worst_price_buckets: topBottom(priceRows, 'pnl_avg', 10, 150).bottom,
      best_market_price_combos: topBottom(comboRows, 'pnl_avg', 15, 60).top,
      worst_market_price_combos: topBottom(comboRows, 'pnl_avg', 15, 60).bottom,
      best_focus_category_combos: topBottom(categoryComboRows, 'pnl_avg', 20, 30).top,
      worst_focus_category_combos: topBottom(categoryComboRows, 'pnl_avg', 20, 30).bottom,
    },
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    marketTypeCount: marketRows.length,
    comboCount: comboRows.length,
  }, null, 2));
}

main();
