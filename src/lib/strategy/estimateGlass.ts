import { RGB, HSL } from "../color/types";
import { rgbToHsl, hslToRgb } from "../color/conversion";
import { clamp } from "../util/math";

/**
 * Approximate the visible color of an iOS-26 / Figma-Liquid-Glass control
 * container that sits over a given underlying. Theme-independent: the
 * host implementation uses the same glass component in both light and
 * dark themes, so the same underlying produces the same glass color
 * regardless of theme.
 *
 * Calibrated against the user's actual rendered glass over the boy image
 * (Figma settings: Frost 6, Depth 50, Dispersion 50, Retraction 32,
 * Splay 0):
 *   image avg `#234E60` (HSL 199/47/26)  →  glass `#28556D` (HSL 201/46/29)
 *
 * Fit:
 *   glass.h = underlying.h
 *   glass.s = underlying.s
 *   glass.l = underlying.l + 3   (the surface tint of the glass body)
 *
 * Hue and saturation are preserved (low-Frost glass is mostly clear); the
 * lightness lift is the small surface tint contribution. Real glass has
 * dispersion and refraction that vary across the container, so sampling
 * different pixels gives different values — this models the area average,
 * which is what matters for icon contrast.
 */

const GLASS_L_LIFT = 3;

export function estimateGlassColor(underlying: RGB): RGB {
  const u = rgbToHsl(underlying);
  const glass: HSL = {
    h: u.h,
    s: u.s,
    l: clamp(u.l + GLASS_L_LIFT, 0, 100),
  };
  return hslToRgb(glass);
}
