const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/[\s|/-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function buildMatchupKey(row) {
  const matchupFromNotes = (() => {
    const notes = String(row.notes || "");
    const match = notes.match(/matchup=([^;]+)/);
    return match ? match[1] : "";
  })();
  const title = normalizeText(`${matchupFromNotes} ${row.title || ""}`);
  const tokens = tokenize(title)
    .filter(
      (token) =>
        ![
          "vs",
          "bo1",
          "bo3",
          "bo5",
          "match",
          "比赛",
          "让球盘",
          "大小盘",
          "独赢盘",
          "over",
          "under",
        ].includes(token)
    )
    .slice(0, 8);
  return [...new Set(tokens)].sort().join("|");
}

function buildMarketFamily(row) {
  const text = `${row.title || ""} ${row.notes || ""}`;
  if (/让球|handicap|spread/i.test(text)) return "handicap";
  if (/大小盘|total|over|under/i.test(text)) return "total";
  if (/独赢|winner|moneyline/i.test(text)) return "winner";
  return "other";
}

function extractNoteValue(notes, key) {
  const text = String(notes || "");
  const pattern = new RegExp(`${key}=([^;]+)`);
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function numericNoteValue(notes, key) {
  const raw = extractNoteValue(notes, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

function oppositeSignalHint(a, b) {
  const aOutcome = normalizeText(a.outcome || "");
  const bOutcome = normalizeText(b.outcome || "");
  if (!aOutcome || !bOutcome) return false;
  if (aOutcome === bOutcome) return false;

  const pairs = [
    ["over", "under"],
    ["大盘", "小盘"],
    ["yes", "no"],
  ];
  return pairs.some(([left, right]) =>
    (aOutcome.includes(left) && bOutcome.includes(right)) ||
    (aOutcome.includes(right) && bOutcome.includes(left))
  );
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scorePair(a, b) {
  const notes = [];
  const aTime = safeDate(a.timestamp);
  const bTime = safeDate(b.timestamp);
  if (!aTime || !bTime) return null;

  const timeGapMinutes = Math.abs(aTime - bTime) / 60000;
  if (timeGapMinutes > 360) return null;

  const aEvent = safeDate(a.event_start_time);
  const bEvent = safeDate(b.event_start_time);
  const eventGapHours = aEvent && bEvent ? Math.abs(aEvent - bEvent) / 3600000 : null;
  const sameEventDay =
    aEvent && bEvent ? aEvent.toISOString().slice(0, 10) === bEvent.toISOString().slice(0, 10) : false;
  const sameCategory = (a.category || "") === (b.category || "") && !!a.category;
  const aMatchupKey = buildMatchupKey(a);
  const bMatchupKey = buildMatchupKey(b);
  const sameMatchupKey = !!aMatchupKey && aMatchupKey === bMatchupKey;
  const aMarketFamily = buildMarketFamily(a);
  const bMarketFamily = buildMarketFamily(b);
  const sameMarketFamily = aMarketFamily === bMarketFamily && aMarketFamily !== "other";
  const oppositeHint = oppositeSignalHint(a, b);
  const aSelectionSide = extractNoteValue(a.notes, "selection_side");
  const bSelectionSide = extractNoteValue(b.notes, "selection_side");
  const aHandicap = numericNoteValue(a.notes, "handicap_value");
  const bHandicap = numericNoteValue(b.notes, "handicap_value");
  const aTotal = numericNoteValue(a.notes, "total_value");
  const bTotal = numericNoteValue(b.notes, "total_value");
  const oppositeStructuredHint =
    (aSelectionSide === "over" && bSelectionSide === "under") ||
    (aSelectionSide === "under" && bSelectionSide === "over") ||
    (aHandicap !== null && bHandicap !== null && aHandicap === -bHandicap) ||
    (aTotal !== null && bTotal !== null && aTotal === bTotal && aSelectionSide !== bSelectionSide);

  let score = 0;
  if (sameCategory) {
    score += 1.2;
    notes.push("same_category");
  }
  if (sameMatchupKey) {
    score += 2.5;
    notes.push("same_matchup_key");
  }
  if (sameEventDay) {
    score += 1.5;
    notes.push("same_event_day");
  }
  if (sameMarketFamily) {
    score += 1.2;
    notes.push("same_market_family");
  }
  if (oppositeHint) {
    score += 1.4;
    notes.push("opposite_signal_hint");
  }
  if (oppositeStructuredHint) {
    score += 1.8;
    notes.push("opposite_structured_hint");
  }
  if (timeGapMinutes <= 30) {
    score += 1.5;
    notes.push("tight_time_gap");
  } else if (timeGapMinutes <= 120) {
    score += 0.7;
    notes.push("medium_time_gap");
  }

  if (eventGapHours !== null && eventGapHours <= 24) {
    score += 0.8;
    notes.push("tight_event_gap");
  }

  return {
    timeGapMinutes,
    eventGapHours,
    sameCategory,
    sameMatchupKey,
    sameEventDay,
    sameMarketFamily,
    oppositeHint,
    score,
    notes,
  };
}

function main() {
  const leftPath = process.argv[2];
  const rightPath = process.argv[3];
  const outputPath = process.argv[4];
  const minScore = Number(process.argv[5] || 3);

  if (!leftPath || !rightPath || !outputPath) {
    console.error(
      "Usage: node detect_hedge_candidates.js <left-json> <right-json> <output-json> [min-score]"
    );
    process.exit(1);
  }

  const leftPayload = readJson(leftPath);
  const rightPayload = readJson(rightPath);
  const leftRows = leftPayload.rows || [];
  const rightRows = rightPayload.rows || [];
  const candidates = [];

  for (let i = 0; i < leftRows.length; i += 1) {
    for (let j = 0; j < rightRows.length; j += 1) {
      const result = scorePair(leftRows[i], rightRows[j]);
      if (!result || result.score < minScore) continue;
      candidates.push({
        pair_id: `${leftRows[i].platform || "left"}-${i}__${rightRows[j].platform || "right"}-${j}`,
        platform_a: leftRows[i].platform || "unknown",
        platform_b: rightRows[j].platform || "unknown",
        record_a_index: i,
        record_b_index: j,
        time_gap_minutes: result.timeGapMinutes,
        event_gap_hours: result.eventGapHours,
        match_score: result.score,
        same_category: result.sameCategory,
        same_matchup_key: result.sameMatchupKey,
        same_event_day: result.sameEventDay,
        same_market_family: result.sameMarketFamily,
        opposite_signal_hint: result.oppositeHint,
        record_a: leftRows[i],
        record_b: rightRows[j],
        notes: result.notes,
      });
    }
  }

  candidates.sort((a, b) => b.match_score - a.match_score || a.time_gap_minutes - b.time_gap_minutes);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outputPath),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        left_input: path.resolve(leftPath),
        right_input: path.resolve(rightPath),
        min_score: minScore,
        row_count: candidates.length,
        rows: candidates,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        outputPath: path.resolve(outputPath),
        rowCount: candidates.length,
        minScore: minScore,
        topPreview: candidates.slice(0, 5).map((item) => ({
          pair_id: item.pair_id,
          match_score: item.match_score,
          time_gap_minutes: item.time_gap_minutes,
          notes: item.notes,
        })),
      },
      null,
      2
    )
  );
}

main();
