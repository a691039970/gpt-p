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
    console.error('Usage: node build_z_state_model.js <input.json> <output.json>');
    process.exit(1);
  }
  return {
    inputPath: path.resolve(argv[2]),
    outputPath: path.resolve(argv[3]),
  };
}

function shanghaiDate(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const partMap = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') partMap[part.type] = part.value;
  }
  return `${partMap.year}-${partMap.month}-${partMap.day}`;
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

function percentile(sortedValues, target) {
  if (!sortedValues.length) return 0.5;
  let lessOrEqual = 0;
  for (const value of sortedValues) {
    if (value <= target) lessOrEqual += 1;
  }
  return lessOrEqual / sortedValues.length;
}

function labelScore(score) {
  if (score >= 75) return 'strong';
  if (score >= 60) return 'positive';
  if (score >= 40) return 'neutral';
  if (score >= 25) return 'weak';
  return 'danger';
}

function buildDailyMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const dateKey = shanghaiDate(new Date(row.timestamp));
    if (!map.has(dateKey)) map.set(dateKey, []);
    map.get(dateKey).push(row);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dateRows]) => ({ date, rows: dateRows, ...summarizeRows(dateRows) }));
}

function rollingWindows(days, windowSize) {
  const windows = [];
  if (days.length < windowSize) return windows;
  for (let start = 0; start <= days.length - windowSize; start += 1) {
    const slice = days.slice(start, start + windowSize);
    const rows = slice.flatMap((day) => day.rows);
    windows.push({
      start_date: slice[0].date,
      end_date: slice[slice.length - 1].date,
      ...summarizeRows(rows),
    });
  }
  return windows;
}

function stateFromWindows(days, windowSizes) {
  const state = {};
  for (const windowSize of windowSizes) {
    const windows = rollingWindows(days, windowSize);
    if (!windows.length) {
      state[windowSize] = null;
      continue;
    }
    const current = windows[windows.length - 1];
    const pnlValues = windows.map((item) => item.pnl_avg).sort((a, b) => a - b);
    const winValues = windows.map((item) => item.win_rate).sort((a, b) => a - b);
    const countValues = windows.map((item) => item.count).sort((a, b) => a - b);
    const pnlPct = percentile(pnlValues, current.pnl_avg);
    const winPct = percentile(winValues, current.win_rate);
    const countPct = percentile(countValues, current.count);
    const score = Math.round((pnlPct * 0.55 + winPct * 0.3 + countPct * 0.15) * 100);

    state[windowSize] = {
      current,
      history_window_count: windows.length,
      pnl_percentile: Number(pnlPct.toFixed(4)),
      win_rate_percentile: Number(winPct.toFixed(4)),
      activity_percentile: Number(countPct.toFixed(4)),
      score,
      label: labelScore(score),
    };
  }
  return state;
}

function combineWindowScores(stateByWindow) {
  const weights = { 3: 0.3, 5: 0.3, 7: 0.25, 14: 0.15 };
  let total = 0;
  let used = 0;
  for (const [key, value] of Object.entries(stateByWindow)) {
    if (!value) continue;
    const weight = weights[key] || 0;
    total += value.score * weight;
    used += weight;
  }
  const score = used ? Math.round(total / used) : 50;
  return { score, label: labelScore(score) };
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const rows = (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && row.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const daily = buildDailyMap(rows);
  const windowSizes = [3, 5, 7, 14];
  const overallWindows = stateFromWindows(daily, windowSizes);
  const overall = {
    ...combineWindowScores(overallWindows),
    windows: overallWindows,
  };

  const categoryNames = [...new Set(rows.map((row) => row.category).filter(Boolean))].sort();
  const categories = {};
  for (const category of categoryNames) {
    const categoryRows = rows.filter((row) => row.category === category);
    const categoryDaily = buildDailyMap(categoryRows);
    const categoryWindows = stateFromWindows(categoryDaily, windowSizes);
    categories[category] = {
      sample: summarizeRows(categoryRows),
      ...combineWindowScores(categoryWindows),
      windows: categoryWindows,
    };
  }

  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    timezone: 'Asia/Shanghai',
    sample: summarizeRows(rows),
    first_date: daily[0]?.date ?? null,
    last_date: daily[daily.length - 1]?.date ?? null,
    total_days: daily.length,
    overall_state: overall,
    category_states: categories,
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    overallScore: overall.score,
    overallLabel: overall.label,
    categoryCount: categoryNames.length,
  }, null, 2));
}

main();
