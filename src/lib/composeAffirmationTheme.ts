import { clamp } from "./util/math";
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

  const directions = decideDirections(topSummary, botSummary, combinedSummary);

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
