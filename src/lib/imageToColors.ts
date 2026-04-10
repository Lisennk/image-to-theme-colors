import sharp from "sharp";
import { rgbToHsl, hslToRgb, rgbToHex } from "./color/conversion";
import { hexToRgb } from "./color/conversion";
import { clamp } from "./util/math";
import { LIGHT_THEME_TEXT, DARK_THEME_TEXT } from "./color/contrast";
import { analyzePixels } from "./analysis/analyzePixels";
import { PixelData } from "./analysis/types";
import { pickStrategy } from "./strategy/pickStrategy";
import { GenerationContext } from "./strategy/context";
import { generateAchromatic } from "./strategy/generateAchromatic";
import { generateDominantMid } from "./strategy/generateDominantMid";
import { generateLightBackground } from "./strategy/generateLightBackground";
import { generateDarkBackground } from "./strategy/generateDarkBackground";

/** Base colors returned by strategy generators (internal). */
export interface BaseColors {
  light: string;
  dark: string;
}

/** The output of `imageToColors`: background hex colors for both themes. */
export interface ThemeColors extends BaseColors {
  /** Gradient end color for the light theme — slightly deeper than `light`. */
  lightGradient: string;
  /** Gradient end color for the dark theme — slightly deeper than `dark`. */
  darkGradient: string;
}

/** Optional configuration for `imageToColors`. */
export interface ImageToColorsOptions {
  /**
   * Text color used on the light-theme background, as a hex string.
   * The generated background will have at least 7:1 (AAA) contrast against this.
   * @default "#2A2925"
   */
  lightThemeTextColor?: string;
  /**
   * Text color used on the dark-theme background, as a hex string.
   * The generated background will have at least 7:1 (AAA) contrast against this.
   * @default "#FFFFFF"
   */
  darkThemeTextColor?: string;
}

/**
 * Analyze an image and produce accessible background colors for light and
 * dark article themes.
 *
 * The algorithm:
 * 1. Resizes the image and extracts pixel data.
 * 2. Analyzes color distribution (dominant hue, accents, background tint).
 * 3. Selects one of four strategies based on image characteristics.
 * 4. Generates light/dark colors with WCAG AAA contrast (7:1) guarantee.
 *
 * @param input - A file path or Buffer containing the image.
 * @param options - Optional text colors for contrast calculation.
 * @returns An object with `light` and `dark` hex color strings.
 *
 * @example
 * ```ts
 * const { light, dark } = await imageToColors("./hero.jpg");
 * // light: "#C0D0FF", dark: "#0F172F"
 * ```
 *
 * @example
 * ```ts
 * // With custom text colors:
 * const result = await imageToColors(buffer, {
 *   lightThemeTextColor: "#1A1A1A",
 *   darkThemeTextColor: "#F0F0F0",
 * });
 * ```
 */

/** Derive a gradient end color: shift L 2% toward mid-gray and boost S by 5. */
function deriveGradient(hex: string): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.l += hsl.l < 50 ? 2 : -2;
  hsl.s = clamp(hsl.s + 5, 0, 100);
  return rgbToHex(hslToRgb(hsl));
}

export async function imageToColors(
  input: string | Buffer,
  options?: ImageToColorsOptions
): Promise<ThemeColors> {
  const ctx: GenerationContext = {
    lightText: options?.lightThemeTextColor
      ? hexToRgb(options.lightThemeTextColor)
      : LIGHT_THEME_TEXT,
    darkText: options?.darkThemeTextColor
      ? hexToRgb(options.darkThemeTextColor)
      : DARK_THEME_TEXT,
  };

  const { data, info } = await sharp(input)
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
      // HSL saturation is unstable at extreme lightness: a 1/255 channel
      // difference in a near-white pixel produces ~100% S.  Dampen S when
      // L is within 5% of either end so these pixels read as achromatic.
      if (hsl.l > 95) hsl.s *= (100 - hsl.l) / 5;
      else if (hsl.l < 5) hsl.s *= hsl.l / 5;
      pixels.push({ ...hsl, r, g, b, row: y / height, col: x / width });
    }
  }

  const analysis = analyzePixels(pixels);
  const strategy = pickStrategy(analysis);

  let base: BaseColors;
  switch (strategy) {
    case "achromatic":
      base = generateAchromatic();
      break;
    case "dominant_mid":
      base = generateDominantMid(analysis, ctx);
      break;
    case "light_bg":
      base = generateLightBackground(analysis, ctx);
      break;
    case "dark_bg":
      base = generateDarkBackground(analysis, ctx);
      break;
  }

  return {
    ...base,
    lightGradient: deriveGradient(base.light),
    darkGradient: deriveGradient(base.dark),
  };
}
