import { clamp, percentile } from "./util/math";
import { extractPixels } from "./analysis/extractPixels";
import { summarizeRegion } from "./analysis/summarizeRegion";
import { decideDirections } from "./strategy/affirmation/decideDirections";
import { pickColor } from "./strategy/affirmation/pickColor";

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
 * The output of `composeAffirmationTheme`. Wraps in `themes.{light,dark}`
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

/**
 * Minimum pixels required for a region's summary to be trusted. Below
 * this threshold the histograms are too sparse for the cluster-detection
 * branches to behave predictably, and we collapse to uniform mode against
 * the combined-image summary.
 */
const MIN_REGION_PIXELS = 80;

/**
 * Bounding box (as image-relative fractions) for the area where the tag
 * pill actually sits on the affirmation card UI: top-left, ~12% of the
 * image height, ~55% of the width.
 */
const LABEL_AREA_ROW_MAX = 0.12;
const LABEL_AREA_COL_MAX = 0.55;
/**
 * Bounding box for the area where the circular icons actually sit:
 * a strip across the bottom 12% of the image, full width.
 */
const ACCENT_AREA_ROW_MIN = 0.88;

/**
 * If the medL of the actual control area diverges from the broader
 * top/bottom region by more than this many points, the image has a
 * local feature (e.g. a small dark patch) sitting exactly under the
 * control. The broader-region color solve would average that feature
 * out and produce a low-contrast color at the actual control position,
 * so we override to solve against the local area instead.
 *
 * Calibrated against the validation set (max observed broad/local L
 * diff = 7) and the dark-patch-under-label edge case (diff = 75). A
 * threshold of 30 sits well above any validation diff, guaranteeing
 * no regression.
 */
const LOCAL_OVERRIDE_L_DIFF = 30;

/**
 * Mixed-content trigger: when the local control area's *darker
 * quartile* (p25 L) diverges from the broader region's medL by more
 * than this, the area mixes a dark sub-feature with brighter
 * surroundings — the median is misleading because the actual control
 * may sit over the darker sub-region (e.g. a tag pill rendered over
 * the dark hair of a portrait, with brighter sky filling the rest of
 * the bounding box).
 *
 * Validation set max p25-divergence = 12. The woman+red-bar edge case
 * is 34. Threshold of 25 separates them.
 */
const LOCAL_OVERRIDE_L_DIFF_P25 = 25;

/**
 * Wrap a `(label, accent)` pair in the dual-theme shape. Affirmation
 * overlays don't change with theme, so light and dark share the same
 * values — the wrap exists for API parity with `composeArticleTheme`.
 */
function wrapTheme(labelColor: string, accentColor: string): AffirmationTheme {
  const colors: AffirmationThemeColors = {
    card: { content: { labelColor, accentColor } },
  };
  return { themes: { light: colors, dark: colors } };
}

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

  // Pathological-input guard: if either region is too small to
  // summarize reliably, fall back to a single combined-summary color
  // for both overlays. The validation cards (150×150 → 5625 pixels per
  // default 25% region) never trip this branch.
  if (
    topPixels.length < MIN_REGION_PIXELS ||
    botPixels.length < MIN_REGION_PIXELS
  ) {
    const dir = combinedSummary.medL >= 50 ? "darker" : "lighter";
    const color = pickColor(combinedSummary, dir, "uniform", {
      combined: combinedSummary,
    });
    return wrapTheme(color, color);
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

  // Local-area summaries: the actual bounding boxes of the controls on
  // the affirmation card. Used to detect the case where the broader
  // top/bottom region averages out a small feature that sits *exactly*
  // under the control — e.g. a small dark patch under the label that
  // would render the broader-region label color unreadable in place.
  const labelAreaPixels = pixels.filter(
    (px) => px.row < LABEL_AREA_ROW_MAX && px.col < LABEL_AREA_COL_MAX
  );
  const accentAreaPixels = pixels.filter((px) => px.row > ACCENT_AREA_ROW_MIN);
  const labelAreaSummary = summarizeRegion(
    labelAreaPixels.length >= MIN_REGION_PIXELS ? labelAreaPixels : pixels
  );
  const accentAreaSummary = summarizeRegion(
    accentAreaPixels.length >= MIN_REGION_PIXELS ? accentAreaPixels : pixels
  );
  // Two override triggers per region:
  //  - medL diff > 30: a uniformly different patch sits under the control
  //    (e.g. dark navy block on cream background, image fully dominated by
  //    that patch within the area).
  //  - p25 diff > 25: the local area MIXES a dark sub-feature with brighter
  //    surroundings (or vice versa). The median looks ok but the darker
  //    quartile — where the actual control may render — is far from the
  //    broader region's character.
  const labelP25L =
    labelAreaPixels.length >= MIN_REGION_PIXELS
      ? percentile(labelAreaPixels.map((p) => p.l), 0.25)
      : labelAreaSummary.medL;
  const accentP25L =
    accentAreaPixels.length >= MIN_REGION_PIXELS
      ? percentile(accentAreaPixels.map((p) => p.l), 0.25)
      : accentAreaSummary.medL;
  // Solid-vivid-midL: the local control area is a single saturated
  // color (no L variance, near-max avgS) sitting at a mid lightness
  // (L ≈ 40–60) — the worst case for in-hue contrast. A darker version
  // of the same hue can't reach AA against the bg, so the override
  // lets pickColor's solid-vivid achromatic branch fire. Restricted
  // to mid-L cluster so vivid-bright regions like aff#12's L≈70
  // orange smoke (where in-hue darker DOES clear) aren't caught.
  const isSolidVividMidL = (s: typeof labelAreaSummary): boolean =>
    s.avgS > 90 &&
    Math.abs(s.clusterTopL - s.clusterDarkL) < 5 &&
    s.clusterDarkL >= 40 &&
    s.clusterTopL <= 60;

  const labelOverride =
    Math.abs(labelAreaSummary.medL - topSummary.medL) > LOCAL_OVERRIDE_L_DIFF ||
    Math.abs(labelP25L - topSummary.medL) > LOCAL_OVERRIDE_L_DIFF_P25 ||
    (isSolidVividMidL(labelAreaSummary) && !isSolidVividMidL(topSummary));
  const accentOverride =
    Math.abs(accentAreaSummary.medL - botSummary.medL) > LOCAL_OVERRIDE_L_DIFF ||
    Math.abs(accentP25L - botSummary.medL) > LOCAL_OVERRIDE_L_DIFF_P25 ||
    (isSolidVividMidL(accentAreaSummary) && !isSolidVividMidL(botSummary));

  const directions = decideDirections(topSummary, botSummary, combinedSummary);

  // Local-override path: the broader region's character doesn't match
  // what's actually under the control. Solve each control independently
  // against its own local area, with a fresh local direction, and emit
  // potentially-different label and accent colors.
  if (labelOverride || accentOverride) {
    const labelSolveSummary = labelOverride ? labelAreaSummary : topSummary;
    const accentSolveSummary = accentOverride ? accentAreaSummary : botSummary;
    // Direction uses the local area's median L. The pill's *visible*
    // backdrop (what the eye sees through 15% labelColor + backdrop
    // blur) is a smear of the area's pixels — close to the median, not
    // the darkest or brightest. Solving against the median produces a
    // color with good contrast against that smeared average, which
    // reads cleanly even when the underlying mixes dark and bright
    // pixels.
    const labelDir: "lighter" | "darker" = labelOverride
      ? labelAreaSummary.medL >= 50 ? "darker" : "lighter"
      : directions.tag;
    const accentDir: "lighter" | "darker" = accentOverride
      ? accentAreaSummary.medL >= 50 ? "darker" : "lighter"
      : directions.icon;
    const labelColor = pickColor(labelSolveSummary, labelDir, "split", {
      combined: combinedSummary,
      topThin: topThinSummary,
    });
    const accentColor = pickColor(accentSolveSummary, accentDir, "split", {
      combined: combinedSummary,
    });
    return wrapTheme(labelColor, accentColor);
  }

  if (directions.mode === "uniform") {
    const color = pickColor(topSummary, directions.tag, "uniform", {
      combined: combinedSummary,
      topThin: topThinSummary,
    });
    return wrapTheme(color, color);
  }

  const labelColor = pickColor(topSummary, directions.tag, "split", {
    combined: combinedSummary,
    topThin: topThinSummary,
  });
  const accentColor = pickColor(botSummary, directions.icon, "split", {
    combined: combinedSummary,
  });
  return wrapTheme(labelColor, accentColor);
}
