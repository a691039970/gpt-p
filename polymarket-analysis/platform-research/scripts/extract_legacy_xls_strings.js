const fs = require("fs");
const path = require("path");

function extractUtf16Strings(buffer, minLen = 4) {
  const results = [];
  for (let i = 0; i < buffer.length - 2; i += 1) {
    const chars = [];
    let j = i;
    while (j + 1 < buffer.length) {
      const code = buffer.readUInt16LE(j);
      if (code >= 32 && code <= 126) {
        chars.push(String.fromCharCode(code));
        j += 2;
        continue;
      }
      break;
    }

    if (chars.length >= minLen) {
      results.push(chars.join("").trim());
      i = j;
    }
  }
  return results;
}

function normalizeLine(line) {
  return String(line || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStagingRecords(lines) {
  const records = [];
  let current = null;

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    if (/^\d{10}$/.test(line)) {
      if (current) records.push(current);
      current = {
        source_bet_id: line,
        timestamp_raw: null,
        extracted_lines: [],
        odds_raw: null,
        stake_raw: null,
        payout_raw: null,
      };
      continue;
    }

    if (!current) continue;

    current.extracted_lines.push(line);

    if (!current.timestamp_raw && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(line)) {
      current.timestamp_raw = line.slice(0, 19);
      continue;
    }

    if (!current.odds_raw && /^\d+\.\d+\s*$/.test(line)) {
      current.odds_raw = line.trim();
      continue;
    }

    if (!current.stake_raw && /^:\s*\d+(\.\d+)?$/.test(line)) {
      current.stake_raw = line.replace(/^:\s*/, "");
      continue;
    }

    if (!current.payout_raw && /^\(\d+(\.\d+)?\)!?$/.test(line)) {
      current.payout_raw = line.replace(/[()!]/g, "");
    }
  }

  if (current) records.push(current);
  return records;
}

function main() {
  const inputPath = process.argv[2];
  const outputDir = process.argv[3];

  if (!inputPath || !outputDir) {
    console.error("Usage: node extract_legacy_xls_strings.js <input-xls> <output-dir>");
    process.exit(1);
  }

  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputDir);
  fs.mkdirSync(absoluteOutput, { recursive: true });

  const buffer = fs.readFileSync(absoluteInput);
  const utf16Lines = extractUtf16Strings(buffer, 4);
  const cleanedLines = utf16Lines.map(normalizeLine).filter(Boolean);
  const records = buildStagingRecords(cleanedLines);

  const baseName = path.parse(absoluteInput).name;
  const textPath = path.join(absoluteOutput, `${baseName}.strings.txt`);
  const jsonPath = path.join(absoluteOutput, `${baseName}.staging.json`);

  fs.writeFileSync(textPath, cleanedLines.join("\n"), "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        source_file: absoluteInput,
        extracted_at: new Date().toISOString(),
        record_count: records.length,
        records,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ textPath, jsonPath, recordCount: records.length }, null, 2));
}

main();
