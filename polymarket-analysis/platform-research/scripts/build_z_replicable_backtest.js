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
    console.error('Usage: node build_z_replicable_backtest.js <input.json> <output.json> [fixedStake] [perspective]');
    process.exit(1);
  }

  const fixedStake = argv[4] ? Number(argv[4]) : 100;
  if (!Number.isFinite(fixedStake) || fixedStake <= 0) {
    console.error('fixedStake must be a positive number');
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
    fixedStake,
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

function summarizeFixedStake(rows, fixedStake) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const row of rows) {
    equity += row.fixed_pnl;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const count = rows.length;
  const fixedPnlSum = rows.reduce((sum, row) => sum + row.fixed_pnl, 0);
  const roi = count ? fixedPnlSum / (count * fixedStake) : 0;
  const positive = rows.filter((row) => row.fixed_pnl > 0).length;
  const negative = rows.filter((row) => row.fixed_pnl < 0).length;
  const flat = rows.filter((row) => row.fixed_pnl === 0).length;

  return {
    count,
    fixed_stake: fixedStake,
    stake_sum: count * fixedStake,
    pnl_sum: Number(fixedPnlSum.toFixed(6)),
    pnl_avg: count ? Number((fixedPnlSum / count).toFixed(6)) : 0,
    roi: Number(roi.toFixed(6)),
    positive,
    negative,
    flat,
    win_rate: count ? Number((positive / count).toFixed(6)) : 0,
    max_drawdown: Number(maxDrawdown.toFixed(6)),
  };
}

function withDerivedFields(payload, fixedStake, perspective) {
  return (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && Number.isFinite(row.size) && row.size > 0 && row.timestamp)
    .map((row) => {
      const date = new Date(row.timestamp);
      const parts = shanghaiParts(date);
      const pnl = perspective === 'z' ? -row.realized_pnl : row.realized_pnl;
      const unitReturn = pnl / row.size;
      const fixedPnl = unitReturn * fixedStake;
      const marketType = marketTypeFromNotes(row.notes);
      const bucket = priceBucket(row.price);
      return {
        ...row,
        perspective_pnl: pnl,
        market_type: marketType,
        price_bucket: bucket,
        structure_key: `${row.category} | ${marketType} | ${bucket}`,
        local_date: parts.date,
        local_month: parts.month,
        fixed_pnl: fixedPnl,
        unit_return: unitReturn,
        _ts: date.getTime(),
      };
    })
    .sort((a, b) => a._ts - b._ts);
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]))].sort();
}

function evaluateStructureCandidates(rows, fixedStake, minCount) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.structure_key)) grouped.set(row.structure_key, []);
    grouped.get(row.structure_key).push(row);
  }

  return [...grouped.entries()]
    .map(([key, subset]) => {
      const summary = summarizeFixedStake(subset, fixedStake);
      const [category, marketType, priceBucketLabel] = key.split(' | ');
      return {
        key,
        category,
        market_type: marketType,
        price_bucket: priceBucketLabel,
        first_date: subset[0]?.local_date ?? null,
        last_date: subset[subset.length - 1]?.local_date ?? null,
        ...summary,
      };
    })
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => {
      if (b.pnl_sum !== a.pnl_sum) return b.pnl_sum - a.pnl_sum;
      if (b.roi !== a.roi) return b.roi - a.roi;
      return b.count - a.count;
    });
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

function monthRange(months, startIndex, endIndexExclusive) {
  return {
    start_month: months[startIndex] ?? null,
    end_month: months[endIndexExclusive - 1] ?? null,
  };
}

function buildWalkForward(rows, fixedStake, minTrainCount, warmupMonths) {
  const months = uniqueValues(rows, 'local_month');
  const steps = [];

  for (let i = warmupMonths; i < months.length; i += 1) {
    const trainMonths = new Set(months.slice(0, i));
    const testMonth = months[i];
    const trainRows = rows.filter((row) => trainMonths.has(row.local_month));
    const testRows = rows.filter((row) => row.local_month === testMonth);
    const ranked = evaluateStructureCandidates(trainRows, fixedStake, minTrainCount);
    if (!ranked.length) continue;

    const selected = ranked[0];
    const selectedTestRows = testRows.filter((row) => row.structure_key === selected.key);
    const testSummary = summarizeFixedStake(selectedTestRows, fixedStake);
    const benchmarkSummary = summarizeFixedStake(testRows, fixedStake);

    steps.push({
      test_month: testMonth,
      train_months: monthRange(months, 0, i),
      selected_structure: selected,
      selected_test_summary: testSummary,
      benchmark_test_summary: benchmarkSummary,
    });
  }

  const selectedAggregateRows = [];
  const benchmarkAggregateRows = [];
  for (const step of steps) {
    const monthRows = rows.filter((row) => row.local_month === step.test_month);
    benchmarkAggregateRows.push(...monthRows);
    selectedAggregateRows.push(...monthRows.filter((row) => row.structure_key === step.selected_structure.key));
  }

  return {
    warmup_months: warmupMonths,
    tested_months: steps.length,
    steps,
    aggregate: {
      selected: summarizeFixedStake(selectedAggregateRows, fixedStake),
      benchmark_all_trades: summarizeFixedStake(benchmarkAggregateRows, fixedStake),
    },
  };
}

function buildConclusion(staticSplit, walkForward) {
  const trainOk = staticSplit.selected_train_summary.roi > 0;
  const testOk = staticSplit.selected_test_summary.roi > 0;
  const wfOk = walkForward.aggregate.selected.roi > 0;
  const beatsBenchmark = walkForward.aggregate.selected.roi > walkForward.aggregate.benchmark_all_trades.roi;

  let verdict = 'unproven';
  if (trainOk && testOk && wfOk && beatsBenchmark) {
    verdict = 'replicable';
  } else if (trainOk && (testOk || wfOk)) {
    verdict = 'partially_replicable';
  }

  return {
    verdict,
    can_replicate: verdict === 'replicable',
    static_oos_positive: testOk,
    walkforward_positive: wfOk,
    walkforward_beats_benchmark: beatsBenchmark,
    reasoning: [
      trainOk ? '样本内最强结构为正收益。' : '样本内最强结构本身不稳。', 
      testOk ? '单次样本外验证为正。' : '单次样本外验证未转正。',
      wfOk ? '逐月滚动样本外总体为正。' : '逐月滚动样本外总体未转正。',
      beatsBenchmark ? '滚动样本外优于全量固定仓位基准。' : '滚动样本外未明显优于全量基准。'
    ],
  };
}

function runPrototype(rows, fixedStake, options = {}) {
  const {
    label = 'default',
    allowedCategories = null,
    minTrainCount = 30,
    warmupMonths = 6,
  } = options;

  const scopedRows = allowedCategories
    ? rows.filter((row) => allowedCategories.includes(row.category))
    : rows;

  const split = splitByDay(scopedRows, 0.7);
  const rankedTrain = evaluateStructureCandidates(split.trainRows, fixedStake, minTrainCount);
  if (!rankedTrain.length) {
    return {
      label,
      allowed_categories: allowedCategories,
      sample: {
        total_rows: scopedRows.length,
        total_days: uniqueValues(scopedRows, 'local_date').length,
        total_months: uniqueValues(scopedRows, 'local_month').length,
        all_trades_fixed_stake_summary: summarizeFixedStake(scopedRows, fixedStake),
      },
      error: 'No structure candidates survived the training filter',
    };
  }

  const selected = rankedTrain[0];
  const selectedTrainRows = split.trainRows.filter((row) => row.structure_key === selected.key);
  const selectedTestRows = split.testRows.filter((row) => row.structure_key === selected.key);
  const staticSplit = {
    train_period: {
      first_date: split.trainRows[0]?.local_date ?? null,
      last_date: split.trainRows[split.trainRows.length - 1]?.local_date ?? null,
      day_count: uniqueValues(split.trainRows, 'local_date').length,
    },
    test_period: {
      first_date: split.testRows[0]?.local_date ?? null,
      last_date: split.testRows[split.testRows.length - 1]?.local_date ?? null,
      day_count: uniqueValues(split.testRows, 'local_date').length,
    },
    selected_structure: selected,
    top_train_candidates: rankedTrain.slice(0, 15),
    selected_train_summary: summarizeFixedStake(selectedTrainRows, fixedStake),
    selected_test_summary: summarizeFixedStake(selectedTestRows, fixedStake),
    benchmark_train_summary: summarizeFixedStake(split.trainRows, fixedStake),
    benchmark_test_summary: summarizeFixedStake(split.testRows, fixedStake),
  };

  const walkForward = buildWalkForward(scopedRows, fixedStake, minTrainCount, warmupMonths);

  return {
    label,
    allowed_categories: allowedCategories,
    sample: {
      total_rows: scopedRows.length,
      total_days: uniqueValues(scopedRows, 'local_date').length,
      total_months: uniqueValues(scopedRows, 'local_month').length,
      all_trades_fixed_stake_summary: summarizeFixedStake(scopedRows, fixedStake),
    },
    static_split: staticSplit,
    walkforward: walkForward,
    conclusion: buildConclusion(staticSplit, walkForward),
  };
}

function main() {
  const { inputPath, outputPath, fixedStake, perspective } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const rows = withDerivedFields(payload, fixedStake, perspective);

  const minTrainCount = 30;
  const warmupMonths = 6;
  const prototypes = {
    all_structures: runPrototype(rows, fixedStake, {
      label: 'all_structures',
      minTrainCount,
      warmupMonths,
    }),
    focus_structures: runPrototype(rows, fixedStake, {
      label: 'focus_structures',
      allowedCategories: ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'],
      minTrainCount,
      warmupMonths,
    }),
  };

  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    config: {
      fixed_stake: fixedStake,
      perspective,
      min_train_count: minTrainCount,
      train_ratio: 0.7,
      walkforward_warmup_months: warmupMonths,
      selection_rule: '样本内按固定仓位净利润排序，只保留一条最强结构',
    },
    sample: {
      total_rows: rows.length,
      total_days: uniqueValues(rows, 'local_date').length,
      total_months: uniqueValues(rows, 'local_month').length,
      all_trades_fixed_stake_summary: summarizeFixedStake(rows, fixedStake),
    },
    prototypes,
  };

  writeJson(outputPath, output);
  const allStructures = prototypes.all_structures;
  console.log(JSON.stringify({
    outputPath,
    selectedStructure: allStructures.static_split?.selected_structure?.key ?? null,
    staticTestRoi: allStructures.static_split?.selected_test_summary?.roi ?? null,
    walkforwardRoi: allStructures.walkforward?.aggregate?.selected?.roi ?? null,
    verdict: allStructures.conclusion?.verdict ?? 'error',
  }, null, 2));
}

main();
