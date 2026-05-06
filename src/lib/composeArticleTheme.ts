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
import { generateBodyAccent } from "./strategy/generateAccent";
import { generateBodyLabel } from "./strategy/generateLabel";
import { RGB } from "./color/types";

/** Base colors returned by strategy generators (internal). */
export interface BaseColors {
  light: string;
  dark: string;
}

/** A solid color plus a two-stop linear gradient on the same hue. */
export interface BackgroundColors {
  /** Base color — also the first stop of `linearGradient` (e.g. `"#C0D0FF"`). */
  baseColor: string;
  /** Gradient color stops — base color to a slightly deeper variant. */
  linearGradient: [string, string];
}

/** Body content colors that overlay the body background. */
export interface BodyContent {
  /**
   * Icon color used inside the iOS-26 / Liquid-Glass control container at
   * the top of the article. Two values are returned because the icon's
   * *immediate* background — the glass tint — looks different depending
   * on what's underneath it during scroll:
   *
   *  - `overImage`: applies when the control overlaps the image (initial
   *                 state); solved against the glass tint over the image's
   *                 top-right region. Same in light and dark themes (the
   *                 host glass component is theme-independent and the
   *                 image is the same).
   *  - `overBody`:  applies when the control has scrolled to sit over the
   *                 article body; solved against the glass tint over the
   *                 body color. Differs per theme because the body color
   *                 itself differs per theme.
   *
   * Each accent targets 4.5:1 contrast (WCAG AA) against its glass — the
   * legibility/character sweet spot the reference designer picked. Falls
   * back to 3:1 (SC 1.4.11 floor) if 4.5:1 isn't reachable.
   */
  accentColor: {
    overImage: string;
    overBody: string;
  };
  /**
   * Color of the small category label (e.g. "Article") that sits near the
   * bottom of the hero-image / body-gradient transition. The label
   * background is the *composite* of the image's lower portion and the
   * body's first gradient stop at ~83% opacity, so the label color is
   * solved against that composite — not against the body alone.
   *
   * Targets 4.5:1 (WCAG AA) against the composite bg, preserves the body's
   * hue, and uses an inverse-saturation rule (muted bg → more colorful
   * label, vivid bg → desaturated label) so the label reads as part of
   * the body's palette without clashing.
   */
  labelColor: string;
}

/** Article body (open-state) colors for one theme. */
export interface BodyTheme {
  background: BackgroundColors;
  content: BodyContent;
}

/** Both surfaces (article body + feed card) for one theme. */
export interface ArticleThemeColors {
  body: BodyTheme;
  card: CardTheme;
}

/** The output of `composeArticleTheme`: light and dark theme color sets. */
export interface ArticleTheme {
  themes: {
    light: ArticleThemeColors;
    dark: ArticleThemeColors;
  };
}

/** Optional configuration for `composeArticleTheme`. */
export interface ArticleThemeOptions {
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
 * const result = await composeArticleTheme("./hero.jpg");
 * // result.themes.light.body.background.baseColor       "#C0D0FF"
 * // result.themes.light.body.content.labelColor         "#214154"
 * // result.themes.light.card.background.baseColor       "#D5E2ED"
 * // result.themes.light.card.content.accentColor        "#214154"  (= body.content.labelColor)
 * ```
 */

/** Derive a gradient end color: shift L 2% away from mid-gray and boost S by 5. */
function deriveGradient(hex: string): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.l += hsl.l < 50 ? -2 : 2;
  hsl.l = clamp(hsl.l, 0, 100);
  hsl.s = clamp(hsl.s + 5, 0, 100);
  return rgbToHex(hslToRgb(hsl));
}

export async function composeArticleTheme(
  input: string | Buffer,
  options?: ArticleThemeOptions
): Promise<ArticleTheme> {
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

  // `.rotate()` with no argument applies the EXIF orientation tag and then
  // strips it. Without this, a portrait phone photo saved sideways would
  // have its top/bottom regions sampled from the wrong edges.
  const { data, info } = await sharp(input)
    .rotate()
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

  // ---- Image color where the iOS glass control sits (top-right corner) ----
  // The control is approximately top 20% rows, right half. As the user
  // scrolls, the image moves up under the control, so this region is the
  // most representative of what the icon is briefly placed against before
  // the body gradient takes over.
  const controlAreaPixels = pixels.filter(
    (px) => px.row < 0.2 && px.col > 0.5
  );
  const controlPx =
    controlAreaPixels.length >= 10 ? controlAreaPixels : pixels;
  const controlAreaColor: RGB = {
    r: Math.round(controlPx.reduce((s, p) => s + p.r, 0) / controlPx.length),
    g: Math.round(controlPx.reduce((s, p) => s + p.g, 0) / controlPx.length),
    b: Math.round(controlPx.reduce((s, p) => s + p.b, 0) / controlPx.length),
  };

  // ---- Image color in the lower portion (label transition zone) ----
  // The label sits where the image's lower edge fades into the body
  // gradient. The image color in that region is what shows through the
  // body's ~17% transparency at the label's vertical position.
  const lowerPixels = pixels.filter((px) => px.row > 0.8);
  const lowerPx = lowerPixels.length >= 10 ? lowerPixels : pixels;
  const imageLowerColor: RGB = {
    r: Math.round(lowerPx.reduce((s, p) => s + p.r, 0) / lowerPx.length),
    g: Math.round(lowerPx.reduce((s, p) => s + p.g, 0) / lowerPx.length),
    b: Math.round(lowerPx.reduce((s, p) => s + p.b, 0) / lowerPx.length),
  };

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

  const lightAccents = generateBodyAccent(base.light, controlAreaColor);
  const darkAccents = generateBodyAccent(base.dark, controlAreaColor);

  const lightLabel = generateBodyLabel(base.light, imageLowerColor);
  const darkLabel = generateBodyLabel(base.dark, imageLowerColor);

  // Card content accent reuses the body label color: same role (a small
  // hue-bearing element representing the article) and same algorithm, so the
  // open-state and feed-state palettes stay coherent.
  const card = generateCardThemes(
    base.light,
    base.dark,
    lightLabel,
    darkLabel,
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
            baseColor: base.light,
            linearGradient: [base.light, deriveGradient(base.light)],
          },
          content: {
            accentColor: lightAccents,
            labelColor: lightLabel,
          },
        },
        card: card.light,
      },
      dark: {
        body: {
          background: {
            baseColor: base.dark,
            linearGradient: [base.dark, deriveGradient(base.dark)],
          },
          content: {
            accentColor: darkAccents,
            labelColor: darkLabel,
          },
        },
        card: card.dark,
      },
    },
  };
}
