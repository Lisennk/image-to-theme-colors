import { ImageAnalysis } from "../analysis/types";
import { hslToRgb, rgbToHex } from "../color/conversion";
import { findMinimumLightness, ensureDarkContrast } from "../color/chromaSolvers";
import { clamp } from "../util/math";
import { ThemeColors } from "../imageToColors";
import { GenerationContext } from "./context";

/**
 * Generate theme colors for images with a bright background (median L > 70%).
 *
 * Light theme: the background's subtle tint.
 * Dark theme: cool backgrounds darken the bottom-edge hue; warm backgrounds
 * use the accent color.
 */
export function generateLightBackground(
  analysis: ImageAnalysis,
  ctx: GenerationContext
): ThemeColors {
  // If the background is essentially pure white (S < 3), the image is visually
  // achromatic despite possible color noise in dark pixels from compression.
  // Use neutral colors rather than picking up artifacts.
  if (analysis.backgroundSaturation < 3) {
    return { light: "#FFFFFF", dark: "#2A2925" };
  }

  const lightHue = analysis.backgroundHue;
  const lightSaturation = clamp(analysis.backgroundSaturation, 10, 50);
  const lightLightness = clamp(
    findMinimumLightness(lightHue, lightSaturation, ctx.lightText, 12.0), 85, 97
  );

  let darkHue: number, darkSaturation: number, darkLightness: number;
  const backgroundIsCool = analysis.backgroundHue >= 180 && analysis.backgroundHue <= 300;

  if (analysis.backgroundSaturation >= 3 && backgroundIsCool) {
    darkHue = analysis.bottomHue;
    darkSaturation = clamp(analysis.bottomSaturation * 1.2, 15, 50);
    darkLightness = 20;
  } else if (analysis.accentStrength > 0.01 && analysis.accentSaturation > 15) {
    darkHue = analysis.accentHue;
    darkSaturation = clamp(analysis.accentSaturation * 1.8, 25, 70);
    darkLightness = 18;
  } else if (analysis.backgroundSaturation >= 3) {
    darkHue = analysis.backgroundHue;
    darkSaturation = clamp(analysis.backgroundSaturation * 1.5, 15, 50);
    darkLightness = 18;
  } else {
    darkHue = analysis.darkRegionHue;
    darkSaturation = clamp(analysis.darkRegionSaturation, 15, 50);
    darkLightness = 18;
  }
  const dark = ensureDarkContrast({ h: darkHue, s: darkSaturation, l: darkLightness }, ctx.darkText);

  return {
    light: rgbToHex(hslToRgb({ h: lightHue, s: lightSaturation, l: lightLightness })),
    dark: rgbToHex(hslToRgb(dark)),
  };
}
