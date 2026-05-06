import { hslToRgb, rgbToHex } from "../../color/conversion";
import { clamp, hueDistance } from "../../util/math";
import { RegionSummary } from "../../analysis/summarizeRegion";
import { AffirmationDirection } from "./decideDirections";

export type PickMode = "uniform" | "split";

/**
 * Decide the output saturation for one region in one direction.
 *
 * Branches:
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
  direction: AffirmationDirection,
  mode: PickMode
): number {
  const {
    avgS,
    dominantClusterS,
    huePurity,
    clusterTopS,
    clusterTopL,
    darkClusterS,
  } = summary;

  // Truly achromatic region (image 7).
  if (avgS < 8) return clamp(dominantClusterS * 0.05, 0, 4);

  // Cluster bright slice still dim (image 11: storm clouds, blue
  // cluster never reaches a "real" bright color so the visible image
  // reads as atmospheric grey rather than colored).
  if (direction === "lighter" && clusterTopL < 25 && avgS > 25) {
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
    // If the per-region cluster's "dark" pixels are still bright
    // (image 3 TOP: cluster all bright sunset, no real shadow), the
    // cluster's darkClusterS overstates the saturation of an actual
    // dark version of that hue. Pull back toward a representative
    // value.
    if (summary.clusterDarkL > 60) {
      return clamp(darkClusterS * 0.7, 30, 70);
    }
    return clamp(darkClusterS, 40, 100);
  }

  // Vivid lighter: high purity + bright cluster. In split mode the
  // lift factor depends on whether the cluster has bright pixels
  // (image 3 BOT does — sunset reflection in lake; image 2 BOT
  // doesn't — dim grass).
  if (huePurity > 0.8 && dominantClusterS > 30 && direction === "lighter") {
    if (mode === "split") {
      const factor = clusterTopL > 40 ? 1.55 : 0.85;
      return clamp(clusterTopS * factor, 25, 95);
    }
    return clamp(clusterTopS * 1.55, 25, 90);
  }

  // Moderate purity (0.7–0.85) — uniform lighter uses avgS so muted
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
 *  - Low-S output (< 15) collapses toward the L midpoint so a
 *    near-gray output reads as mid-gray, not as a bleached pastel.
 *  - In darker direction with a saturated mid-dark region (image 12
 *    BOT), we push deeper to L ≈ 9.
 *  - Uniform mode floors at 60 (the tag area is the brightest
 *    reference); split mode floors at 50 (per-region picks need more
 *    freedom).
 */
function pickOutputLightness(
  summary: RegionSummary,
  direction: AffirmationDirection,
  mode: PickMode,
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
    // clusters so colors like image-2-BOT's gold stay rich rather
    // than flattening to a pastel.
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

/**
 * Optional context for the hue selector. The combined-image summary
 * helps when the per-region cluster is too narrow (image 3 TOP: cluster
 * is all bright sunset, no shadow); the thin-band summary helps when
 * the top region mixes two colors and the very-top sliver holds a
 * cleaner dominant (image 13 TOP: blue sky + orange horizon).
 */
export interface PickColorContext {
  combined?: RegionSummary;
  topThin?: RegionSummary;
}

/**
 * Pick a color for a region, given a direction and mode.
 *
 * Composes the saturation, lightness, and hue selectors. The achromatic
 * special case (vivid bright field with white speckles — image 9)
 * short-circuits to a desaturated dark grey before the per-component
 * solvers run, since the rest of the pipeline assumes hue continuity.
 */
export function pickColor(
  summary: RegionSummary,
  direction: AffirmationDirection,
  mode: PickMode,
  ctx: PickColorContext = {}
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
      ctx.combined &&
      summary.clusterDarkL > 60 &&
      hueDistance(summary.dominantHue, ctx.combined.darkClusterHue) > 8 &&
      ctx.combined.darkClusterS > 20
    ) {
      outH = ctx.combined.darkClusterHue;
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
    ctx.topThin &&
    ctx.topThin.huePurity > 0.5 &&
    hueDistance(summary.dominantHue, ctx.topThin.dominantHue) > 60
  ) {
    outH = ctx.topThin.dominantHue;
  }
  return rgbToHex(hslToRgb({ h: outH, s: outS, l: outL }));
}
