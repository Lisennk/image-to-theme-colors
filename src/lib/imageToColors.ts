import sharp from "sharp";
import { rgbToHsl, hslToRgb, rgbToHex } from "./color/conversion";
import { hexToRgb } from "./color/conversion";
import { clamp } from "./util/math";
import {
  LIGHT_THEME_TEXT,
  DARK_THEME_TEXT,
  LIGHT_FEED_BG,
  DARK_FEED_BG,
} from "./color/contrast";
import { analyzePixels } from "./analysis/analyzePixels";
import { PixelData } from "./analysis/types";
import { pickStrategy } from "./strategy/pickStrategy";
import { GenerationContext } from "./strategy/context";
import { generateAchromatic } from "./strategy/generateAchromatic";
import { generateDominantMid } from "./strategy/generateDominantMid";
import { generateLightBackground } from "./strategy/generateLightBackground";
import { generateDarkBackground } from "./strategy/generateDarkBackground";
import { generateCardThemes, CardTheme } from "./strategy/generateCard";

/** Base colors returned by strategy generators (internal). */
export interface BaseColors {
  light: string;
  dark: string;
}

/** A solid color plus a two-stop linear gradient on the same hue. */
export interface BackgroundColors {
  /** Solid background color (e.g. `"#C0D0FF"`). */
  color: string;
  /** Gradient color stops — base color to a slightly deeper variant. */
  linearGradient: [string, string];
}

/** Article body (open-state) colors for one theme. */
export interface BodyTheme {
  background: BackgroundColors;
}

/** Both surfaces (article body + feed card) for one theme. */
export interface ThemeColors {
  body: BodyTheme;
  card: CardTheme;
}

/** The output of `imageToColors`: light and dark theme color sets. */
export interface ImageToColorsResult {
  themes: {
    light: ThemeColors;
    dark: ThemeColors;
  };
}

/** Optional configuration for `imageToColors`. */
export interface ImageToColorsOptions {
  /**
   * Text color used on the light-theme body background, as a hex string.
   * The generated body background will have at least 7:1 (AAA) contrast against this.
   * @default "#2A2925"
   */
  lightThemeTextColor?: string;
  /**
   * Text color used on the dark-theme body background, as a hex string.
   * The generated body background will have at least 7:1 (AAA) contrast against this.
   * @default "#FFFFFF"
   */
  darkThemeTextColor?: string;
  /**
   * Feed (page) background behind cards on the light theme, as a hex string.
   * The generated card background will have at least 1.15:1 contrast against this.
   * @default "#F0F0F0"
   */
  lightThemeFeedBackgroundColor?: string;
  /**
   * Feed (page) background behind cards on the dark theme, as a hex string.
   * The generated card background will have at least 1.12:1 contrast against this.
   * @default "#110F0E"
   */
  darkThemeFeedBackgroundColor?: string;
  /**
   * Title text color on light-theme cards, as a hex string. The card
   * background is solved to give this color at least 7:1 (AAA) contrast.
   * @default "#2A2925"
   */
  lightThemeCardTitleColor?: string;
  /**
   * Subtitle text color on light-theme cards, as a hex string. The card
   * background is solved to give this color at least 6:1 contrast.
   * @default "#51504D"
   */
  lightThemeCardSubtitleColor?: string;
  /**
   * Title text color on dark-theme cards, as a hex string. The card
   * background is solved to give this color at least 7:1 (AAA) contrast.
   * @default "#FCFCFC"
   */
  darkThemeCardTitleColor?: string;
  /**
   * Subtitle text color on dark-theme cards, as a hex string. The card
   * background is solved to give this color at least 6:1 contrast.
   * @default "#A09F9E"
   */
  darkThemeCardSubtitleColor?: string;
}

/**
 * Analyze an image and produce accessible colors for the article body
 * (open state) and the feed card (closed state) in both themes.
 *
 * The algorithm:
 * 1. Resizes the image and extracts pixel data.
 * 2. Analyzes color distribution (dominant hue, accents, background tint).
 * 3. Selects one of four strategies based on image characteristics.
 * 4. Generates body colors with WCAG AAA contrast (7:1) guarantee.
 * 5. Derives card colors from the body's hue, sized to meet feed-bg + card
 *    text contrast budgets.
 *
 * @param input - A file path or Buffer containing the image.
 * @param options - Optional text/feed colors used as contrast references.
 * @returns Body + card colors for light and dark themes.
 *
 * @example
 * ```ts
 * const result = await imageToColors("./hero.jpg");
 * // result.themes.light.body.background.color           "#C0D0FF"
 * // result.themes.light.card.background.color           "#D5E2ED"
 * // result.themes.light.card.content.color              "#4F6678"
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
): Promise<ImageToColorsResult> {
  const ctx: GenerationContext = {
    lightText: options?.lightThemeTextColor
      ? hexToRgb(options.lightThemeTextColor)
      : LIGHT_THEME_TEXT,
    darkText: options?.darkThemeTextColor
      ? hexToRgb(options.darkThemeTextColor)
      : DARK_THEME_TEXT,
  };
  const lightFeedBg = options?.lightThemeFeedBackgroundColor
    ? hexToRgb(options.lightThemeFeedBackgroundColor)
    : LIGHT_FEED_BG;
  const darkFeedBg = options?.darkThemeFeedBackgroundColor
    ? hexToRgb(options.darkThemeFeedBackgroundColor)
    : DARK_FEED_BG;

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

  const card = generateCardThemes(
    base.light,
    base.dark,
    lightFeedBg,
    darkFeedBg,
    options?.lightThemeCardTitleColor,
    options?.lightThemeCardSubtitleColor,
    options?.darkThemeCardTitleColor,
    options?.darkThemeCardSubtitleColor
  );

  return {
    themes: {
      light: {
        body: {
          background: {
            color: base.light,
            linearGradient: [base.light, deriveGradient(base.light)],
          },
        },
        card: card.light,
      },
      dark: {
        body: {
          background: {
            color: base.dark,
            linearGradient: [base.dark, deriveGradient(base.dark)],
          },
        },
        card: card.dark,
      },
    },
  };
}
