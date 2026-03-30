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
    console.error('Usage: node build_z_exposure_switch_model.js <input.json> <output.json>');
    process.exit(1);
  }
  return {
    inputPath: path.resolve(argv[2]),
    outputPath: path.resolve(argv[3]),
  };
}

function safeDivide(a, b) {
  return b ? a / b : 0;
}

function familyKey(structureKey) {
  const [category = 'unknown', marketType = 'unknown', priceBucket = 'unknown'] = structureKey.split(' | ');
  return {
    category,
    market_type: marketType,
    price_bucket: priceBucket,
    market_family: `${category} | ${marketType}`,
  };
}

function summarizeRows(rows) {
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

function buildWhitelist(recurringStructures, minAppearances) {
  return recurringStructures
    .filter((item) => item.appearances >= minAppearances)
    .map((item) => ({
      ...item,
      ...familyKey(item.key),
    }))
    .sort((a, b) => b.appearances - a.appearances || b.avg_score - a.avg_score);
}

function familySummaryFromWhitelist(whitelist) {
  const map = new Map();
  for (const item of whitelist) {
    const current = map.get(item.market_family) || {
      market_family: item.market_family,
      category: item.category,
      market_type: item.market_type,
      structure_count: 0,
      total_appearances: 0,
      avg_score_sum: 0,
      avg_roi_sum: 0,
    };
    current.structure_count += 1;
    current.total_appearances += item.appearances;
    current.avg_score_sum += item.avg_score;
    current.avg_roi_sum += item.avg_roi;
    map.set(item.market_family, current);
  }

  return [...map.values()]
    .map((item) => ({
      market_family: item.market_family,
      category: item.category,
      market_type: item.market_type,
      structure_count: item.structure_count,
      total_appearances: item.total_appearances,
      avg_structure_score: Number((item.avg_score_sum / item.structure_count).toFixed(6)),
      avg_structure_roi: Number((item.avg_roi_sum / item.structure_count).toFixed(6)),
    }))
    .sort((a, b) => b.total_appearances - a.total_appearances || b.avg_structure_score - a.avg_structure_score);
}

function monthlySwitches(steps, whitelistSet) {
  const previous = new Set();
  const out = [];

  for (const step of steps) {
    const activeTop = (step.top_structures || [])
      .map((item) => item.key)
      .filter((key) => whitelistSet.has(key));
    const activeSet = new Set(activeTop);
    const added = activeTop.filter((key) => !previous.has(key));
    const removed = [...previous].filter((key) => !activeSet.has(key));

    out.push({
      test_month: step.test_month,
      active_whitelist_count: activeTop.length,
      added,
      removed,
      active: activeTop,
      top_tier_summary: step.top_tier_summary || null,
      top_tier_trade_count: step.top_tier_trade_count ?? null,
    });

    previous.clear();
    for (const key of activeTop) previous.add(key);
  }

  return out;
}

function monthlyFamilyExposure(steps, whitelistSet) {
  return steps.map((step) => {
    const families = new Map();
    for (const structure of step.top_structures || []) {
      if (!whitelistSet.has(structure.key)) continue;
      const info = familyKey(structure.key);
      const current = families.get(info.market_family) || {
        market_family: info.market_family,
        category: info.category,
        market_type: info.market_type,
        active_structure_count: 0,
        score_sum: 0,
        roi_sum: 0,
      };
      current.active_structure_count += 1;
      current.score_sum += structure.score;
      current.roi_sum += structure.roi;
      families.set(info.market_family, current);
    }

    const activeFamilies = [...families.values()]
      .map((item) => ({
        market_family: item.market_family,
        category: item.category,
        market_type: item.market_type,
        active_structure_count: item.active_structure_count,
        avg_score: Number((item.score_sum / item.active_structure_count).toFixed(6)),
        avg_roi: Number((item.roi_sum / item.active_structure_count).toFixed(6)),
      }))
      .sort((a, b) => b.active_structure_count - a.active_structure_count || b.avg_score - a.avg_score);

    return {
      test_month: step.test_month,
      active_family_count: activeFamilies.length,
      active_families: activeFamilies,
    };
  });
}

function whitelistPerformance(steps, whitelistSet) {
  const rows = [];
  for (const step of steps) {
    for (const structure of step.top_structures || []) {
      if (!whitelistSet.has(structure.key)) continue;
      rows.push({
        key: structure.key,
        assigned_stake: 100,
        weighted_pnl: structure.roi * 100,
      });
    }
  }
  return summarizeRows(rows);
}

function buildUniverseMode(universe, minAppearances) {
  const whitelist = buildWhitelist(universe.recurring_top_tier_structures || [], minAppearances);
  const whitelistSet = new Set(whitelist.map((item) => item.key));
  const switches = monthlySwitches(universe.steps || [], whitelistSet);
  const familyExposure = monthlyFamilyExposure(universe.steps || [], whitelistSet);

  const avgActiveWhitelistCount = switches.length
    ? Number((switches.reduce((sum, item) => sum + item.active_whitelist_count, 0) / switches.length).toFixed(6))
    : 0;

  const addedCount = switches.reduce((sum, item) => sum + item.added.length, 0);
  const removedCount = switches.reduce((sum, item) => sum + item.removed.length, 0);

  return {
    whitelist,
    whitelist_families: familySummaryFromWhitelist(whitelist),
    monthly_switches: switches,
    monthly_family_exposure: familyExposure,
    exposure_summary: {
      whitelist_size: whitelist.length,
      avg_active_whitelist_count: avgActiveWhitelistCount,
      total_add_events: addedCount,
      total_remove_events: removedCount,
      avg_monthly_churn: switches.length
        ? Number((safeDivide(addedCount + removedCount, switches.length)).toFixed(6))
        : 0,
    },
    reference_performance: {
      top_tier_only: universe.aggregate?.top_tier_only ?? null,
      top_tier_overall_positive: universe.aggregate?.top_tier_overall_positive ?? null,
      top_tier_dual_positive: universe.aggregate?.top_tier_dual_positive ?? null,
      whitelist_meta_score: whitelistPerformance(universe.steps || [], whitelistSet),
    },
  };
}

function main() {
  const { inputPath, outputPath } = parseArgs(process.argv);
  const payload = readJson(inputPath);
  const allUniverse = payload.universes?.all_structures || {};
  const focusUniverse = payload.universes?.focus_structures || {};

  const output = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    config: {
      min_recurring_appearances: 6,
      interpretation: '把 recurring top-tier 结构视为 Z 的主利润白名单，并观察月度暴露切换',
    },
    universes: {
      all_structures: buildUniverseMode(allUniverse, 6),
      focus_structures: buildUniverseMode(focusUniverse, 6),
    },
  };

  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    focusWhitelistSize: output.universes.focus_structures.exposure_summary.whitelist_size,
    focusAvgActiveWhitelistCount: output.universes.focus_structures.exposure_summary.avg_active_whitelist_count,
    focusTopTierOnlyRoi: output.universes.focus_structures.reference_performance.top_tier_only?.roi ?? null,
  }, null, 2));
}

main();
