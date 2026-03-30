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
    console.error('Usage: node build_z_weighted_backtest.js <input.json> <output.json> [baseStake] [perspective]');
    process.exit(1);
  }

  const baseStake = argv[4] ? Number(argv[4]) : 100;
  if (!Number.isFinite(baseStake) || baseStake <= 0) {
    console.error('baseStake must be a positive number');
    process.exit(1);
  }

  const perspective = argv[5] ? String(argv[5]).toLowerCase() : 'z';
  if (!['z', 'user'].includes(perspective)) {
    console.error('perspective must be either "z" or "user"');
    process.exit(1);
  }

  return {
    inputPath: path.resolve(argv[2]),
    outputPath: path.resolve(argv[3]),
    baseStake,
    perspective,
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

function shanghaiParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const partMap = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }
  return {
    date: `${partMap.year}-${partMap.month}-${partMap.day}`,
    month: `${partMap.year}-${partMap.month}`,
  };
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]))].sort();
}

function withDerivedFields(payload, perspective) {
  return (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && Number.isFinite(row.size) && row.size > 0 && row.timestamp)
    .map((row) => {
      const date = new Date(row.timestamp);
      const parts = shanghaiParts(date);
      const marketType = marketTypeFromNotes(row.notes);
      const pnl = perspective === 'z' ? -row.realized_pnl : row.realized_pnl;
      return {
        ...row,
        perspective_pnl: pnl,
        market_type: marketType,
        price_bucket: priceBucket(row.price),
        structure_key: `${row.category} | ${marketType} | ${priceBucket(row.price)}`,
        unit_return: pnl / row.size,
        local_date: parts.date,
        local_month: parts.month,
        _ts: date.getTime(),
      };
    })
    .sort((a, b) => a._ts - b._ts);
}

function splitByDay(rows, trainRatio = 0.7) {
  const days = uniqueValues(rows, 'local_date');
  const splitIndex = Math.max(1, Math.min(days.length - 1, Math.floor(days.length * trainRatio)));
  const trainDays = new Set(days.slice(0, splitIndex));
  return {
    trainRows: rows.filter((row) => trainDays.has(row.local_date)),
    testRows: rows.filter((row) => !trainDays.has(row.local_date)),
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

function summarizeWeighted(rows) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const row of rows) {
    equity += row.weighted_pnl;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const count = rows.length;
  const stakeSum = rows.reduce((sum, row) => sum + row.assigned_stake, 0);
  const pnlSum = rows.reduce((sum, row) => sum + row.weighted_pnl, 0);
  const positive = rows.filter((row) => row.weighted_pnl > 0).length;
  const negative = rows.filter((row) => row.weighted_pnl < 0).length;
  const flat = rows.filter((row) => row.weighted_pnl === 0).length;

  return {
    count,
    stake_sum: Number(stakeSum.toFixed(6)),
    pnl_sum: Number(pnlSum.toFixed(6)),
    pnl_avg: count ? Number((pnlSum / count).toFixed(6)) : 0,
    roi: stakeSum ? Number((pnlSum / stakeSum).toFixed(6)) : 0,
    positive,
    negative,
    flat,
    win_rate: count ? Number((positive / count).toFixed(6)) : 0,
    max_drawdown: Number(maxDrawdown.toFixed(6)),
  };
}

function summarizeScoreRows(rows) {
  const count = rows.length;
  const pnlSum = rows.reduce((sum, row) => sum + row.perspective_pnl, 0);
  const stakeSum = rows.reduce((sum, row) => sum + row.size, 0);
  const unitReturns = rows.map((row) => row.unit_return).sort((a, b) => a - b);
  const medianUnitReturn = unitReturns.length ? unitReturns[Math.floor(unitReturns.length / 2)] : 0;
  return {
    count,
    pnl_sum: pnlSum,
    roi: stakeSum ? pnlSum / stakeSum : 0,
    unit_return_avg: count ? pnlSum / stakeSum : 0,
    unit_return_median: medianUnitReturn,
    win_rate: count ? rows.filter((row) => row.perspective_pnl > 0).length / count : 0,
  };
}

function scoreStructures(rows, minCount) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.structure_key)) grouped.set(row.structure_key, []);
    grouped.get(row.structure_key).push(row);
  }

  const scored = [...grouped.entries()]
    .map(([key, bucket]) => {
      const summary = summarizeScoreRows(bucket);
      const score = (
        summary.roi * 0.45 +
        summary.unit_return_median * 0.25 +
        summary.win_rate * 0.15 +
        Math.log10(summary.count + 1) * 0.15
      );
      const [category, marketType, priceBucketLabel] = key.split(' | ');
      return {
        key,
        category,
        market_type: marketType,
        price_bucket: priceBucketLabel,
        score,
        ...summary,
      };
    })
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.score - a.score);

  const scoreValues = scored.map((entry) => entry.score).sort((a, b) => a - b);
  return scored.map((entry) => ({
    ...entry,
    score_percentile: percentile(scoreValues, entry.score),
  }));
}

function assignedMultiple(scorePercentile) {
  if (scorePercentile >= 0.8) return 3.0;
  if (scorePercentile >= 0.5) return 1.5;
  return 0.5;
}

function assignWeights(rows, structureScores, baseStake) {
  const scoreMap = new Map(structureScores.map((entry) => [entry.key, entry]));
  return rows
    .filter((row) => scoreMap.has(row.structure_key))
    .map((row) => {
      const score = scoreMap.get(row.structure_key);
      const multiple = assignedMultiple(score.score_percentile);
      const assignedStake = baseStake * multiple;
      return {
        ...row,
        assigned_multiple: multiple,
        assigned_stake: assignedStake,
        weighted_pnl: row.unit_return * assignedStake,
        structure_score: score.score,
        structure_score_percentile: score.score_percentile,
      };
    })
    .sort((a, b) => {
      if (b.structure_score_percentile !== a.structure_score_percentile) {
        return b.structure_score_percentile - a.structure_score_percentile;
      }
      return a._ts - b._ts;
    });
}

function concentration(rows) {
  if (!rows.length) {
    return {
      top_20pct_trade_count: 0,
      top_20pct_pnl_share: 0,
      top_20pct_stake_share: 0,
      top_20pct_roi: 0,
    };
  }

  const sorted = [...rows].sort((a, b) => b.assigned_multiple - a.assigned_multiple || b.structure_score - a.structure_score);
  const take = Math.max(1, Math.ceil(sorted.length * 0.2));
  const top = sorted.slice(0, take);
  const totalPnl = rows.reduce((sum, row) => sum + row.weighted_pnl, 0);
  const totalStake = rows.reduce((sum, row) => sum + row.assigned_stake, 0);
  const topPnl = top.reduce((sum, row) => sum + row.weighted_pnl, 0);
  const topStake = top.reduce((sum, row) => sum + row.assigned_stake, 0);
  return {
    top_20pct_trade_count: take,
    top_20pct_pnl_share: totalPnl ? Number((topPnl / totalPnl).toFixed(6)) : 0,
    top_20pct_stake_share: totalStake ? Number((topStake / totalStake).toFixed(6)) : 0,
    top_20pct_roi: topStake ? Number((topPnl / topStake).toFixed(6)) : 0,
  };
}

function summarizeTiers(rows) {
  const tiers = [3.0, 1.5, 0.5];
  return tiers.map((multiple) => {
    const subset = rows.filter((row) => row.assigned_multiple === multiple);
    return {
      multiple,
      ...summarizeWeighted(subset),
    };
  });
}

function monthRange(months, startIndex, endExclusive) {
  return {
    start_month: months[startIndex] ?? null,
    end_month: months[endExclusive - 1] ?? null,
  };
}

function walkForward(rows, baseStake, minCount, warmupMonths) {
  const months = uniqueValues(rows, 'local_month');
  const steps = [];

  for (let i = warmupMonths; i < months.length; i += 1) {
    const trainMonths = new Set(months.slice(0, i));
    const testMonth = months[i];
    const trainRows = rows.filter((row) => trainMonths.has(row.local_month));
    const testRows = rows.filter((row) => row.local_month === testMonth);
    const structureScores = scoreStructures(trainRows, minCount);
    if (!structureScores.length) continue;

    const weightedTestRows = assignWeights(testRows, structureScores, baseStake);
    steps.push({
      test_month: testMonth,
      train_months: monthRange(months, 0, i),
      top_structures: structureScores.slice(0, 10),
      summary: summarizeWeighted(weightedTestRows),
      concentration: concentration(weightedTestRows),
      tiers: summarizeTiers(weightedTestRows),
    });
  }

  const aggregateRows = [];
  for (const step of steps) {
    const testMonth = step.test_month;
    const trainMonths = new Set(months.slice(0, months.indexOf(testMonth)));
    const trainRows = rows.filter((row) => trainMonths.has(row.local_month));
    const structureScores = scoreStructures(trainRows, minCount);
    const monthRows = rows.filter((row) => row.local_month === testMonth);
    aggregateRows.push(...assignWeights(monthRows, structureScores, baseStake));
  }

  return {
    warmup_months: warmupMonths,
    tested_months: steps.length,
    steps,
    aggregate: {
      summary: summarizeWeighted(aggregateRows),
      concentration: concentration(aggregateRows),
      tiers: summarizeTiers(aggregateRows),
    },
  };
}

function runUniverse(rows, baseStake, options = {}) {
  const {
    label,
    allowedCategories = null,
    minCount = 30,
    warmupMonths = 6,
  } = options;

  const scopedRows = allowedCategories ? rows.filter((row) => allowedCategories.includes(row.category)) : rows;
  const split = splitByDay(scopedRows, 0.7);
  const structureScores = scoreStructures(split.trainRows, minCount);
  const weightedTrain = assignWeights(split.trainRows, structureScores, baseStake);
  const weightedTest = assignWeights(split.testRows, structureScores, baseStake);

  return {
    label,
    allowed_categories: allowedCategories,
    sample: {
      total_rows: scopedRows.length,
      total_days: uniqueValues(scopedRows, 'local_date').length,
      total_months: uniqueValues(scopedRows, 'local_month').length,
    },
    static_split: {
      top_structures: structureScores.slice(0, 15),
      train_summary: summarizeWeighted(weightedTrain),
      test_summary: summarizeWeighted(weightedTest),
      test_concentration: concentration(weightedTest),
      test_tiers: summarizeTiers(weightedTest),
    },
    walkforward: walkForward(scopedRows, baseStake, minCount, warmupMonths),
  };
}

function main() {
  const { inputPath, outputPath, baseStake, perspective } = parseArgs(process.argv);
  const rows = withDerivedFields(readJson(inputPath), perspective);
  const minCount = 30;
  const warmupMonths = 6;

  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    config: {
      base_stake: baseStake,
      perspective,
      min_structure_count: minCount,
      train_ratio: 0.7,
      walkforward_warmup_months: warmupMonths,
      weighting_rule: '按样本内结构分数分层配仓：前20%结构3x，20%-50%结构1.5x，其余0.5x',
      purpose: '验证 Z 是否更像权重仓位驱动，而不是固定仓位驱动',
    },
    universes: {
      all_structures: runUniverse(rows, baseStake, {
        label: 'all_structures',
        minCount,
        warmupMonths,
      }),
      focus_structures: runUniverse(rows, baseStake, {
        label: 'focus_structures',
        allowedCategories: ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'],
        minCount,
        warmupMonths,
      }),
    },
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    focusStaticRoi: output.universes.focus_structures.static_split.test_summary.roi,
    focusWalkforwardRoi: output.universes.focus_structures.walkforward.aggregate.summary.roi,
    focusTop20Share: output.universes.focus_structures.walkforward.aggregate.concentration.top_20pct_pnl_share,
  }, null, 2));
}

main();
