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
    console.error('Usage: node analyze_z_profit_engine.js <input.json> <output.json>');
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

function sizeBucket(size) {
  if (!Number.isFinite(size)) return 'unknown';
  if (size < 100) return '<100';
  if (size < 300) return '100-299';
  if (size < 700) return '300-699';
  if (size < 1500) return '700-1499';
  if (size < 3000) return '1500-2999';
  return '3000+';
}

function summarizeRows(rows) {
  const count = rows.length;
  const pnlSum = rows.reduce((sum, row) => sum + row.realized_pnl, 0);
  const stakeSum = rows.reduce((sum, row) => sum + row.size, 0);
  const positive = rows.filter((row) => row.realized_pnl > 0).length;
  const negative = rows.filter((row) => row.realized_pnl < 0).length;
  const flat = rows.filter((row) => row.realized_pnl === 0).length;
  const roi = stakeSum ? pnlSum / stakeSum : 0;
  const avgOdds = count ? rows.reduce((sum, row) => sum + row.price, 0) / count : 0;
  const avgSize = count ? stakeSum / count : 0;

  return {
    count,
    pnl_sum: pnlSum,
    stake_sum: stakeSum,
    pnl_avg: count ? pnlSum / count : 0,
    roi,
    avg_odds: avgOdds,
    avg_size: avgSize,
    positive,
    negative,
    flat,
    win_rate: count ? positive / count : 0,
  };
}

function groupedSummary(rows, keyFn, minCount = 1) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()]
    .map(([label, bucketRows]) => ({ label, ...summarizeRows(bucketRows) }))
    .filter((row) => row.count >= minCount);
}

function concentration(rows) {
  const positives = rows.filter((row) => row.realized_pnl > 0).sort((a, b) => b.realized_pnl - a.realized_pnl);
  const totalPositive = positives.reduce((sum, row) => sum + row.realized_pnl, 0);
  const totalNet = rows.reduce((sum, row) => sum + row.realized_pnl, 0);
  const cuts = [0.01, 0.05, 0.1, 0.2];

  return cuts.map((ratio) => {
    const take = Math.max(1, Math.ceil(positives.length * ratio));
    const slice = positives.slice(0, take);
    const pnl = slice.reduce((sum, row) => sum + row.realized_pnl, 0);
    return {
      top_ratio: ratio,
      trade_count: take,
      positive_pnl_share: totalPositive ? pnl / totalPositive : 0,
      net_pnl_multiple: totalNet ? pnl / totalNet : null,
      pnl_sum: pnl,
      avg_pnl: take ? pnl / take : 0,
    };
  });
}

function positiveNegativeProfiles(rows) {
  const wins = rows.filter((row) => row.realized_pnl > 0);
  const losses = rows.filter((row) => row.realized_pnl < 0);
  return {
    wins: summarizeRows(wins),
    losses: summarizeRows(losses),
  };
}

function topContributors(rows, keyFn, minCount = 20, limit = 15) {
  const grouped = groupedSummary(rows, keyFn, minCount);
  return [...grouped].sort((a, b) => b.pnl_sum - a.pnl_sum).slice(0, limit);
}

function worstContributors(rows, keyFn, minCount = 20, limit = 15) {
  const grouped = groupedSummary(rows, keyFn, minCount);
  return [...grouped].sort((a, b) => a.pnl_sum - b.pnl_sum).slice(0, limit);
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const rows = (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && Number.isFinite(row.price) && Number.isFinite(row.size))
    .map((row) => ({
      ...row,
      market_type: marketTypeFromNotes(row.notes),
      price_bucket: priceBucket(row.price),
      size_bucket: sizeBucket(row.size),
      roi: row.size ? row.realized_pnl / row.size : 0,
    }));

  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    sample: summarizeRows(rows),
    concentration: concentration(rows),
    positive_negative_profiles: positiveNegativeProfiles(rows),
    by_price_bucket: groupedSummary(rows, (row) => row.price_bucket, 20).sort((a, b) => b.count - a.count),
    by_size_bucket: groupedSummary(rows, (row) => row.size_bucket, 20).sort((a, b) => b.count - a.count),
    top_profit_contributors: {
      categories: topContributors(rows, (row) => row.category, 20, 10),
      market_types: topContributors(rows, (row) => row.market_type, 20, 15),
      price_buckets: topContributors(rows, (row) => row.price_bucket, 20, 10),
      size_buckets: topContributors(rows, (row) => row.size_bucket, 20, 10),
      market_price_combos: topContributors(rows, (row) => `${row.market_type} | ${row.price_bucket}`, 30, 20),
    },
    worst_profit_contributors: {
      categories: worstContributors(rows, (row) => row.category, 20, 10),
      market_types: worstContributors(rows, (row) => row.market_type, 20, 15),
      price_buckets: worstContributors(rows, (row) => row.price_bucket, 20, 10),
      size_buckets: worstContributors(rows, (row) => row.size_bucket, 20, 10),
      market_price_combos: worstContributors(rows, (row) => `${row.market_type} | ${row.price_bucket}`, 30, 20),
    },
    focus_combos: {
      top: topContributors(
        rows.filter((row) => ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'].includes(row.category)),
        (row) => `${row.category} | ${row.market_type} | ${row.price_bucket}`,
        25,
        25
      ),
      bottom: worstContributors(
        rows.filter((row) => ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'].includes(row.category)),
        (row) => `${row.category} | ${row.market_type} | ${row.price_bucket}`,
        25,
        25
      ),
    },
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    rowCount: rows.length,
    netPnl: output.sample.pnl_sum,
  }, null, 2));
}

main();
