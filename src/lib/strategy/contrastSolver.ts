import { RGB } from "../color/types";
import { hslToRgb } from "../color/conversion";
import { contrastRatio } from "../color/contrast";

/**
 * WCAG contrast tiers used by accent and label solvers.
 *
 * `AA` is the legibility/character sweet spot for small icons and short
 * labels — high enough to read clearly, low enough to keep a moderate L
 * close to the background and preserve hue character. `MIN` (SC 1.4.11
 * floor) is a fallback when 4.5:1 isn't reachable on the theme-appropriate
 * side (very narrow room — e.g. background at L=95+).
 */
export const TIER_AA = 4.5;
export const TIER_MIN = 3.0;

export interface LPick {
  l: number;
  c: number;
}

/**
 * Find the L (lightness) on a `(hue, saturation)` row of HSL that gives a
 * contrasting color against `bgRgb`.
 *
 * Within each tier, prefers the L *closest to the background's L* (i.e.
 * largest in the "darker" direction, smallest in "lighter") — that side of
 * the budget has the most chroma room and the least L extreme.
 *
 * @param hue          Hue of the candidate (degrees).
 * @param saturation   Saturation of the candidate (0–100).
 * @param bgRgb        Background to contrast against.
 * @param range        L search window — usually the half opposite the bg.
 * @param direction    Which side of `range` to favor on ties / within tier.
 */
export function pickContrastingL(
  hue: number,
  saturation: number,
  bgRgb: RGB,
  range: [number, number],
  direction: "darker" | "lighter"
): LPick {
  const STEP = 0.1;
  let aaTier: LPick | null = null;
  let minTier: LPick | null = null;
  let best: LPick = { l: range[0], c: 0 };

  for (let testL = range[0]; testL <= range[1]; testL += STEP) {
    const tRgb = hslToRgb({ h: hue, s: saturation, l: testL });
    const c = contrastRatio(tRgb, bgRgb);
    const candidate: LPick = { l: testL, c };
    const better = (cur: LPick | null) =>
      cur === null ||
      (direction === "darker" ? candidate.l > cur.l : candidate.l < cur.l);

    if (c >= TIER_AA && better(aaTier)) aaTier = candidate;
    if (c >= TIER_MIN && better(minTier)) minTier = candidate;
    if (c > best.c) best = candidate;
  }

  return aaTier ?? minTier ?? best;
}

/**
 * Build an L search range on the side of `bg.l` opposite to the candidate.
 * Inset by 5 L units so the candidate is clearly distinct from the bg.
 *
 * Edge case: if the bg sits near an L extreme there's little room on the
 * theme-appropriate side. Fall back to the full opposite half.
 */
export function rangeOpposite(
  bgL: number,
  direction: "darker" | "lighter"
): [number, number] {
  let range: [number, number] =
    direction === "darker"
      ? [3, Math.max(bgL - 5, 4)]
      : [Math.min(bgL + 5, 96), 97];
  if (range[1] - range[0] < 5) {
    range = direction === "darker" ? [0, bgL] : [bgL, 100];
  }
  return range;
}
