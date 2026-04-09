import { RGB, HSL } from "./types";
import { hslToRgb } from "./conversion";
import { contrastRatio } from "./contrast";
import { clamp } from "../util/math";

/**
 * Binary-search for the minimum HSL lightness (>= 50%) at which the
 * background achieves at least `targetRatio` contrast with `textColor`.
 */
export function findMinimumLightness(
  hue: number,
  saturation: number,
  textColor: RGB,
  targetRatio: number
): number {
  let lo = 50;
  let hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(hslToRgb({ h: hue, s: saturation, l: mid }), textColor) >= targetRatio) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}

/**
 * Iteratively decrease lightness until the color meets AAA contrast (7:1)
 * against the given text color. Returns the adjusted HSL.
 */
export function ensureDarkContrast(hsl: HSL, darkText: RGB): HSL {
  let adjusted = { ...hsl };
  for (let i = 0; i < 120; i++) {
    if (contrastRatio(hslToRgb(adjusted), darkText) >= 7.0) return adjusted;
    adjusted = { ...adjusted, l: adjusted.l - 0.5 };
  }
  return adjusted;
}

/**
 * Recalculate saturation to maintain perceptual chroma when changing lightness.
 *
 * HSL chroma ≈ S * (1 − |2L − 1|). Given the original (S, L) and a new L,
 * this solves for the S that preserves the same chroma at the new lightness.
 */
export function preserveChroma(
  originalSaturation: number,
  originalLightness: number,
  newLightness: number
): number {
  const chroma =
    (originalSaturation / 100) *
    (1 - Math.abs((2 * originalLightness) / 100 - 1));
  const rangeAtNewL = 1 - Math.abs((2 * newLightness) / 100 - 1);
  if (rangeAtNewL < 0.01) return 0;
  return clamp((chroma / rangeAtNewL) * 100, 0, 100);
}

/**
 * Jointly solve for saturation and lightness for a light-theme background.
 *
 * S and L are interdependent: chroma preservation sets S based on L, but the
 * minimum-contrast L depends on S. This iterates until convergence.
 */
export function solveLightThemeSL(
  hue: number,
  originalSaturation: number,
  originalLightness: number,
  targetContrastRatio: number,
  lightText: RGB
): { saturation: number; lightness: number } {
  let s = originalSaturation;
  let l = 85;
  for (let i = 0; i < 15; i++) {
    l = clamp(findMinimumLightness(hue, s, lightText, targetContrastRatio), 70, 97);
    const newS = clamp(preserveChroma(originalSaturation, originalLightness, l), 15, 100);
    if (Math.abs(newS - s) < 0.5) break;
    s = newS;
  }
  return { saturation: s, lightness: l };
}
