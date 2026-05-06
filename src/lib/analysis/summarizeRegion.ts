import { rgbToHsl } from "../color/conversion";
import { percentile, hueDistance, circularWeightedMean } from "../util/math";
import { PixelData } from "./types";
import { RGB } from "../color/types";

export const HUE_BIN_COUNT = 36;
export const MIN_SATURATION_FOR_HUE = 8;

/**
 * Per-region statistics used by the affirmation color picker.
 * Bundles two histograms (saturation-weighted and count-weighted),
 * the dominant cluster's character, and per-cluster brightness/shadow
 * slices — enough state for the saturation, lightness, and hue
 * selectors to make their independent decisions.
 */
export interface RegionSummary {
  /** Median lightness across the region (0–100). */
  medL: number;
  /** Average saturation across the region (0–100). */
  avgS: number;
  /** HSL of the region's average RGB color (the "blurred" appearance). */
  avgRgbHsl: { h: number; s: number; l: number };
  /** Center hue (deg) of the strongest 3-bin saturation-weighted cluster. */
  dominantHue: number;
  /**
   * Average hue of the cluster's *darker* slice (bottom 30% by L). The
   * shadow regions of a sunset palette skew redder than the highlights —
   * for darker outputs we use this hue instead of the broad cluster mean.
   */
  darkClusterHue: number;
  /** Saturation of the dominant cluster (avg S of pixels within ±15° of peak). */
  dominantClusterS: number;
  /** Lightness of the dominant cluster (S-weighted avg L within ±15°). */
  dominantClusterL: number;
  /** 0–1 — fraction of saturation-weight in the 3-bin dominant-hue window. */
  huePurity: number;
  /** Fraction of pixels with L > 90. */
  whiteFraction: number;
  /** Saturation of the cluster's top 30% by L. */
  clusterTopS: number;
  /** Lightness of the cluster's top 30% by L. */
  clusterTopL: number;
  /**
   * Average S of the cluster's bottom 30% by L — i.e. the saturation of
   * the cluster's *shadow* pixels. For darker outputs in a sunset/shadow
   * palette this is more representative than the full-cluster mean,
   * which is dragged up by bright accent S.
   */
  darkClusterS: number;
  /**
   * Average L of the cluster's bottom 30% by L. When this value is
   * itself high (image 3 TOP: cluster is all bright sunset clouds, no
   * shadow pixels), the per-region cluster doesn't reach a dark value
   * for darker-direction outputs — fall back to the combined summary.
   */
  clusterDarkL: number;
  /**
   * Hue of the largest pixel-count peak in the histogram — i.e. the
   * area-dominant hue, computed without S weighting. When the
   * S-weighted dominant disagrees with the area-dominant (image 13:
   * a small saturated sun outweighs a large desaturated sky), the
   * area peak captures what a viewer reads as "the image's color".
   */
  areaDominantHue: number;
  /** Count-fraction in the area dominant's 3-bin window. */
  areaPurity: number;
}

/** Build a saturation-weighted hue histogram and find its 3-bin peak. */
function hueHistogramPeak(pixels: PixelData[]): {
  peakBin: number;
  histogram: Float64Array;
  total: number;
} {
  const histogram = new Float64Array(HUE_BIN_COUNT);
  let total = 0;
  for (const px of pixels) {
    if (px.s < MIN_SATURATION_FOR_HUE) continue;
    const w = px.s;
    histogram[Math.floor(px.h / 10) % HUE_BIN_COUNT] += w;
    total += w;
  }
  let bestWeight = 0;
  let bestBin = 0;
  for (let i = 0; i < HUE_BIN_COUNT; i++) {
    const window =
      histogram[(i - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT] +
      histogram[i] +
      histogram[(i + 1) % HUE_BIN_COUNT];
    if (window > bestWeight) {
      bestWeight = window;
      bestBin = i;
    }
  }
  return { peakBin: bestBin, histogram, total };
}

/**
 * Summarize a region of pixels into the multi-stat shape used by the
 * affirmation color picker. Computes the saturation-weighted dominant
 * hue cluster (with bright/shadow slices) and the count-weighted
 * "area" peak in a single pass per histogram.
 */
export function summarizeRegion(pixels: PixelData[]): RegionSummary {
  if (pixels.length === 0) {
    return {
      medL: 50, avgS: 0,
      avgRgbHsl: { h: 0, s: 0, l: 50 },
      dominantHue: 0, darkClusterHue: 0,
      dominantClusterS: 0, dominantClusterL: 50,
      huePurity: 0, whiteFraction: 0,
      clusterTopS: 0, clusterTopL: 50, darkClusterS: 0, clusterDarkL: 50,
      areaDominantHue: 0, areaPurity: 0,
    };
  }
  const ls = pixels.map((p) => p.l);
  const ss = pixels.map((p) => p.s);
  const medL = percentile(ls, 0.5);
  const avgS = ss.reduce((a, b) => a + b, 0) / ss.length;
  const whiteFraction = pixels.filter((p) => p.l > 90).length / pixels.length;

  const avgRgb: RGB = {
    r: Math.round(pixels.reduce((a, p) => a + p.r, 0) / pixels.length),
    g: Math.round(pixels.reduce((a, p) => a + p.g, 0) / pixels.length),
    b: Math.round(pixels.reduce((a, p) => a + p.b, 0) / pixels.length),
  };
  const avgRgbHsl = rgbToHsl(avgRgb);

  const { peakBin, histogram, total } = hueHistogramPeak(pixels);
  const peakHue = peakBin * 10 + 5;

  const cluster = pixels.filter(
    (px) => px.s >= MIN_SATURATION_FOR_HUE && hueDistance(px.h, peakHue) < 15
  );
  let dominantHue = peakHue;
  let darkClusterHue = peakHue;
  let dominantClusterS = 0;
  let dominantClusterL = medL;
  let clusterTopS = 0;
  let clusterTopL = medL;
  let darkClusterS = 0;
  let clusterDarkL = medL;
  if (cluster.length > 0) {
    const weights = cluster.map((p) => p.s);
    dominantHue = circularWeightedMean(cluster.map((p) => p.h), weights);
    const wsum = weights.reduce((a, b) => a + b, 0);
    dominantClusterS = weights.reduce((sum, w, i) => sum + cluster[i].s * w, 0) / wsum;
    dominantClusterL = weights.reduce((sum, w, i) => sum + cluster[i].l * w, 0) / wsum;
    const sortedClusterByL = [...cluster].sort((a, b) => a.l - b.l);
    const topStart = Math.floor(sortedClusterByL.length * 0.7);
    const topSubset = sortedClusterByL.slice(topStart);
    if (topSubset.length > 0) {
      clusterTopS = topSubset.reduce((a, p) => a + p.s, 0) / topSubset.length;
      clusterTopL = topSubset.reduce((a, p) => a + p.l, 0) / topSubset.length;
    }
    const darkEnd = Math.max(1, Math.floor(sortedClusterByL.length * 0.3));
    const darkSubset = sortedClusterByL.slice(0, darkEnd);
    const darkWeights = darkSubset.map((p) => p.s);
    darkClusterHue = circularWeightedMean(
      darkSubset.map((p) => p.h),
      darkWeights
    );
    darkClusterS =
      darkSubset.reduce((a, p) => a + p.s, 0) / darkSubset.length;
    clusterDarkL =
      darkSubset.reduce((a, p) => a + p.l, 0) / darkSubset.length;
  }
  const peakWindow =
    histogram[(peakBin - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT] +
    histogram[peakBin] +
    histogram[(peakBin + 1) % HUE_BIN_COUNT];
  const huePurity = total > 0 ? peakWindow / total : 0;

  // ---- Count-weighted (area) histogram ----
  // Each pixel contributes 1, regardless of saturation. Captures which
  // hue *covers more pixels*; useful when a small saturated region
  // (sun, accent) dominates the S-weighted histogram even though the
  // viewer reads a different hue (sky) as "the image's color".
  const areaHist = new Array<number>(HUE_BIN_COUNT).fill(0);
  let areaTotal = 0;
  for (const px of pixels) {
    if (px.s < MIN_SATURATION_FOR_HUE) continue;
    areaHist[Math.floor(px.h / 10) % HUE_BIN_COUNT] += 1;
    areaTotal++;
  }
  let areaBest = 0;
  let areaBestBin = 0;
  for (let i = 0; i < HUE_BIN_COUNT; i++) {
    const win =
      areaHist[(i - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT] +
      areaHist[i] +
      areaHist[(i + 1) % HUE_BIN_COUNT];
    if (win > areaBest) {
      areaBest = win;
      areaBestBin = i;
    }
  }
  // Compute the centered hue of the area peak via circular mean of
  // pixels in the 3-bin window.
  const areaPeakRange = [
    (areaBestBin - 1 + HUE_BIN_COUNT) % HUE_BIN_COUNT,
    areaBestBin,
    (areaBestBin + 1) % HUE_BIN_COUNT,
  ];
  const areaWindowPixels = pixels.filter((p) => {
    if (p.s < MIN_SATURATION_FOR_HUE) return false;
    const bin = Math.floor(p.h / 10) % HUE_BIN_COUNT;
    return areaPeakRange.includes(bin);
  });
  let areaDominantHue = areaBestBin * 10 + 5;
  if (areaWindowPixels.length > 0) {
    areaDominantHue = circularWeightedMean(
      areaWindowPixels.map((p) => p.h),
      areaWindowPixels.map(() => 1)
    );
  }
  const areaPurity = areaTotal > 0 ? areaBest / areaTotal : 0;

  return {
    medL, avgS,
    avgRgbHsl,
    dominantHue, darkClusterHue,
    dominantClusterS, dominantClusterL,
    huePurity, whiteFraction,
    clusterTopS, clusterTopL, darkClusterS, clusterDarkL,
    areaDominantHue, areaPurity,
  };
}
