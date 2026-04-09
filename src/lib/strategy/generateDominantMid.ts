import { ImageAnalysis } from "../analysis/types";
import { hslToRgb, rgbToHex } from "../color/conversion";
import { solveLightThemeSL, ensureDarkContrast } from "../color/chromaSolvers";
import { hueDistance, clamp } from "../util/math";
import { ThemeColors } from "../imageToColors";
import { GenerationContext } from "./context";

/**
 * Generate theme colors from a mid-tone dominant color.
 *
 * Single-hue images: both themes use the dominant hue.
 * Multi-hue images (bottom differs and is a real background): accent for
 * light theme, bottom-edge color for dark theme.
 */
export function generateDominantMid(
  analysis: ImageAnalysis,
  ctx: GenerationContext
): ThemeColors {
  const bottomHueDiverges =
    hueDistance(analysis.bottomHue, analysis.dominantHue) > 40 &&
    analysis.bottomIsBackground;

  let lightHue: number;
  let lightOrigS: number;
  let lightOrigL: number;
  if (bottomHueDiverges && analysis.accentStrength > 0.01 && analysis.accentSaturation > 10) {
    lightHue = analysis.accentHue;
    lightOrigS = analysis.accentSaturation;
    lightOrigL = analysis.accentLightness;
  } else {
    lightHue = analysis.dominantHue;
    lightOrigS = analysis.dominantSaturation;
    lightOrigL = analysis.dominantLightness;
  }
  const { saturation: lightS, lightness: lightL } =
    solveLightThemeSL(lightHue, lightOrigS, lightOrigL, 9.5, ctx.lightText);

  const darkHue = bottomHueDiverges ? analysis.bottomHue : analysis.dominantHue;
  const darkBaseS = bottomHueDiverges ? analysis.bottomSaturation : analysis.dominantSaturation;
  const darkS = clamp(darkBaseS * 1.5, 25, 100);
  const dark = ensureDarkContrast({ h: darkHue, s: darkS, l: 12 }, ctx.darkText);

  return {
    light: rgbToHex(hslToRgb({ h: lightHue, s: lightS, l: lightL })),
    dark: rgbToHex(hslToRgb(dark)),
  };
}
