import { RGB } from "../color/types";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "../color/conversion";
import { clamp } from "../util/math";
import { pickContrastingL, rangeOpposite } from "./contrastSolver";

/**
 * Body-content label color — the small category indicator (e.g. "Article")
 * that sits near the bottom of the hero/body transition zone.
 *
 * The label background is *not* the body color itself: at the label's
 * vertical position the body's first gradient stop is rendered at ~83%
 * opacity over the lower portion of the hero image, so the visible
 * background behind the label is a composite of both.
 *
 *   labelBg = body.baseColor * 0.83 + image_lower * 0.17
 *
 * The label color follows the same contrast / hue-continuity logic as the
 * body-content accent (same 4.5:1 AA target, same body-hue seed, L on the
 * opposite side of the bg's midpoint), with one designer-derived twist:
 *
 *   label.S = clamp(70 - labelBg.S, 15, 50)     (achromatic body → S = 0)
 *
 * That is, label saturation is *inversely* related to the bg's saturation.
 * A muted bg gets a slightly more colorful label so it reads as the body's
 * hue; a vivid bg gets a desaturated label so the label doesn't clash.
 *
 * Calibrated against the designer's reference on the boy-dark image:
 *   light: labelBg `#8EABBB` (S=25)  →  label `#214154` (S=44)   → 4.46:1
 *   dark:  labelBg `#152F40` (S=51)  →  label `#869DAC` (S=19)   → 4.91:1
 *   sum (label.S + labelBg.S) ≈ 70 in both themes.
 */

const BODY_OPACITY_AT_LABEL = 0.83;
const SATURATION_BUDGET = 70;
const MIN_LABEL_SATURATION = 15;
const MAX_LABEL_SATURATION = 50;
const ACHROMATIC_S_THRESHOLD = 8;

/**
 * Composite the body's first gradient stop over the image's lower portion
 * at the label's vertical position.
 */
export function compositeLabelBackground(
  bodyRgb: RGB,
  imageLowerRgb: RGB
): RGB {
  const a = BODY_OPACITY_AT_LABEL;
  return {
    r: Math.round(bodyRgb.r * a + imageLowerRgb.r * (1 - a)),
    g: Math.round(bodyRgb.g * a + imageLowerRgb.g * (1 - a)),
    b: Math.round(bodyRgb.b * a + imageLowerRgb.b * (1 - a)),
  };
}

/**
 * @param bodyHex        Body's `baseColor` (the gradient's first stop).
 * @param imageLowerRgb  Average RGB of the image's lower region — what
 *                       shows through behind the body gradient at the
 *                       label position.
 */
export function generateBodyLabel(
  bodyHex: string,
  imageLowerRgb: RGB
): string {
  const bodyRgb = hexToRgb(bodyHex);
  const bodyHsl = rgbToHsl(bodyRgb);

  const labelBgRgb = compositeLabelBackground(bodyRgb, imageLowerRgb);
  const labelBgHsl = rgbToHsl(labelBgRgb);

  const isAchromatic = bodyHsl.s < ACHROMATIC_S_THRESHOLD;
  const s = isAchromatic
    ? 0
    : clamp(
        SATURATION_BUDGET - labelBgHsl.s,
        MIN_LABEL_SATURATION,
        MAX_LABEL_SATURATION
      );
  const hue = bodyHsl.h;

  const direction: "darker" | "lighter" =
    labelBgHsl.l > 50 ? "darker" : "lighter";
  const range = rangeOpposite(labelBgHsl.l, direction);
  const result = pickContrastingL(hue, s, labelBgRgb, range, direction);
  return rgbToHex(hslToRgb({ h: hue, s, l: result.l }));
}
