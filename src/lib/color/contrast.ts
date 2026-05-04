import { RGB } from "./types";
import { hexToRgb } from "./conversion";

/**
 * Linearize an sRGB channel value (0–255) for luminance calculation.
 * Per WCAG 2.1 relative luminance definition.
 */
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Compute WCAG 2.1 relative luminance of an RGB color (0–1 range). */
export function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

/** Compute the WCAG contrast ratio between two RGB colors (always >= 1). */
export function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Normal text color for the light theme. */
export const LIGHT_THEME_TEXT = hexToRgb("#2A2925");

/** Normal text color for the dark theme. */
export const DARK_THEME_TEXT = hexToRgb("#FFFFFF");

/** Default feed (page) background behind a card on the light theme. */
export const LIGHT_FEED_BG = hexToRgb("#F0F0F0");

/** Default feed (page) background behind a card on the dark theme. */
export const DARK_FEED_BG = hexToRgb("#110F0E");
