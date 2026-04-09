// Compatibility shim for v1.ts and v2.ts — re-exports from the new lib structure.
export { RGB, HSL } from "../lib/color/types";
export { rgbToHsl, hslToRgb, rgbToHex, hexToRgb } from "../lib/color/conversion";
export { contrastRatio, relativeLuminance } from "../lib/color/contrast";
export { LIGHT_THEME_TEXT as LIGHT_TEXT, DARK_THEME_TEXT as DARK_TEXT } from "../lib/color/contrast";

// Validation-only utilities
export { rgbToHsl as _rgbToHsl } from "../lib/color/conversion";

export function rgbDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function colorDiffPercent(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return (rgbDistance(a, b) / Math.sqrt(3 * 255 * 255)) * 100;
}
