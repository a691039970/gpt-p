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
    console.error('Usage: node build_z_core_satellite_model.js <input.json> <output.json> [baseStake] [perspective]');
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
    if (part.type !== 'literal') partMap[part.type] = part.value;
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

function familyKeyFromRow(row) {
  return `${row.category} | ${row.market_type}`;
}

function withDerivedFields(payload, perspective) {
  return (payload.rows || [])
    .filter((row) => Number.isFinite(row.realized_pnl) && Number.isFinite(row.size) && row.size > 0 && row.timestamp)
    .map((row) => {
      const date = new Date(row.timestamp);
      const parts = shanghaiParts(date);
      const pnl = perspective === 'z' ? -row.realized_pnl : row.realized_pnl;
      const marketType = marketTypeFromNotes(row.notes);
      const bucket = priceBucket(row.price);
      return {
        ...row,
        perspective_pnl: pnl,
        unit_return: pnl / row.size,
        market_type: marketType,
        price_bucket: bucket,
        structure_key: `${row.category} | ${marketType} | ${bucket}`,
        market_family: `${row.category} | ${marketType}`,
        local_date: parts.date,
        local_month: parts.month,
        _ts: date.getTime(),
      };
    })
    .sort((a, b) => a._ts - b._ts);
}

function summarizeWeighted(rows) {
  const count = rows.length;
  const stakeSum = rows.reduce((sum, row) => sum + (row.assigned_stake || 0), 0);
  const pnlSum = rows.reduce((sum, row) => sum + (row.weighted_pnl || 0), 0);
  const positive = rows.filter((row) => (row.weighted_pnl || 0) > 0).length;
  const negative = rows.filter((row) => (row.weighted_pnl || 0) < 0).length;
  const flat = rows.filter((row) => (row.weighted_pnl || 0) === 0).length;
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
        market_family: `${category} | ${marketType}`,
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

function activeTopTierFamilies(structureScores, threshold = 0.8) {
  const families = new Map();
  for (const item of structureScores) {
    if (item.score_percentile < threshold) continue;
    const current = families.get(item.market_family) || {
      market_family: item.market_family,
      category: item.category,
      market_type: item.market_type,
      active_structure_count: 0,
      score_sum: 0,
      roi_sum: 0,
    };
    current.active_structure_count += 1;
    current.score_sum += item.score;
    current.roi_sum += item.roi;
    families.set(item.market_family, current);
  }
  return [...families.values()]
    .map((item) => ({
      market_family: item.market_family,
      category: item.category,
      market_type: item.market_type,
      active_structure_count: item.active_structure_count,
      avg_score: item.score_sum / item.active_structure_count,
      avg_roi: item.roi_sum / item.active_structure_count,
    }))
    .sort((a, b) => b.avg_score - a.avg_score || b.active_structure_count - a.active_structure_count);
}

function assignRowsByPlan(rows, structureScores, baseStake, allowedFamilies) {
  const scoreMap = new Map(structureScores.map((item) => [item.key, item]));
  return rows
    .filter((row) => scoreMap.has(row.structure_key))
    .map((row) => {
      const score = scoreMap.get(row.structure_key);
      const inTopTier = score.score_percentile >= 0.8;
      const enabled = inTopTier && allowedFamilies.has(row.market_family);
      const assignedStake = enabled ? baseStake * 3 : 0;
      return {
        ...row,
        assigned_stake: assignedStake,
        weighted_pnl: row.unit_return * assignedStake,
      };
    })
    .filter((row) => row.assigned_stake > 0);
}

function planFamilies(activeFamilies) {
  const coreFamilies = activeFamilies
    .filter((item) => item.category === 'Dota2')
    .map((item) => item.market_family);
  const footballFamilies = activeFamilies
    .filter((item) => item.category === 'Football')
    .map((item) => item.market_family);

  return {
    core_only: new Set(coreFamilies),
    core_plus_football: new Set([...coreFamilies, ...footballFamilies]),
    full_active: new Set(activeFamilies.map((item) => item.market_family)),
  };
}

function runMonthlyRotation(rows, baseStake) {
  const scopedRows = rows.filter((row) => ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'].includes(row.category));
  const months = uniqueValues(scopedRows, 'local_month');
  const steps = [];
  const aggregate = {
    core_only: [],
    core_plus_football: [],
    full_active: [],
  };

  for (let i = 6; i < months.length; i += 1) {
    const trainMonths = new Set(months.slice(0, i));
    const testMonth = months[i];
    const trainRows = scopedRows.filter((row) => trainMonths.has(row.local_month));
    const testRows = scopedRows.filter((row) => row.local_month === testMonth);
    const structureScores = scoreStructures(trainRows, 30);
    const activeFamilies = activeTopTierFamilies(structureScores, 0.8);
    const plans = planFamilies(activeFamilies);

    const monthResult = {
      test_month: testMonth,
      dominant_family: activeFamilies[0]?.market_family ?? null,
      active_families: activeFamilies,
      plan_results: {},
    };

    for (const [planName, familySet] of Object.entries(plans)) {
      const assigned = assignRowsByPlan(testRows, structureScores, baseStake, familySet);
      monthResult.plan_results[planName] = summarizeWeighted(assigned);
      aggregate[planName].push(...assigned);
    }

    steps.push(monthResult);
  }

  return {
    tested_months: steps.length,
    steps,
    aggregate: {
      core_only: summarizeWeighted(aggregate.core_only),
      core_plus_football: summarizeWeighted(aggregate.core_plus_football),
      full_active: summarizeWeighted(aggregate.full_active),
    },
  };
}

function comparePlans(steps) {
  return steps.map((step) => ({
    test_month: step.test_month,
    dominant_family: step.dominant_family,
    core_only_roi: step.plan_results.core_only.roi,
    core_plus_football_roi: step.plan_results.core_plus_football.roi,
    full_active_roi: step.plan_results.full_active.roi,
    football_helped: step.plan_results.core_plus_football.pnl_sum > step.plan_results.core_only.pnl_sum,
    full_helped: step.plan_results.full_active.pnl_sum > step.plan_results.core_plus_football.pnl_sum,
  }));
}

function main() {
  const { inputPath, outputPath, baseStake, perspective } = parseArgs(process.argv);
  const rows = withDerivedFields(readJson(inputPath), perspective);
  const model = runMonthlyRotation(rows, baseStake);
  const comparisons = comparePlans(model.steps);
  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    config: {
      base_stake: baseStake,
      perspective,
      focus_categories: ['Dota2', 'LoL', 'CS2', 'Basketball', 'Football'],
      plan_definitions: {
        core_only: '只做当月 active top-tier 中的 Dota2 家族',
        core_plus_football: 'Dota2 主中枢 + Football 辅助线',
        full_active: '当月 active top-tier 全部家族',
      },
    },
    model,
    comparisons,
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    coreOnlyRoi: output.model.aggregate.core_only.roi,
    corePlusFootballRoi: output.model.aggregate.core_plus_football.roi,
    fullActiveRoi: output.model.aggregate.full_active.roi,
  }, null, 2));
}

main();
