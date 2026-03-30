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
    console.error('Usage: node analyze_z_category_models.js <input.json> <output.json>');
    process.exit(1);
  }

  return {
    inputPath: path.resolve(argv[2]),
    outputPath: path.resolve(argv[3]),
  };
}

function shanghaiParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  });
  const partMap = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }
  return {
    month: `${partMap.year}-${partMap.month}`,
    weekday: partMap.weekday,
    hour: Number(partMap.hour),
  };
}

function summarizeRows(rows) {
  const pnlValues = rows.map((row) => row.realized_pnl).filter(Number.isFinite).sort((a, b) => a - b);
  const pnlSum = pnlValues.reduce((sum, value) => sum + value, 0);
  const positive = pnlValues.filter((value) => value > 0).length;
  const negative = pnlValues.filter((value) => value < 0).length;
  const flat = pnlValues.filter((value) => value === 0).length;
  const sizes = rows.map((row) => row.size).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    count: rows.length,
    pnl_sum: pnlSum,
    pnl_avg: rows.length ? pnlSum / rows.length : 0,
    pnl_median: pnlValues.length ? pnlValues[Math.floor(pnlValues.length / 2)] : null,
    positive,
    negative,
    flat,
    win_rate: rows.length ? positive / rows.length : 0,
    size_median: sizes.length ? sizes[Math.floor(sizes.length / 2)] : null,
  };
}

function summarizeBuckets(bucketMap, minCount, limit = 3) {
  const normalized = [...bucketMap.entries()]
    .map(([label, rows]) => ({ label, ...summarizeRows(rows) }))
    .filter((entry) => entry.count >= minCount);

  return {
    best: [...normalized].sort((a, b) => b.pnl_avg - a.pnl_avg).slice(0, limit),
    worst: [...normalized].sort((a, b) => a.pnl_avg - b.pnl_avg).slice(0, limit),
  };
}

function classifyCategory(summary) {
  if (summary.count < 300) return 'observation';
  if (summary.pnl_avg > 20 && summary.win_rate >= 0.45) return 'core';
  if (summary.pnl_avg > 0 && summary.win_rate >= 0.42) return 'active';
  if (summary.pnl_avg <= -50) return 'deweight';
  if (summary.pnl_avg <= -15) return 'cautious';
  return 'observation';
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const rows = (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && row.timestamp && row.category)
    .map((row) => {
      const parts = shanghaiParts(new Date(row.timestamp));
      return {
        ...row,
        _month: parts.month,
        _weekday: parts.weekday,
        _hour: parts.hour,
      };
    });

  const categoryNames = [...new Set(rows.map((row) => row.category))].sort();
  const result = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    timezone: 'Asia/Shanghai',
    categories: {},
  };

  for (const category of categoryNames) {
    const subset = rows.filter((row) => row.category === category);
    const hourBuckets = new Map();
    const weekdayBuckets = new Map();
    const monthBuckets = new Map();

    for (const row of subset) {
      if (!hourBuckets.has(row._hour)) hourBuckets.set(row._hour, []);
      if (!weekdayBuckets.has(row._weekday)) weekdayBuckets.set(row._weekday, []);
      if (!monthBuckets.has(row._month)) monthBuckets.set(row._month, []);
      hourBuckets.get(row._hour).push(row);
      weekdayBuckets.get(row._weekday).push(row);
      monthBuckets.get(row._month).push(row);
    }

    const summary = summarizeRows(subset);
    result.categories[category] = {
      summary,
      profile: classifyCategory(summary),
      best_hours: summarizeBuckets(hourBuckets, Math.max(20, Math.floor(subset.length * 0.01))).best,
      worst_hours: summarizeBuckets(hourBuckets, Math.max(20, Math.floor(subset.length * 0.01))).worst,
      best_weekdays: summarizeBuckets(weekdayBuckets, 12, 3).best,
      worst_weekdays: summarizeBuckets(weekdayBuckets, 12, 3).worst,
      best_months: summarizeBuckets(monthBuckets, 1, 4).best,
      worst_months: summarizeBuckets(monthBuckets, 1, 4).worst,
    };
  }

  writeJson(outputPath, result);
  console.log(JSON.stringify({
    outputPath,
    categoryCount: categoryNames.length,
  }, null, 2));
}

main();
