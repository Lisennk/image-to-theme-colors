import { RGB, HSL } from "../color/types";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "../color/conversion";
import { contrastRatio } from "../color/contrast";
import { clamp } from "../util/math";
import { estimateGlassColor } from "./estimateGlass";

/**
 * Body-content accent colors for the icon inside the iOS-26 / Liquid-Glass
 * control container at the top of the article.
 *
 * The control overlaps two underlyings during a scroll session: the image
 * (initial) and the body gradient (scrolled). The glass component is
 * theme-independent in this implementation — same component in both light
 * and dark — so the visible glass color is purely a function of the
 * underlying. The host UI crossfades between two icon colors based on
 * scroll progress.
 *
 *   accentColor.overImage  — same in both themes (image is the same)
 *   accentColor.overBody   — differs per theme because the body itself
 *                            differs per theme
 *
 * Direction (lighter vs darker than glass) is decided by glass.L, not by
 * theme. So a dark image gets a light icon in any theme; a light body
 * gets a dark icon (which only happens in light theme since the dark-theme
 * body is dark).
 *
 * Target: 4.5:1 (WCAG AA-equivalent). Calibrated against the designer's
 * reference: `#B3CBDB` icon on `#28556D` glass over the boy image lands
 * at ~4.75:1 — that's the legibility/character sweet spot the designer
 * picked, and the algorithm reproduces it.
 *
 * 3:1 (the SC 1.4.11 floor) reads too low against moderate-L glass; 7:1
 * (AAA-equivalent) drives the accent to L extremes (near-white or
 * near-black) and strips hue character. 4.5:1 keeps the accent at a
 * moderate L close to the glass while still reading clearly as a hue.
 *
 * If 4.5:1 isn't reachable on the theme-appropriate side (very narrow
 * room — e.g. glass at L=95+), the algorithm falls back to 3:1 and then
 * to a best-effort max contrast.
 *
 * Hue is preserved from the underlying so the icon stays in the
 * underlying's palette. Saturation is held in a moderate band — high S
 * at extreme L looks harsh or neon as a small icon.
 */

const TIER_AA = 4.5;
const TIER_MIN = 3.0;

export interface BodyAccentColors {
  overImage: string;
  overBody: string;
}

interface Pick {
  l: number;
  c: number;
}

function pickAccentL(
  hue: number,
  saturation: number,
  glassRgb: RGB,
  range: [number, number],
  direction: "darker" | "lighter"
): Pick {
  const STEP = 0.1;
  let aaTier: Pick | null = null;
  let minTier: Pick | null = null;
  let best: Pick = { l: range[0], c: 0 };

  for (let testL = range[0]; testL <= range[1]; testL += STEP) {
    const tRgb = hslToRgb({ h: hue, s: saturation, l: testL });
    const c = contrastRatio(tRgb, glassRgb);
    const candidate: Pick = { l: testL, c };
    const better = (cur: Pick | null) =>
      cur === null ||
      (direction === "darker" ? candidate.l > cur.l : candidate.l < cur.l);

    // Within each tier, prefer the L closest to glass — that's the side
    // of the budget with the most chroma room and the least L extreme.
    if (c >= TIER_AA && better(aaTier)) aaTier = candidate;
    if (c >= TIER_MIN && better(minTier)) minTier = candidate;
    if (c > best.c) best = candidate;
  }

  return aaTier ?? minTier ?? best;
}

/**
 * Solve a single accent against one glass reference.
 *
 * Hue and a saturation seed come from the underlying so the icon visually
 * belongs to whatever it sits on. Direction (lighter / darker than glass)
 * is decided by glass.L, not by theme — the icon naturally inverts the
 * glass's lightness for max legibility.
 */
function solveAccentForGlass(
  hueSource: HSL,
  glassRgb: RGB
): string {
  const glass = rgbToHsl(glassRgb);
  const hue = hueSource.h;
  const isAchromatic = hueSource.s < 8;
  const s = isAchromatic ? 0 : clamp(hueSource.s, 25, 50);

  const direction: "darker" | "lighter" = glass.l > 50 ? "darker" : "lighter";

  let range: [number, number];
  if (direction === "darker") {
    range = [3, Math.max(glass.l - 5, 4)];
  } else {
    range = [Math.min(glass.l + 5, 96), 97];
  }
  // Edge case: glass at an L extreme leaves almost no room on its
  // theme-appropriate side. Fall back to the full opposite half.
  if (range[1] - range[0] < 5) {
    range = direction === "darker" ? [0, glass.l] : [glass.l, 100];
  }

  const result = pickAccentL(hue, s, glassRgb, range, direction);
  return rgbToHex(hslToRgb({ h: hue, s, l: result.l }));
}

/**
 * Generate both body-content accent colors (over-image and over-body).
 *
 * Theme-independent for `overImage` (depends only on the image), so the
 * icon over the same image area is the same color in light and dark mode.
 * `overBody` depends on the body color, which itself differs by theme, so
 * the over-body accent will differ between themes.
 *
 * @param bodyHex - Body's `baseColor`. Used only for the over-body accent
 *                  (its hue + saturation seed and underlying for the glass).
 * @param imageRef - Average RGB of the image area where the control sits
 *                   (top-right region) — its hue + saturation seed and
 *                   underlying for the over-image glass.
 */
export function generateBodyAccent(
  bodyHex: string,
  imageRef: RGB
): BodyAccentColors {
  const bodyRgb = hexToRgb(bodyHex);
  const bodyHsl = rgbToHsl(bodyRgb);
  const imageHsl = rgbToHsl(imageRef);

  const glassOverImage = estimateGlassColor(imageRef);
  const glassOverBody = estimateGlassColor(bodyRgb);

  return {
    overImage: solveAccentForGlass(imageHsl, glassOverImage),
    overBody: solveAccentForGlass(bodyHsl, glassOverBody),
  };
}

/** Exported for tests and callers that want to inspect what we modeled. */
export { estimateGlassColor };
