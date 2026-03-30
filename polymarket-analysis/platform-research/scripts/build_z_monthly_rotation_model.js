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
    console.error('Usage: node build_z_monthly_rotation_model.js <input.json> <output.json>');
    process.exit(1);
  }
  return {
    inputPath: path.resolve(argv[2]),
    outputPath: path.resolve(argv[3]),
  };
}

function familyKey(structureKey) {
  const [category = 'unknown', marketType = 'unknown', priceBucket = 'unknown'] = structureKey.split(' | ');
  return {
    category,
    market_type: marketType,
    price_bucket: priceBucket,
    family: `${category} | ${marketType}`,
  };
}

function safeDivide(a, b) {
  return b ? a / b : 0;
}

function summarizeRows(rows) {
  const count = rows.length;
  const stakeSum = rows.reduce((sum, row) => sum + (row.stake_sum || 0), 0);
  const pnlSum = rows.reduce((sum, row) => sum + (row.pnl_sum || 0), 0);
  return {
    count,
    stake_sum: Number(stakeSum.toFixed(6)),
    pnl_sum: Number(pnlSum.toFixed(6)),
    roi: stakeSum ? Number((pnlSum / stakeSum).toFixed(6)) : 0,
  };
}

function dominantFamily(activeFamilies) {
  if (!activeFamilies.length) return null;
  const sorted = [...activeFamilies].sort((a, b) => {
    if (b.avg_score !== a.avg_score) return b.avg_score - a.avg_score;
    if (b.active_structure_count !== a.active_structure_count) return b.active_structure_count - a.active_structure_count;
    return b.avg_roi - a.avg_roi;
  });
  return sorted[0];
}

function buildMonthlyRotation(universe) {
  const months = universe.monthly_family_exposure || [];
  const switches = [];
  let previousDominant = null;

  for (const month of months) {
    const dominant = dominantFamily(month.active_families || []);
    const switched = previousDominant && dominant
      ? previousDominant.family !== dominant.market_family
      : false;

    switches.push({
      test_month: month.test_month,
      dominant_family: dominant ? dominant.market_family : null,
      dominant_category: dominant ? dominant.category : null,
      dominant_avg_score: dominant ? dominant.avg_score : null,
      dominant_avg_roi: dominant ? dominant.avg_roi : null,
      active_family_count: month.active_family_count,
      switched_from_previous: switched,
      active_families: month.active_families || [],
    });

    previousDominant = dominant
      ? { family: dominant.market_family }
      : previousDominant;
  }

  return switches;
}

function buildLeaderBoard(rotation) {
  const map = new Map();
  for (const month of rotation) {
    if (!month.dominant_family) continue;
    const current = map.get(month.dominant_family) || {
      market_family: month.dominant_family,
      category: month.dominant_category,
      dominant_months: 0,
      score_sum: 0,
      roi_sum: 0,
    };
    current.dominant_months += 1;
    current.score_sum += month.dominant_avg_score || 0;
    current.roi_sum += month.dominant_avg_roi || 0;
    map.set(month.dominant_family, current);
  }

  return [...map.values()]
    .map((item) => ({
      market_family: item.market_family,
      category: item.category,
      dominant_months: item.dominant_months,
      avg_score_when_dominant: Number((item.score_sum / item.dominant_months).toFixed(6)),
      avg_roi_when_dominant: Number((item.roi_sum / item.dominant_months).toFixed(6)),
    }))
    .sort((a, b) => b.dominant_months - a.dominant_months || b.avg_score_when_dominant - a.avg_score_when_dominant);
}

function categoryRotation(rotation) {
  const map = new Map();
  for (const month of rotation) {
    if (!month.dominant_category) continue;
    const current = map.get(month.dominant_category) || {
      category: month.dominant_category,
      dominant_months: 0,
      family_set: new Set(),
    };
    current.dominant_months += 1;
    current.family_set.add(month.dominant_family);
    map.set(month.dominant_category, current);
  }

  return [...map.values()]
    .map((item) => ({
      category: item.category,
      dominant_months: item.dominant_months,
      dominant_family_count: item.family_set.size,
    }))
    .sort((a, b) => b.dominant_months - a.dominant_months);
}

function transitionPairs(rotation) {
  const map = new Map();
  for (let i = 1; i < rotation.length; i += 1) {
    const prev = rotation[i - 1];
    const curr = rotation[i];
    if (!prev.dominant_family || !curr.dominant_family) continue;
    const key = `${prev.dominant_family} -> ${curr.dominant_family}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([transition, count]) => ({ transition, count }))
    .sort((a, b) => b.count - a.count || a.transition.localeCompare(b.transition));
}

function buildExposureShape(universe) {
  const months = universe.monthly_switches || [];
  return months.map((month) => ({
    test_month: month.test_month,
    active_whitelist_count: month.active_whitelist_count,
    add_count: month.added.length,
    remove_count: month.removed.length,
    net_change: month.added.length - month.removed.length,
    top_tier_roi: month.top_tier_summary?.roi ?? null,
    top_tier_pnl: month.top_tier_summary?.pnl_sum ?? null,
  }));
}

function buildUniverseModel(universe) {
  const rotation = buildMonthlyRotation(universe);
  const switches = rotation.filter((item) => item.switched_from_previous).length;
  return {
    dominant_rotation: rotation,
    dominant_leaderboard: buildLeaderBoard(rotation),
    dominant_category_rotation: categoryRotation(rotation),
    transition_pairs: transitionPairs(rotation),
    exposure_shape: buildExposureShape(universe),
    summary: {
      tested_months: rotation.length,
      dominant_switch_count: switches,
      dominant_switch_rate: rotation.length > 1
        ? Number((switches / (rotation.length - 1)).toFixed(6))
        : 0,
      whitelist_size: universe.exposure_summary?.whitelist_size ?? null,
      avg_active_whitelist_count: universe.exposure_summary?.avg_active_whitelist_count ?? null,
      top_tier_only_roi: universe.reference_performance?.top_tier_only?.roi ?? null,
    },
  };
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    universes: {
      all_structures: buildUniverseModel(payload.universes?.all_structures || {}),
      focus_structures: buildUniverseModel(payload.universes?.focus_structures || {}),
    },
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    focusSwitchRate: output.universes.focus_structures.summary.dominant_switch_rate,
    focusTopTierOnlyRoi: output.universes.focus_structures.summary.top_tier_only_roi,
    focusDominantLeader: output.universes.focus_structures.dominant_leaderboard[0]?.market_family ?? null,
  }, null, 2));
}

main();
