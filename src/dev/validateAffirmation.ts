/**
 * Validate `composeAffirmationTheme` against the 13 reference affirmation
 * images in examples/affirmations/source. Reports per-example deltas for
 * the label and accent colors, plus an overall pass rate at the 5% tolerance.
 *
 * Run with: npm run dev:validate-affirmation
 */
import path from "path";
import fs from "fs";
import { composeAffirmationTheme } from "../lib";
import { hexToRgb, rgbToHsl } from "../lib/color/conversion";
import { colorDiffPercent } from "./colorUtils";

interface Example {
  id: string;
  expectedTag: string;
  expectedIcons: string;
}

const examples: Example[] = [
  { id: "1",  expectedTag: "#B0C1E8", expectedIcons: "#B0C1E8" },
  { id: "2",  expectedTag: "#45443A", expectedIcons: "#B3904C" },
  { id: "3",  expectedTag: "#672825", expectedIcons: "#FAC5C3" },
  { id: "4",  expectedTag: "#ECEBDF", expectedIcons: "#ECEBDF" },
  { id: "5",  expectedTag: "#F4E6D7", expectedIcons: "#F4E6D7" },
  { id: "6",  expectedTag: "#ABCBC4", expectedIcons: "#ABCBC4" },
  { id: "7",  expectedTag: "#50504D", expectedIcons: "#50504D" },
  { id: "8",  expectedTag: "#6B624F", expectedIcons: "#6B624F" },
  { id: "9",  expectedTag: "#333333", expectedIcons: "#333333" },
  { id: "10", expectedTag: "#EBD376", expectedIcons: "#EBD376" },
  { id: "11", expectedTag: "#9199A1", expectedIcons: "#9199A1" },
  { id: "12", expectedTag: "#7E5300", expectedIcons: "#301B00" },
  { id: "13", expectedTag: "#DCE2F0", expectedIcons: "#798086" },
];

const TOLERANCE = 5;

function bar(pct: number, width = 20): string {
  const filled = Math.round((Math.min(pct, 10) / 10) * width);
  const ch = pct <= TOLERANCE ? "█" : "░";
  return ch.repeat(filled) + "·".repeat(width - filled);
}

function fmtHsl(hex: string): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return `(${hsl.h.toFixed(0).padStart(3)}, ${hsl.s.toFixed(0).padStart(3)}, ${hsl.l.toFixed(0).padStart(3)})`;
}

async function validate(): Promise<void> {
  let passed = 0;
  const total = examples.length;
  const allDiffs: number[] = [];
  const rows: string[] = [];

  const sourceDir = path.resolve(__dirname, "../../examples/affirmations/source");

  for (const ex of examples) {
    const candidates = [`${ex.id}.png`, `${ex.id}.jpg`].map((f) =>
      path.join(sourceDir, f)
    );
    const imgPath = candidates.find((p) => fs.existsSync(p));
    if (!imgPath) {
      rows.push(`✗ Ex ${ex.id.padStart(2)}  NOT FOUND`);
      continue;
    }
    try {
      const result = await composeAffirmationTheme(imgPath);
      const labelHex = result.themes.light.card.content.labelColor;
      const accentHex = result.themes.light.card.content.accentColor;
      const tagDiff = colorDiffPercent(
        hexToRgb(labelHex),
        hexToRgb(ex.expectedTag)
      );
      const iconDiff = colorDiffPercent(
        hexToRgb(accentHex),
        hexToRgb(ex.expectedIcons)
      );
      allDiffs.push(tagDiff, iconDiff);

      const tagOk = tagDiff <= TOLERANCE;
      const iconOk = iconDiff <= TOLERANCE;
      const ok = tagOk && iconOk;
      if (ok) passed++;

      rows.push(
        `${ok ? "✓" : "✗"} Ex ${ex.id.padStart(2)}  ` +
          `TAG ${labelHex} ${fmtHsl(labelHex)} vs ${ex.expectedTag} ${fmtHsl(ex.expectedTag)} ${tagDiff.toFixed(1).padStart(5)}% |${bar(tagDiff)}| ${tagOk ? "✓" : "✗"}  ` +
          `ICN ${accentHex} ${fmtHsl(accentHex)} vs ${ex.expectedIcons} ${fmtHsl(ex.expectedIcons)} ${iconDiff.toFixed(1).padStart(5)}% |${bar(iconDiff)}| ${iconOk ? "✓" : "✗"}`
      );
    } catch (err) {
      rows.push(`✗ Ex ${ex.id.padStart(2)}  ERROR: ${(err as Error).message}`);
    }
  }

  console.log("─".repeat(160));
  for (const r of rows) console.log(r);
  console.log("─".repeat(160));

  const avgDiff = allDiffs.reduce((a, b) => a + b, 0) / allDiffs.length;
  const maxDiff = Math.max(...allDiffs);
  const tagDiffs = allDiffs.filter((_, i) => i % 2 === 0);
  const iconDiffs = allDiffs.filter((_, i) => i % 2 === 1);
  const avgTag = tagDiffs.reduce((a, b) => a + b, 0) / tagDiffs.length;
  const avgIcon = iconDiffs.reduce((a, b) => a + b, 0) / iconDiffs.length;

  console.log(
    `\nPassed: ${passed}/${total} (${((passed / total) * 100).toFixed(0)}%)  |  ` +
      `Avg diff: ${avgDiff.toFixed(2)}%  |  Max diff: ${maxDiff.toFixed(1)}%`
  );
  console.log(`  Tag avg: ${avgTag.toFixed(2)}%   Icon avg: ${avgIcon.toFixed(2)}%`);

  const sorted = allDiffs
    .map((d, i) => ({
      ex: examples[Math.floor(i / 2)].id,
      kind: i % 2 === 0 ? "TAG" : "ICN",
      diff: d,
    }))
    .sort((a, b) => b.diff - a.diff);
  console.log(`\nWorst diffs:`);
  for (const s of sorted.slice(0, 6)) {
    console.log(`  Ex ${s.ex.padStart(2)} ${s.kind}: ${s.diff.toFixed(2)}%`);
  }
}

validate()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
