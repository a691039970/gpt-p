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
    console.error('Usage: node build_z_mode_model.js <input.json> <output.json> [baseStake] [perspective]');
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

function withDerivedFields(payload, perspective) {
  return (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && Number.isFinite(row.size) && row.size > 0 && row.timestamp)
    .map((row) => {
      const date = new Date(row.timestamp);
      const parts = shanghaiParts(date);
      const pnl = perspective === 'z' ? -row.realized_pnl : row.realized_pnl;
      const marketType = marketTypeFromNotes(row.notes);
      const priceBucketLabel = priceBucket(row.price);
      return {
        ...row,
        perspective_pnl: pnl,
        unit_return: pnl / row.size,
        market_type: marketType,
        price_bucket: priceBucketLabel,
        structure_key: `${row.category} | ${marketType} | ${priceBucketLabel}`,
        local_date: parts.date,
        local_month: parts.month,
        _ts: date.getTime(),
      };
    })
    .sort((a, b) => a._ts - b._ts);
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

function summarizeRows(rows) {
  const count = rows.length;
  const pnlSum = rows.reduce((sum, row) => sum + row.perspective_pnl, 0);
  const positive = rows.filter((row) => row.perspective_pnl > 0).length;
  const negative = rows.filter((row) => row.perspective_pnl < 0).length;
  const flat = rows.filter((row) => row.perspective_pnl === 0).length;
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
    unit_return_avg: stakeSum ? pnlSum / stakeSum : 0,
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

function assignTopTierOnly(rows, structureScores, baseStake, threshold = 0.8) {
  const scoreMap = new Map(structureScores.map((entry) => [entry.key, entry]));
  return rows
    .filter((row) => scoreMap.has(row.structure_key))
    .map((row) => {
      const score = scoreMap.get(row.structure_key);
      const allowed = score.score_percentile >= threshold;
      const assignedStake = allowed ? baseStake * 3 : 0;
      return {
        ...row,
        structure_score: score.score,
        structure_score_percentile: score.score_percentile,
        top_tier: allowed,
        assigned_stake: assignedStake,
        weighted_pnl: row.unit_return * assignedStake,
      };
    });
}

function recentState(rows, endTs, windowDays, category = null) {
  const startTs = endTs - windowDays * 24 * 60 * 60 * 1000;
  const subset = rows.filter((row) => {
    if (row._ts > endTs || row._ts <= startTs) return false;
    if (category && row.category !== category) return false;
    return true;
  });

  const summary = summarizeRows(subset);
  let score = 50;
  if (summary.count >= 5) {
    const pnlPart = summary.pnl_avg > 0 ? 35 : summary.pnl_avg < 0 ? 10 : 20;
    const winPart = summary.win_rate >= 0.55 ? 30 : summary.win_rate >= 0.48 ? 20 : summary.win_rate >= 0.42 ? 12 : 5;
    const actPart = summary.count >= 50 ? 25 : summary.count >= 20 ? 18 : summary.count >= 10 ? 10 : 5;
    score = Math.min(100, pnlPart + winPart + actPart);
  }

  return {
    window_days: windowDays,
    ...summary,
    score,
    label: labelScore(score),
  };
}

function monthlyModeWalkForward(rows, baseStake, options = {}) {
  const {
    allowedCategories = null,
    minCount = 30,
    warmupMonths = 6,
    topTierThreshold = 0.8,
  } = options;

  const scopedRows = allowedCategories ? rows.filter((row) => allowedCategories.includes(row.category)) : rows;
  const months = uniqueValues(scopedRows, 'local_month');
  const steps = [];
  const aggregate = {
    top_tier_only: [],
    top_tier_overall_positive: [],
    top_tier_dual_positive: [],
  };
  const structureAppearance = new Map();

  for (let i = warmupMonths; i < months.length; i += 1) {
    const trainMonths = new Set(months.slice(0, i));
    const testMonth = months[i];
    const trainRows = scopedRows.filter((row) => trainMonths.has(row.local_month));
    const testRows = scopedRows.filter((row) => row.local_month === testMonth);
    const structureScores = scoreStructures(trainRows, minCount);
    if (!structureScores.length) continue;

    for (const structure of structureScores.filter((item) => item.score_percentile >= topTierThreshold)) {
      const current = structureAppearance.get(structure.key) || {
        key: structure.key,
        appearances: 0,
        total_score: 0,
        total_roi: 0,
        category: structure.category,
        market_type: structure.market_type,
        price_bucket: structure.price_bucket,
      };
      current.appearances += 1;
      current.total_score += structure.score;
      current.total_roi += structure.roi;
      structureAppearance.set(structure.key, current);
    }

    const monthEndTs = Math.max(...trainRows.map((row) => row._ts));
    const overall7 = recentState(scopedRows, monthEndTs, 7);
    const overall14 = recentState(scopedRows, monthEndTs, 14);

    const assigned = assignTopTierOnly(testRows, structureScores, baseStake, topTierThreshold);
    const topTierRows = assigned.filter((row) => row.top_tier);
    const overallPositiveRows = topTierRows.filter(() => overall14.score >= 60);
    const dualPositiveRows = topTierRows.filter((row) => {
      const category14 = recentState(scopedRows, monthEndTs, 14, row.category);
      return overall14.score >= 60 && category14.score >= 60;
    });

    aggregate.top_tier_only.push(...topTierRows);
    aggregate.top_tier_overall_positive.push(...overallPositiveRows);
    aggregate.top_tier_dual_positive.push(...dualPositiveRows);

    steps.push({
      test_month: testMonth,
      overall_state_7d: overall7,
      overall_state_14d: overall14,
      top_structures: structureScores.slice(0, 10),
      top_tier_summary: summarizeWeighted(topTierRows),
      top_tier_overall_positive_summary: summarizeWeighted(overallPositiveRows),
      top_tier_dual_positive_summary: summarizeWeighted(dualPositiveRows),
      top_tier_trade_count: topTierRows.length,
      dual_positive_trade_count: dualPositiveRows.length,
    });
  }

  const recurringStructures = [...structureAppearance.values()]
    .map((entry) => ({
      ...entry,
      avg_score: entry.appearances ? entry.total_score / entry.appearances : 0,
      avg_roi: entry.appearances ? entry.total_roi / entry.appearances : 0,
    }))
    .sort((a, b) => b.appearances - a.appearances || b.avg_score - a.avg_score)
    .slice(0, 25);

  return {
    warmup_months: warmupMonths,
    top_tier_threshold: topTierThreshold,
    tested_months: steps.length,
    steps,
    recurring_top_tier_structures: recurringStructures,
    aggregate: {
      top_tier_only: summarizeWeighted(aggregate.top_tier_only),
      top_tier_overall_positive: summarizeWeighted(aggregate.top_tier_overall_positive),
      top_tier_dual_positive: summarizeWeighted(aggregate.top_tier_dual_positive),
    },
  };
}

function main() {
  const { inputPath, outputPath, baseStake, perspective } = parseArgs(process.argv);
  const rows = withDerivedFields(readJson(inputPath), perspective);
  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    config: {
      base_stake: baseStake,
      perspective,
      min_structure_count: 30,
      walkforward_warmup_months: 6,
      top_tier_threshold: 0.8,
      mode_definition: '只做训练期 top tier 结构，并测试是否需要总状态/品类状态过滤',
    },
    universes: {
      all_structures: monthlyModeWalkForward(rows, baseStake, {
        minCount: 30,
        warmupMonths: 6,
        topTierThreshold: 0.8,
      }),
      focus_structures: monthlyModeWalkForward(rows, baseStake, {
        allowedCategories: ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'],
        minCount: 30,
        warmupMonths: 6,
        topTierThreshold: 0.8,
      }),
    },
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    focusTopTierOnlyRoi: output.universes.focus_structures.aggregate.top_tier_only.roi,
    focusOverallPositiveRoi: output.universes.focus_structures.aggregate.top_tier_overall_positive.roi,
    focusDualPositiveRoi: output.universes.focus_structures.aggregate.top_tier_dual_positive.roi,
  }, null, 2));
}

main();
