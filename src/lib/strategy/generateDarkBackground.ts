import { ImageAnalysis } from "../analysis/types";
import { hslToRgb, rgbToHex } from "../color/conversion";
import { contrastRatio } from "../color/contrast";
import { findMinimumLightness, ensureDarkContrast } from "../color/chromaSolvers";
import { clamp } from "../util/math";
import { ThemeColors } from "../imageToColors";
import { GenerationContext } from "./context";

/**
 * Generate theme colors for dark images with a bright accent element.
 *
 * Light theme amplifies the accent: small vivid accents get max S, large
 * colored areas get moderate S. Dark theme uses the dominant dark hue.
 */
export function generateDarkBackground(
  analysis: ImageAnalysis,
  ctx: GenerationContext
): ThemeColors {
  let lightHue: number, lightSaturation: number, lightLightness: number;

  if (analysis.accentStrength > 0.001 && analysis.accentSaturation > 15) {
    lightHue = analysis.accentHue;
    lightSaturation = analysis.accentStrength > 0.05
      ? clamp(analysis.accentSaturation * 0.6, 15, 80) // large accent → subtle
      : 100; // small accent → amplify
    lightLightness = 85;
    if (contrastRatio(hslToRgb({ h: lightHue, s: lightSaturation, l: lightLightness }), ctx.lightText) < 7.0) {
      lightLightness = clamp(findMinimumLightness(lightHue, lightSaturation, ctx.lightText, 7.0), 75, 97);
    }
  } else {
    lightHue = analysis.dominantHue;
    lightSaturation = clamp(analysis.dominantSaturation * 0.5, 10, 40);
    lightLightness = clamp(findMinimumLightness(lightHue, lightSaturation, ctx.lightText, 9.5), 75, 97);
  }

  const darkSaturation = clamp(analysis.dominantSaturation * 1.5, 20, 100);
  const darkLightness = clamp(14 - analysis.dominantSaturation * 0.07, 6, 12);
  const dark = ensureDarkContrast(
    { h: analysis.dominantHue, s: darkSaturation, l: darkLightness },
    ctx.darkText
  );

  return {
    light: rgbToHex(hslToRgb({ h: lightHue, s: lightSaturation, l: lightLightness })),
    dark: rgbToHex(hslToRgb(dark)),
  };
}
