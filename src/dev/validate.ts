import path from "path";
import { imageToColors } from "../lib";
import { hexToRgb, rgbToHsl } from "../lib/color/conversion";
import { contrastRatio } from "../lib/color/contrast";
import { LIGHT_THEME_TEXT as LIGHT_TEXT, DARK_THEME_TEXT as DARK_TEXT } from "../lib/color/contrast";
import { colorDiffPercent } from "./colorUtils";

interface Example {
  id: number;
  image: string;
  lightTarget: string;
  darkTarget: string;
}

const examples: Example[] = [
  { id: 1, image: "1.png", lightTarget: "#FFFFFF", darkTarget: "#2A2925" },
  { id: 2, image: "2.jpg", lightTarget: "#D3D7A6", darkTarget: "#282B00" },
  { id: 3, image: "3.jpg", lightTarget: "#BFD0FF", darkTarget: "#0E1B3D" },
  { id: 4, image: "4.png", lightTarget: "#9ADCEE", darkTarget: "#012E3B" },
  { id: 5, image: "5.jpg", lightTarget: "#F3F0E9", darkTarget: "#0F2C46" },
  { id: 6, image: "6.jpg", lightTarget: "#CEDEE9", darkTarget: "#0B1E2C" },
  { id: 7, image: "7.jpg", lightTarget: "#E5E5EF", darkTarget: "#312947" },
  { id: 8, image: "8.jpg", lightTarget: "#FFF1BB", darkTarget: "#001020" },
  { id: 9, image: "9.jpg", lightTarget: "#DFDECA", darkTarget: "#231918" },
  { id: 10, image: "10.jpg", lightTarget: "#E8DAD3", darkTarget: "#182C23" },
];

const TOLERANCE = 5;

function bar(pct: number, width = 20): string {
  const filled = Math.round((Math.min(pct, 10) / 10) * width);
  const ch = pct <= TOLERANCE ? "█" : "░";
  return ch.repeat(filled) + "·".repeat(width - filled);
}

async function validate() {
  let passed = 0;
  const total = examples.length;
  const allDiffs: number[] = [];
  const rows: string[] = [];

  for (const ex of examples) {
    const imgPath = path.resolve(__dirname, "../../examples", ex.image);
    try {
      const result = await imageToColors(imgPath);
      const lightHex = result.themes.light.body.background.baseColor;
      const darkHex = result.themes.dark.body.background.baseColor;

      const lp = hexToRgb(lightHex), lt = hexToRgb(ex.lightTarget);
      const dp = hexToRgb(darkHex), dt = hexToRgb(ex.darkTarget);

      const ld = colorDiffPercent(lp, lt);
      const dd = colorDiffPercent(dp, dt);
      allDiffs.push(ld, dd);

      const lok = ld <= TOLERANCE, dok = dd <= TOLERANCE;
      const ok = lok && dok;
      if (ok) passed++;

      const lc = contrastRatio(lp, LIGHT_TEXT);
      const dc = contrastRatio(dp, DARK_TEXT);
      const lcOk = lc >= 7.0, dcOk = dc >= 7.0;

      rows.push(
        `${ok ? "✓" : "✗"} Ex ${String(ex.id).padStart(2)}  ` +
        `L ${lightHex} ${ld.toFixed(1).padStart(5)}% |${bar(ld)}| ${lok ? "✓" : "✗"}  ` +
        `D ${darkHex} ${dd.toFixed(1).padStart(5)}% |${bar(dd)}| ${dok ? "✓" : "✗"}  ` +
        `AAA:${lcOk ? "✓" : "✗"}${dcOk ? "✓" : "✗"}`
      );
    } catch (err) {
      rows.push(`✗ Ex ${String(ex.id).padStart(2)}  ERROR: ${err}`);
    }
  }

  // Header
  console.log(
    `  ${"".padStart(6)}  ` +
    `${"Light".padStart(8)} ${"diff".padStart(6)}  ${"".padStart(22)}     ` +
    `${"Dark".padStart(9)} ${"diff".padStart(6)}  ${"".padStart(22)}`
  );
  console.log("─".repeat(110));
  for (const r of rows) console.log(r);
  console.log("─".repeat(110));

  // Summary
  const avgDiff = allDiffs.reduce((a, b) => a + b, 0) / allDiffs.length;
  const maxDiff = Math.max(...allDiffs);
  const lightDiffs = allDiffs.filter((_, i) => i % 2 === 0);
  const darkDiffs = allDiffs.filter((_, i) => i % 2 === 1);
  const avgLight = lightDiffs.reduce((a, b) => a + b, 0) / lightDiffs.length;
  const avgDark = darkDiffs.reduce((a, b) => a + b, 0) / darkDiffs.length;

  console.log(`\nPassed: ${passed}/${total} (${(passed / total * 100).toFixed(0)}%)  |  Avg diff: ${avgDiff.toFixed(2)}%  |  Max diff: ${maxDiff.toFixed(1)}%`);
  console.log(`  Light avg: ${avgLight.toFixed(2)}%   Dark avg: ${avgDark.toFixed(2)}%`);

  // Per-example breakdown for worst offenders
  const sorted = allDiffs
    .map((d, i) => ({ ex: Math.floor(i / 2) + 1, theme: i % 2 === 0 ? "L" : "D", diff: d }))
    .sort((a, b) => b.diff - a.diff);
  console.log(`\nWorst diffs:`);
  for (const s of sorted.slice(0, 5)) {
    console.log(`  Ex ${s.ex} ${s.theme}: ${s.diff.toFixed(2)}%`);
  }
}

validate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
