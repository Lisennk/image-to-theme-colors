import { RegionSummary } from "../../analysis/summarizeRegion";

/**
 * Top/bottom medL spread above which the image is treated as split.
 * Below this the top and bottom regions read as the same character
 * and a single color is emitted for both label and accent.
 */
const SPLIT_THRESHOLD = 21;

export type AffirmationDirection = "lighter" | "darker";

export interface AffirmationDecision {
  /** "split" → solve regions independently; "uniform" → one color for both. */
  mode: "split" | "uniform";
  /** Direction (lift / drop from region L) for the label color. */
  tag: AffirmationDirection;
  /** Direction for the accent (icons) color. */
  icon: AffirmationDirection;
}

/**
 * Decide tag/icon directions.
 *
 * - **Split** when `|topMedL − botMedL| > SPLIT_THRESHOLD`. Per-region
 *   direction (regionMedL ≥ 50 → darker, else lighter), with an
 *   override that forces both regions to "darker" when they're each
 *   saturated and bright (image 12: orange smoke gradient — both
 *   zones are vivid mid-bright, so neither benefits from a lift).
 * - **Uniform** otherwise. Direction comes from overall medL, with
 *   the same saturated-bright override (image 9).
 */
export function decideDirections(
  topSummary: RegionSummary,
  botSummary: RegionSummary,
  overallSummary: RegionSummary
): AffirmationDecision {
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
  let dir: AffirmationDirection =
    overallSummary.medL >= 50 ? "darker" : "lighter";
  if (overallSummary.avgS > 75 && overallSummary.medL > 45) dir = "darker";
  return { mode: "uniform", tag: dir, icon: dir };
}
