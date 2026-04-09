import path from "path";
import { imageToColors } from "./index";
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  rgbDistance,
  colorDiffPercent,
  contrastRatio,
  LIGHT_TEXT,
  DARK_TEXT,
  relativeLuminance,
} from "./colorUtils";

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

const TOLERANCE = 5; // 5% tolerance

async function validate() {
  let passed = 0;
  let total = examples.length;

  for (const ex of examples) {
    const imgPath = path.resolve(__dirname, "../examples", ex.image);
    try {
      const result = await imageToColors(imgPath);

      const lightPredRgb = hexToRgb(result.light);
      const darkPredRgb = hexToRgb(result.dark);
      const lightTargetRgb = hexToRgb(ex.lightTarget);
      const darkTargetRgb = hexToRgb(ex.darkTarget);

      const lightDiff = colorDiffPercent(lightPredRgb, lightTargetRgb);
      const darkDiff = colorDiffPercent(darkPredRgb, darkTargetRgb);

      const lightOk = lightDiff <= TOLERANCE;
      const darkOk = darkDiff <= TOLERANCE;
      const ok = lightOk && darkOk;
      if (ok) passed++;

      // Contrast checks
      const lightContrast = contrastRatio(lightPredRgb, LIGHT_TEXT);
      const darkContrast = contrastRatio(darkPredRgb, DARK_TEXT);

      console.log(
        `Example ${ex.id}: ${ok ? "PASS ✓" : "FAIL ✗"}` +
          `\n  Light: ${result.light} (target: ${ex.lightTarget})` +
          `  diff=${lightDiff.toFixed(1)}%  ${lightOk ? "✓" : "✗"}` +
          `  contrast=${lightContrast.toFixed(1)}:1` +
          `\n  Dark:  ${result.dark} (target: ${ex.darkTarget})` +
          `  diff=${darkDiff.toFixed(1)}%  ${darkOk ? "✓" : "✗"}` +
          `  contrast=${darkContrast.toFixed(1)}:1` +
          `\n  Light HSL pred: ${JSON.stringify(rgbToHsl(lightPredRgb))}` +
          `\n  Light HSL targ: ${JSON.stringify(rgbToHsl(lightTargetRgb))}` +
          `\n  Dark HSL pred:  ${JSON.stringify(rgbToHsl(darkPredRgb))}` +
          `\n  Dark HSL targ:  ${JSON.stringify(rgbToHsl(darkTargetRgb))}` +
          "\n"
      );
    } catch (err) {
      console.log(`Example ${ex.id}: ERROR - ${err}`);
    }
  }

  console.log(`\n=== Results: ${passed}/${total} passed (${(passed / total * 100).toFixed(0)}%) ===`);
  console.log(`Target: 80% (${Math.ceil(total * 0.8)}/${total})`);
}

validate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
