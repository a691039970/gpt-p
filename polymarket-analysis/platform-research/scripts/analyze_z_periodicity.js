#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function parseArgs(argv) {
  if (argv.length < 4) {
    console.error('Usage: node analyze_z_periodicity.js <input.json> <output.json>');
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
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const partMap = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }

  return {
    date: `${partMap.year}-${partMap.month}-${partMap.day}`,
    hour: Number(partMap.hour),
    weekday: partMap.weekday,
  };
}

function createBucket(label) {
  return {
    label,
    count: 0,
    pnl_sum: 0,
    pnl_avg: 0,
    positive: 0,
    flat: 0,
    negative: 0,
    win_rate: 0,
  };
}

function finalizeBucket(bucket) {
  bucket.pnl_avg = bucket.count ? bucket.pnl_sum / bucket.count : 0;
  bucket.win_rate = bucket.count ? bucket.positive / bucket.count : 0;
  return bucket;
}

function incBucket(bucket, pnl) {
  bucket.count += 1;
  bucket.pnl_sum += pnl;
  if (pnl > 0) {
    bucket.positive += 1;
  } else if (pnl < 0) {
    bucket.negative += 1;
  } else {
    bucket.flat += 1;
  }
}

function summarizeDailyRows(dailyMap) {
  const rows = [...dailyMap.entries()]
    .map(([date, values]) => ({
      date,
      count: values.count,
      pnl_sum: values.pnl_sum,
      positive: values.positive,
      flat: values.flat,
      negative: values.negative,
      win_rate: values.count ? values.positive / values.count : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const windows = [3, 5, 7].map((windowSize) => {
    if (rows.length < windowSize) {
      return { window_days: windowSize, best: null, worst: null };
    }

    let best = null;
    let worst = null;
    for (let start = 0; start <= rows.length - windowSize; start += 1) {
      const slice = rows.slice(start, start + windowSize);
      const pnlSum = slice.reduce((sum, row) => sum + row.pnl_sum, 0);
      const count = slice.reduce((sum, row) => sum + row.count, 0);
      const positive = slice.reduce((sum, row) => sum + row.positive, 0);
      const candidate = {
        start_date: slice[0].date,
        end_date: slice[slice.length - 1].date,
        pnl_sum: pnlSum,
        count,
        win_rate: count ? positive / count : 0,
      };

      if (!best || candidate.pnl_sum > best.pnl_sum) {
        best = candidate;
      }
      if (!worst || candidate.pnl_sum < worst.pnl_sum) {
        worst = candidate;
      }
    }

    return { window_days: windowSize, best, worst };
  });

  return { rows, windows };
}

function summarizeStreaks(sortedRows) {
  let current = null;
  let bestPositive = null;
  let bestNegative = null;

  for (const row of sortedRows) {
    const pnl = row.realized_pnl;
    let sign = 'flat';
    if (pnl > 0) sign = 'positive';
    if (pnl < 0) sign = 'negative';

    if (!current || current.sign !== sign) {
      current = {
        sign,
        count: 1,
        pnl_sum: pnl,
        start_timestamp: row.timestamp,
        end_timestamp: row.timestamp,
      };
    } else {
      current.count += 1;
      current.pnl_sum += pnl;
      current.end_timestamp = row.timestamp;
    }

    if (sign === 'positive' && (!bestPositive || current.count > bestPositive.count)) {
      bestPositive = { ...current };
    }
    if (sign === 'negative' && (!bestNegative || current.count > bestNegative.count)) {
      bestNegative = { ...current };
    }
  }

  return {
    longest_positive_streak: bestPositive,
    longest_negative_streak: bestNegative,
  };
}

function topAndBottomBuckets(bucketMap, metricKey, limit = 5, minCount = 10) {
  const rows = [...bucketMap.values()]
    .filter((row) => row.count >= minCount)
    .map((row) => finalizeBucket({ ...row }));

  return {
    top: [...rows].sort((a, b) => b[metricKey] - a[metricKey]).slice(0, limit),
    bottom: [...rows].sort((a, b) => a[metricKey] - b[metricKey]).slice(0, limit),
  };
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  const realizedRows = rows
    .filter((row) => Number.isFinite(row.realized_pnl) && row.timestamp)
    .map((row) => {
      const ts = new Date(row.timestamp);
      const local = shanghaiParts(ts);
      return {
        ...row,
        _date: local.date,
        _hour: local.hour,
        _weekday: local.weekday,
      };
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const hourMap = new Map();
  const weekdayMap = new Map();
  const categoryMap = new Map();
  const dateMap = new Map();
  const weekdayHourMap = new Map();

  for (let hour = 0; hour < 24; hour += 1) {
    hourMap.set(hour, createBucket(String(hour).padStart(2, '0')));
  }
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day) => {
    weekdayMap.set(day, createBucket(day));
  });

  for (const row of realizedRows) {
    const pnl = row.realized_pnl;

    incBucket(hourMap.get(row._hour), pnl);
    incBucket(weekdayMap.get(row._weekday), pnl);

    if (!categoryMap.has(row.category || 'Unknown')) {
      categoryMap.set(row.category || 'Unknown', createBucket(row.category || 'Unknown'));
    }
    incBucket(categoryMap.get(row.category || 'Unknown'), pnl);

    if (!dateMap.has(row._date)) {
      dateMap.set(row._date, { count: 0, pnl_sum: 0, positive: 0, flat: 0, negative: 0 });
    }
    const dateEntry = dateMap.get(row._date);
    dateEntry.count += 1;
    dateEntry.pnl_sum += pnl;
    if (pnl > 0) dateEntry.positive += 1;
    else if (pnl < 0) dateEntry.negative += 1;
    else dateEntry.flat += 1;

    const weekdayHourKey = `${row._weekday}-${String(row._hour).padStart(2, '0')}`;
    if (!weekdayHourMap.has(weekdayHourKey)) {
      weekdayHourMap.set(weekdayHourKey, createBucket(weekdayHourKey));
    }
    incBucket(weekdayHourMap.get(weekdayHourKey), pnl);
  }

  const dailySummary = summarizeDailyRows(dateMap);
  const streaks = summarizeStreaks(realizedRows);
  const summary = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    timezone: 'Asia/Shanghai',
    sample: {
      row_count: rows.length,
      realized_row_count: realizedRows.length,
      first_timestamp: realizedRows[0]?.timestamp ?? null,
      last_timestamp: realizedRows[realizedRows.length - 1]?.timestamp ?? null,
    },
    by_hour: [...hourMap.values()].map((bucket) => finalizeBucket(bucket)),
    by_weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => finalizeBucket(weekdayMap.get(day))),
    by_category: [...categoryMap.values()]
      .map((bucket) => finalizeBucket(bucket))
      .sort((a, b) => b.count - a.count),
    by_day: dailySummary.rows,
    rolling_windows: dailySummary.windows,
    streaks,
    highlights: {
      best_hours_by_avg_pnl: topAndBottomBuckets(hourMap, 'pnl_avg', 5, 20).top,
      worst_hours_by_avg_pnl: topAndBottomBuckets(hourMap, 'pnl_avg', 5, 20).bottom,
      best_weekdays_by_avg_pnl: topAndBottomBuckets(weekdayMap, 'pnl_avg', 7, 20).top,
      worst_weekdays_by_avg_pnl: topAndBottomBuckets(weekdayMap, 'pnl_avg', 7, 20).bottom,
      best_weekday_hours_by_avg_pnl: topAndBottomBuckets(weekdayHourMap, 'pnl_avg', 8, 8).top,
      worst_weekday_hours_by_avg_pnl: topAndBottomBuckets(weekdayHourMap, 'pnl_avg', 8, 8).bottom,
      best_categories_by_avg_pnl: topAndBottomBuckets(categoryMap, 'pnl_avg', 6, 10).top,
      worst_categories_by_avg_pnl: topAndBottomBuckets(categoryMap, 'pnl_avg', 6, 10).bottom,
    },
  };

  writeJson(outputPath, summary);
  console.log(JSON.stringify({
    outputPath,
    realizedRowCount: realizedRows.length,
    dayCount: dailySummary.rows.length,
  }, null, 2));
}

main();
