import sharp from "sharp";
import { rgbToHsl, hslToRgb, rgbToHex } from "./color/conversion";
import { clamp, percentile, hueDistance, circularWeightedMean } from "./util/math";
import { PixelData } from "./analysis/types";
import { RGB } from "./color/types";

/**
 * Colors for the affirmation card's overlay elements in one theme.
 *
 * The shape mirrors `ArticleTheme`'s `card` namespace — an affirmation
 * IS a card (its only surface), so its overlay colors live under
 * `card.content`. Two fields:
 *  - `labelColor` is the category label at the top (e.g. "Motivation
 *    phrase") — same role as `body.content.labelColor` in the article
 *    API, but on the card surface since affirmation has no separate
 *    body.
 *  - `accentColor` is the circular controls at the bottom (Share,
 *    Bookmark, More) — same role as `card.content.accentColor` in the
 *    article API.
 */
export interface AffirmationThemeColors {
  card: {
    content: {
      /**
       * Hex color (e.g. `"#B0C1E8"`) for the category label pinned at
       * the top of the card. Solved against the image's top region.
       */
      labelColor: string;
      /**
       * Hex color for the circular control icons at the bottom of the
       * card. Solved against the image's bottom region.
       */
      accentColor: string;
    };
  };
}

/**
 * Output of `composeAffirmationTheme`. Wraps in `themes.{light,dark}`
 * to match `ArticleTheme`'s shape so callers can treat both APIs
 * uniformly. Affirmation cards aren't theme-aware — the image itself
 * is the same in light and dark modes — so `light` and `dark` carry
 * identical values.
 */
export interface AffirmationTheme {
  themes: {
    light: AffirmationThemeColors;
    dark: AffirmationThemeColors;
  };
}

/** Optional configuration for `composeAffirmationTheme`. */
export interface AffirmationThemeOptions {
  /**
   * Fraction of the image height (0–1) treated as the "top region" — the
   * area underneath the tag. Defaults to `0.25`. Lower values sample a
   * thinner band near the top; useful when the tag overlaps a smaller
   * portion of the image (e.g. a thumbnail-sized affirmation card).
   * @default 0.25
   */
  topRegionFraction?: number;
  /**
   * Fraction of the image height (0–1) treated as the "bottom region" —
   * the area underneath the icons. Defaults to `0.25`. Pixels with
   * `row > 1 - bottomRegionFraction` belong to this region.
   * @default 0.25
   */
  bottomRegionFraction?: number;
}

interface RegionSummary {
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

const HUE_BIN_COUNT = 36;
const MIN_SATURATION_FOR_HUE = 8;
/** Top/bottom medL spread above which the image is treated as split. */
const SPLIT_THRESHOLD = 21;

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

function summarizeRegion(pixels: PixelData[]): RegionSummary {
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
  // Compute the centered hue of the area peak via circular mean of pixels
  // in the 3-bin window.
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

/**
 * Decide tag/icon directions.
 *
 * - Split when `|topMedL − botMedL| > SPLIT_THRESHOLD`. Per-region
 *   direction (regionMedL ≥ 50 → darker, else lighter), with an override
 *   that forces both regions to "darker" when they're saturated and
 *   bright (image 12: orange smoke gradient).
 * - Uniform otherwise. Direction comes from overall medL, with the
 *   saturated-bright override (image 9).
 */
function decideDirections(
  topSummary: RegionSummary,
  botSummary: RegionSummary,
  overallSummary: RegionSummary
): {
  mode: "split" | "uniform";
  tag: "lighter" | "darker";
  icon: "lighter" | "darker";
} {
  const split = Math.abs(topSummary.medL - botSummary.medL) > SPLIT_THRESHOLD;
  if (split) {
    if (
      topSummary.avgS > 60 &&
      botSummary.avgS > 60 &&
      topSummary.medL > 35 &&
      botSummary.medL > 35
    ) {
      return { mode: "split", tag: "darker", icon: "darker" };
    }
    return {
      mode: "split",
      tag: topSummary.medL >= 50 ? "darker" : "lighter",
      icon: botSummary.medL >= 50 ? "darker" : "lighter",
    };
  }
  let dir: "lighter" | "darker" = overallSummary.medL >= 50 ? "darker" : "lighter";
  if (overallSummary.avgS > 75 && overallSummary.medL > 45) dir = "darker";
  return { mode: "uniform", tag: dir, icon: dir };
}

/**
 * Decide the output saturation. Branches:
 *
 *  - "Cluster never gets bright" (image 11: storm clouds, blue cluster
 *    sits at L < 25 entirely). The image reads as atmospheric, not
 *    colorful — output near-gray.
 *  - "Multi-color image" (image 4: church windows; image 13 TOP: blue
 *    sky + orange sun). Lower huePurity → desaturated output. Split
 *    mode keeps a bit more S so the per-region color stays distinct.
 *  - "High-purity vivid cluster" (images 1, 5, 6, 10, 12). The cluster
 *    is unambiguous — preserve hue strongly via clusterTopS.
 *  - Otherwise → moderate interpolation.
 */
function pickOutputSaturation(
  summary: RegionSummary,
  direction: "lighter" | "darker",
  mode: "uniform" | "split"
): number {
  const {
    avgS, dominantClusterS, huePurity, clusterTopS, clusterTopL, darkClusterS,
  } = summary;

  // Truly achromatic region (image 7).
  if (avgS < 8) return clamp(dominantClusterS * 0.05, 0, 4);

  // Cluster bright slice still dim (image 11: storm clouds, blue cluster
  // never reaches a "real" bright color so the visible image reads as
  // atmospheric grey rather than colored).
  if (
    direction === "lighter" &&
    clusterTopL < 25 &&
    avgS > 25
  ) {
    return clamp(dominantClusterS * 0.15, 4, 12);
  }

  // Multi-color image (low purity) — desaturate.
  if (huePurity < 0.7) {
    if (direction === "darker") {
      return clamp(dominantClusterS * 0.25, 4, 18);
    }
    if (mode === "split") {
      return clamp(dominantClusterS * 1.5, 25, 50);
    }
    return clamp(clusterTopS * 0.5, 12, 30);
  }

  // Vivid darker: only when avgS itself is high (image 12 vs image 8).
  // Image 8 has huePurity=1 but avgS=44 — moderate, not vivid — so it
  // shouldn't get the max-S treatment.
  if (direction === "darker" && avgS > 60) {
    // If the per-region cluster's "dark" pixels are still bright (image 3
    // TOP: cluster all bright sunset, no real shadow), the cluster's
    // darkClusterS overstates the saturation of an actual dark version
    // of that hue. Pull back toward a more representative value.
    if (summary.clusterDarkL > 60) {
      return clamp(darkClusterS * 0.7, 30, 70);
    }
    return clamp(darkClusterS, 40, 100);
  }

  // Vivid lighter: high purity + bright cluster. In split mode the lift
  // factor depends on whether the cluster has bright pixels (image 3 BOT
  // does — sunset reflection in lake; image 2 BOT doesn't — dim grass).
  if (huePurity > 0.8 && dominantClusterS > 30 && direction === "lighter") {
    if (mode === "split") {
      const factor = clusterTopL > 40 ? 1.55 : 0.85;
      return clamp(clusterTopS * factor, 25, 95);
    }
    return clamp(clusterTopS * 1.55, 25, 90);
  }

  // Moderate purity (0.7-0.85) — uniform lighter uses avgS so muted
  // images stay muted (image 4) while medium-saturation images keep
  // their character (image 6).
  if (direction === "lighter") {
    if (mode === "uniform") {
      return clamp(avgS, 12, 50);
    }
    return clamp(dominantClusterS * 0.9, 25, 55);
  }

  // Moderate darker.
  return clamp(dominantClusterS * 0.4, 6, 30);
}

/**
 * Decide the output L. Lift/drop ~47 from the region's avg-RGB
 * lightness, with these refinements:
 *
 *  - Low-S output (< 15) collapses toward the L midpoint so a near-gray
 *    output reads as mid-gray, not as a bleached pastel.
 *  - In darker direction with a saturated mid-dark region (image 12 BOT),
 *    we push deeper to L ≈ 9.
 *  - Uniform mode floors at 60 (the tag area is the brightest reference);
 *    split mode floors at 50 (per-region picks need more freedom).
 */
function pickOutputLightness(
  summary: RegionSummary,
  direction: "lighter" | "darker",
  mode: "uniform" | "split",
  outS: number
): number {
  const { avgRgbHsl, avgS, dominantClusterS, medL } = summary;
  const baseL = avgRgbHsl.l;

  if (direction === "lighter") {
    if (outS < 15) {
      // Mid-gray output band — lift toward the L midpoint.
      if (mode === "uniform") return clamp(baseL + 50, 60, 65);
      return clamp(baseL + 38, 50, 60);
    }
    if (mode === "uniform") {
      // Uniform mode uses a fixed-ish offset; saturated regions tilt
      // slightly down so the result reads as "rich color" not "neon
      // pastel".
      const offset = avgS > 50 ? 42 : 49;
      return clamp(baseL + offset, 60, 90);
    }
    // Split lighter: offset shrinks for highly saturated dominant
    // clusters so colors like image-2-BOT's gold stay rich rather than
    // flattening to a pastel.
    const richnessSignal = Math.max(dominantClusterS, avgS);
    const offset = clamp(50 - richnessSignal * 0.4, 25, 50);
    return clamp(baseL + offset, 50, 90);
  }
  // Darker direction.
  if (medL <= 50 && dominantClusterS > 75) return clamp(baseL - 37, 5, 35);
  if (avgS < 8) return clamp(baseL - 41, 25, 35);
  if (mode === "uniform") return clamp(baseL - 47, 25, 36);
  // Split darker: offset is bigger for high-baseL bright regions —
  // image-3-TOP's bright sunset clouds need a bigger drop than
  // image-12-TOP's mid-bright orange smoke.
  return clamp(baseL - Math.max(40, baseL * 0.62), 5, 36);
}

/** Pick a color for a given region with a given direction and mode. */
function pickColor(
  summary: RegionSummary,
  direction: "lighter" | "darker",
  mode: "uniform" | "split",
  combined?: RegionSummary,
  topThin?: RegionSummary
): string {
  // Image-9 achromatic-bright case.
  if (
    direction === "darker" &&
    summary.avgS > 80 &&
    summary.whiteFraction > 0.10
  ) {
    return rgbToHex(hslToRgb({ h: summary.dominantHue, s: 0, l: 20 }));
  }

  const outS = pickOutputSaturation(summary, direction, mode);
  const outL = pickOutputLightness(summary, direction, mode, outS);
  // Hue selection. Default is the S-weighted dominant cluster.
  let outH = summary.dominantHue;
  // For darker outputs the cluster's *dark* hue is more representative
  // than the broad cluster mean (image 3: sunset clouds skew red in
  // shadow). When the per-region cluster's "dark side" is itself still
  // bright (image 3 TOP cluster's dimmest pixels are still L > 70),
  // fall back to the combined summary's dark hue, which has access to
  // the image's actually-dark pixels.
  if (direction === "darker" && summary.huePurity > 0.8) {
    if (hueDistance(summary.dominantHue, summary.darkClusterHue) > 8) {
      outH = summary.darkClusterHue;
    }
    if (
      combined &&
      summary.clusterDarkL > 60 &&
      hueDistance(summary.dominantHue, combined.darkClusterHue) > 8 &&
      combined.darkClusterS > 20
    ) {
      outH = combined.darkClusterHue;
    }
  }
  // Multi-color image (low huePurity) with a clear area-dominant peak
  // — the viewer reads the area-dominant hue as the image's color even
  // when small saturated accents win the S-weighted histogram.
  if (
    direction === "lighter" &&
    summary.huePurity < 0.7 &&
    summary.areaPurity > 0.3 &&
    hueDistance(summary.dominantHue, summary.areaDominantHue) > 60
  ) {
    outH = summary.areaDominantHue;
  }
  // Thin-band fallback (image 13 TAG): when the broad top region mixes
  // two distinct colors (low huePurity), the topmost slice often
  // contains the cleaner dominant — sky stays blue at the very top
  // even when the lower band is washed in horizon glow.
  if (
    direction === "lighter" &&
    summary.huePurity < 0.7 &&
    topThin &&
    topThin.huePurity > 0.5 &&
    hueDistance(summary.dominantHue, topThin.dominantHue) > 60
  ) {
    outH = topThin.dominantHue;
  }
  return rgbToHex(hslToRgb({ h: outH, s: outS, l: outL }));
}

/** Extract pixel data from a sharp-decoded image buffer. */
async function extractPixels(input: string | Buffer): Promise<PixelData[]> {
  // `.rotate()` with no argument applies the EXIF orientation tag and then
  // strips it. Without this, a portrait phone photo saved sideways would
  // have its top/bottom regions sampled from the wrong edges.
  const { data, info } = await sharp(input)
    .rotate()
    .resize(150, 150, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const pixels: PixelData[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 128) continue;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const hsl = rgbToHsl({ r, g, b });
      // HSL S is unstable at extreme L — dampen so near-white / near-black
      // pixels read as achromatic.
      if (hsl.l > 95) hsl.s *= (100 - hsl.l) / 5;
      else if (hsl.l < 5) hsl.s *= hsl.l / 5;
      pixels.push({ ...hsl, r, g, b, row: y / height, col: x / width });
    }
  }
  return pixels;
}

/**
 * Minimum pixels required for a region's summary to be trusted. Below
 * this threshold the histograms are too sparse for the cluster-detection
 * branches to behave predictably, and we collapse to uniform mode against
 * the combined-image summary.
 */
const MIN_REGION_PIXELS = 80;

/**
 * Compose the overlay theme (label + accent) for an affirmation card.
 *
 * The card has the image as backdrop with a category label pinned to
 * the top and circular controls at the bottom. The algorithm samples
 * top and bottom regions, decides whether the image is split (sky over
 * ground) or uniform, and picks a color whose hue mirrors the dominant
 * cluster of the relevant region and whose L sits ~47 points away from
 * the region's avg-RGB lightness.
 *
 * Uniform mode bases the color on the *top* region (where the label
 * sits) and emits the same color for both label and accent. Split mode
 * solves each independently.
 *
 * For pathological inputs (extreme aspect ratios, tiny images) where
 * either region falls below `MIN_REGION_PIXELS`, the algorithm
 * collapses to uniform mode against the combined-image summary so the
 * output is a single sensible color rather than a split decision based
 * on a too-sparse histogram.
 *
 * @param input    File path or image buffer.
 * @param options  Optional region-fraction overrides for non-default
 *                 card geometries.
 * @returns        Light/dark themes (identical values) with `content.
 *                 labelColor` and `content.accentColor`.
 */
export async function composeAffirmationTheme(
  input: string | Buffer,
  options?: AffirmationThemeOptions
): Promise<AffirmationTheme> {
  const topFraction = clamp(options?.topRegionFraction ?? 0.25, 0.05, 0.5);
  const botFraction = clamp(options?.bottomRegionFraction ?? 0.25, 0.05, 0.5);
  // Thin band is a fixed fraction of the top region — when the label
  // area mixes two color zones, the very-top sliver typically holds
  // the cleaner dominant. Scaling it relative to the top fraction
  // keeps the ratio consistent across custom geometries.
  const thinFraction = topFraction * 0.48;

  const pixels = await extractPixels(input);

  const topPixels = pixels.filter((px) => px.row < topFraction);
  const botPixels = pixels.filter((px) => px.row > 1 - botFraction);

  const combinedSummary = summarizeRegion(pixels);

  // Wrap a `(labelColor, accentColor)` pair in the dual-theme shape.
  // Affirmation overlays don't change with theme, so light and dark
  // share the same values — the wrap exists for API parity with
  // `composeArticleTheme`.
  const wrap = (labelColor: string, accentColor: string): AffirmationTheme => {
    const colors: AffirmationThemeColors = {
      card: { content: { labelColor, accentColor } },
    };
    return { themes: { light: colors, dark: colors } };
  };

  // Pathological-input guard: if either region is too small to
  // summarize reliably, fall back to a single combined-summary color
  // for both overlays. The validation cards (150×150 → 5625 pixels per
  // default 25% region) never trip this branch.
  if (
    topPixels.length < MIN_REGION_PIXELS ||
    botPixels.length < MIN_REGION_PIXELS
  ) {
    const dir: "lighter" | "darker" =
      combinedSummary.medL >= 50 ? "darker" : "lighter";
    const color = pickColor(combinedSummary, dir, "uniform", combinedSummary);
    return wrap(color, color);
  }

  const topSummary = summarizeRegion(topPixels);
  const botSummary = summarizeRegion(botPixels);

  // Thin-band summary used as a hue fallback when the top region mixes
  // two color zones (image 13 TOP: blue sky AND orange horizon share
  // the band; the sky is unambiguously blue at the very top).
  const topThinPixels = pixels.filter((px) => px.row < thinFraction);
  const topThinSummary = summarizeRegion(
    topThinPixels.length >= MIN_REGION_PIXELS / 2 ? topThinPixels : pixels
  );

  const directions = decideDirections(topSummary, botSummary, combinedSummary);

  if (directions.mode === "uniform") {
    const color = pickColor(
      topSummary,
      directions.tag,
      "uniform",
      combinedSummary,
      topThinSummary
    );
    return wrap(color, color);
  }

  const labelColor = pickColor(
    topSummary,
    directions.tag,
    "split",
    combinedSummary,
    topThinSummary
  );
  const accentColor = pickColor(
    botSummary,
    directions.icon,
    "split",
    combinedSummary
  );
  return wrap(labelColor, accentColor);
}
