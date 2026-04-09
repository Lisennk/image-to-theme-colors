import { rgbToHsl } from "../color/conversion";
import { clamp, hueDistance, circularWeightedMean, percentile } from "../util/math";
import { PixelData, ImageAnalysis } from "./types";

const HUE_BIN_COUNT = 36; // 10° per bin
const MIN_SATURATION = 3; // pixels below this are treated as achromatic

/**
 * Analyze an array of pixels to extract color properties for theme generation.
 *
 * The analysis extracts:
 * - **Dominant hue** from a border-weighted hue histogram (background-focused)
 * - **Background tint** from the average RGB of very bright pixels
 * - **Accent color** from bright non-dominant pixels (L²-weighted)
 * - **Bottom-edge color** for gradient transition matching
 * - **Dark region** characterization
 */
export function analyzePixels(pixels: PixelData[]): ImageAnalysis {
  const totalPixels = pixels.length;

  // ---- Dominant hue: full image with extra weight for border/background pixels ----
  // Border = bottom 15% strip + left/right 10% edges in bottom half.
  // These are likely background (subjects are centered), so they get a 3x boost.
  const hueHistogram = new Float64Array(HUE_BIN_COUNT);
  for (const px of pixels) {
    if (px.s < MIN_SATURATION) continue;
    const isBorderPixel =
      px.row >= 0.85 ||
      (px.row >= 0.5 && (px.col < 0.1 || px.col > 0.9));
    const weight = (1 + px.row) * (isBorderPixel ? 3 : 1);
    hueHistogram[Math.floor(px.h / 10) % HUE_BIN_COUNT] += weight;
  }

  // Find the peak using a 3-bin sliding window (handles bin-boundary colors)
  let maxBinWeight = 0;
  let bestBinIndex = 0;
  for (let i = 0; i < HUE_BIN_COUNT; i++) {
    const windowWeight =
      hueHistogram[(i - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT] +
      hueHistogram[i] +
      hueHistogram[(i + 1) % HUE_BIN_COUNT];
    if (windowWeight > maxBinWeight) {
      maxBinWeight = windowWeight;
      bestBinIndex = i;
    }
  }
  const dominantBins = [
    (bestBinIndex - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT,
    bestBinIndex,
    (bestBinIndex + 1) % HUE_BIN_COUNT,
  ];
  const dominantHue = circularWeightedMean(
    dominantBins.filter((b) => hueHistogram[b] > 0).map((b) => b * 10 + 5),
    dominantBins.map((b) => hueHistogram[b])
  );

  // Dominant S (25th percentile, capped at 60) and L (median) from pixels near dominant hue
  const nearDominant = pixels.filter(
    (px) => px.s >= MIN_SATURATION && hueDistance(px.h, dominantHue) < 20
  );
  const dominantSaturation = clamp(
    percentile(nearDominant.map((px) => px.s), 0.25), 0, 60
  );
  const dominantLightness = percentile(nearDominant.map((px) => px.l), 0.5);

  // ---- Background tint from average RGB of very bright pixels (L > 90%) ----
  const veryBrightPixels = pixels.filter((px) => px.l > 90);
  let backgroundHue = 0;
  let backgroundSaturation = 0;
  if (veryBrightPixels.length > 20) {
    const avgR = veryBrightPixels.reduce((sum, px) => sum + px.r, 0) / veryBrightPixels.length;
    const avgG = veryBrightPixels.reduce((sum, px) => sum + px.g, 0) / veryBrightPixels.length;
    const avgB = veryBrightPixels.reduce((sum, px) => sum + px.b, 0) / veryBrightPixels.length;
    const avgHsl = rgbToHsl({ r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) });
    backgroundHue = avgHsl.h;
    backgroundSaturation = avgHsl.s;
  }

  // ---- Accent: bright non-dominant pixels, L²-weighted to favor brighter elements ----
  const accentPixels = pixels.filter(
    (px) => px.l > 25 && px.s > 15 && hueDistance(px.h, dominantHue) > 25
  );
  let accentHue = 0;
  let accentSaturation = 0;
  let accentLightness = 50;
  let accentStrength = 0;
  if (accentPixels.length > 15) {
    const weights = accentPixels.map((px) => px.s * px.l * px.l);
    accentHue = circularWeightedMean(accentPixels.map((px) => px.h), weights);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    accentSaturation =
      weights.reduce((sum, w, i) => sum + accentPixels[i].s * w, 0) / totalWeight;
    accentLightness =
      weights.reduce((sum, w, i) => sum + accentPixels[i].l * w, 0) / totalWeight;
    accentStrength = accentPixels.length / totalPixels;
  }

  // ---- Bottom-edge hue (last 10% of rows) — the gradient-to-article transition zone ----
  const bottomEdgePixels = pixels.filter((px) => px.row >= 0.9 && px.s >= MIN_SATURATION);
  let bottomHue = dominantHue;
  let bottomSaturation = dominantSaturation;
  let bottomIsBackground = true;
  if (bottomEdgePixels.length > 10) {
    const satWeights = bottomEdgePixels.map((px) => px.s);
    bottomHue = circularWeightedMean(bottomEdgePixels.map((px) => px.h), satWeights);
    bottomSaturation = clamp(percentile(bottomEdgePixels.map((px) => px.s), 0.25), 0, 60);

    // Distinguish a second background (e.g. green hill below blue sky) from a
    // foreground object that extends to the edge (e.g. hands at the bottom).
    // A true second background is concentrated at the bottom (>80% in the lower 40%).
    if (hueDistance(bottomHue, dominantHue) > 40) {
      const nearBottomHue = pixels.filter(
        (px) => hueDistance(px.h, bottomHue) < 25 && px.s > 10
      );
      const countInLowerRegion = nearBottomHue.filter((px) => px.row >= 0.6).length;
      bottomIsBackground =
        nearBottomHue.length > 0 && countInLowerRegion / nearBottomHue.length > 0.8;
    }
  }

  // ---- Darkest 10% of colored pixels ----
  const sortedByLightness = [...pixels].sort((a, b) => a.l - b.l);
  const darkSampleSize = Math.max(30, Math.floor(totalPixels * 0.1));
  const darkColoredPixels = sortedByLightness
    .slice(0, darkSampleSize)
    .filter((px) => px.s > 5);
  let darkRegionHue = 30;
  let darkRegionSaturation = 5;
  if (darkColoredPixels.length > 10) {
    const satWeights = darkColoredPixels.map((px) => px.s);
    darkRegionHue = circularWeightedMean(darkColoredPixels.map((px) => px.h), satWeights);
    darkRegionSaturation =
      darkColoredPixels.reduce((sum, px) => sum + px.s, 0) / darkColoredPixels.length;
  }

  return {
    dominantHue,
    dominantSaturation,
    dominantLightness,
    bottomHue,
    bottomSaturation,
    bottomIsBackground,
    backgroundHue,
    backgroundSaturation,
    accentHue,
    accentSaturation,
    accentLightness,
    accentStrength,
    darkRegionHue,
    darkRegionSaturation,
    averageSaturation: pixels.reduce((sum, px) => sum + px.s, 0) / totalPixels,
    medianLightness: percentile(pixels.map((px) => px.l), 0.5),
  };
}
