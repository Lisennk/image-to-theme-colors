import { RGB, HSL } from "../color/types";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "../color/conversion";
import { LIGHT_FEED_BG, DARK_FEED_BG } from "../color/contrast";
import {
  preserveChroma,
  findMaxLightnessAgainstLighter,
  findMinLightnessAgainstDarker,
} from "../color/chromaSolvers";
import { clamp } from "../util/math";

/** Card colors for one theme: surface gradient and content/icon color. */
export interface CardTheme {
  background: {
    baseColor: string;
    linearGradient: [string, string];
  };
  content: {
    accentColor: string;
  };
}

/**
 * Card colors share their hue with the body output (so the card hints at the
 * article's open-state color). Lightness and saturation are tuned for the
 * card's role on a feed: it sits on a feed background, must remain visible
 * against it, carries title + subtitle text, and a circular-control content
 * color (e.g. like-button icon).
 *
 * Card start L is solved against three contrast budgets:
 *   - feed bg:  1.15:1 (light) / 1.12:1 (dark) — the card must read as a
 *               separate surface on the feed.
 *   - title:    7:1 (AAA) — the primary headline must be highly readable.
 *   - subtitle: 6:1 — matches the floor measured across the user's reference
 *               card-start values; halfway between AA (4.5:1) and AAA (7:1).
 *
 * For the default subtitle on the default feed bg these constraints have a
 * narrow but non-empty intersection; for an unusually light subtitle paired
 * with a light feed (or the dark counterpart) text-readability wins and feed
 * contrast may dip below the budget — the same trade-off our reference yellow
 * accepts.
 *
 * Each (S, L) pair is solved iteratively: S is chroma-preserved from the body
 * color into the new L band, but the contrast-feasible L depends on S. We
 * iterate until both converge so the final color always satisfies its
 * contrast constraints.
 */
const LIGHT_FEED_MIN_CONTRAST = 1.15;
const DARK_FEED_MIN_CONTRAST = 1.12;
const TITLE_MIN_CONTRAST = 7.0;
const SUBTITLE_MIN_CONTRAST = 6.0;
const CONTENT_MIN_CONTRAST = 4.5;

function isAchromatic(hsl: HSL): boolean {
  // Matches the threshold used in pickStrategy.ts for full-image achromatic
  // detection. The achromatic strategy returns a slightly warm dark
  // (#2A2925, S≈6%) — without this threshold the card would inherit that
  // warmth and emit a tinted near-black instead of a neutral one.
  return hsl.s < 8;
}

/**
 * Solve a light-theme card start (S, L). Iterates to satisfy three contrast
 * targets: feed (upper bound on L), title and subtitle (each a lower bound).
 * If the bounds invert, text readability wins (lower bound is honored, feed
 * contrast falls).
 */
function solveLightCardStart(
  hue: number,
  seedS: number,
  seedL: number,
  feedRef: RGB,
  titleRef: RGB,
  subtitleRef: RGB,
  lRange: [number, number],
  sRange: [number, number]
): HSL {
  let s = clamp(seedS, sRange[0], sRange[1]);
  let l = lRange[1];
  for (let i = 0; i < 20; i++) {
    const lFeedMax = findMaxLightnessAgainstLighter(hue, s, feedRef, LIGHT_FEED_MIN_CONTRAST, 0, 99);
    const lTitleMin = findMinLightnessAgainstDarker(hue, s, titleRef, TITLE_MIN_CONTRAST, 0, 99);
    const lSubMin = findMinLightnessAgainstDarker(hue, s, subtitleRef, SUBTITLE_MIN_CONTRAST, 0, 99);
    const textFloor = Math.max(lTitleMin, lSubMin);
    // Prefer the lightest L meeting feed contrast; if that's below the
    // text floor, raise to the floor (text readability wins over feed).
    const candidate = textFloor <= lFeedMax ? lFeedMax : textFloor;
    l = clamp(candidate, lRange[0], lRange[1]);
    const newS = clamp(preserveChroma(seedS, seedL, l), sRange[0], sRange[1]);
    if (Math.abs(newS - s) < 0.5) break;
    s = newS;
  }
  return { h: hue, s, l };
}

/**
 * Solve a dark-theme card start (S, L). Mirror of solveLightCardStart: feed
 * gives a lower bound on L, title and subtitle give upper bounds.
 */
function solveDarkCardStart(
  hue: number,
  seedS: number,
  seedL: number,
  feedRef: RGB,
  titleRef: RGB,
  subtitleRef: RGB,
  lRange: [number, number],
  sRange: [number, number]
): HSL {
  let s = clamp(seedS, sRange[0], sRange[1]);
  let l = lRange[0];
  for (let i = 0; i < 20; i++) {
    const lFeedMin = findMinLightnessAgainstDarker(hue, s, feedRef, DARK_FEED_MIN_CONTRAST, 1, 99);
    const lTitleMax = findMaxLightnessAgainstLighter(hue, s, titleRef, TITLE_MIN_CONTRAST, 0, 99);
    const lSubMax = findMaxLightnessAgainstLighter(hue, s, subtitleRef, SUBTITLE_MIN_CONTRAST, 0, 99);
    const textCeiling = Math.min(lTitleMax, lSubMax);
    const candidate = lFeedMin <= textCeiling ? lFeedMin : textCeiling;
    l = clamp(candidate, lRange[0], lRange[1]);
    const newS = clamp(preserveChroma(seedS, seedL, l), sRange[0], sRange[1]);
    if (Math.abs(newS - s) < 0.5) break;
    s = newS;
  }
  return { h: hue, s, l };
}

/** Solve content (S, L) against a brighter card-start reference. */
function solveLightContent(
  hue: number,
  seedS: number,
  seedL: number,
  ref: RGB,
  lRange: [number, number],
  sRange: [number, number]
): HSL {
  let s = clamp(seedS, sRange[0], sRange[1]);
  let l = lRange[1];
  for (let i = 0; i < 20; i++) {
    l = clamp(findMaxLightnessAgainstLighter(hue, s, ref, CONTENT_MIN_CONTRAST, 0, 99), lRange[0], lRange[1]);
    const newS = clamp(preserveChroma(seedS, seedL, l), sRange[0], sRange[1]);
    if (Math.abs(newS - s) < 0.5) break;
    s = newS;
  }
  return { h: hue, s, l };
}

/** Solve content (S, L) against a darker card-start reference. */
function solveDarkContent(
  hue: number,
  seedS: number,
  seedL: number,
  ref: RGB,
  lRange: [number, number],
  sRange: [number, number]
): HSL {
  let s = clamp(seedS, sRange[0], sRange[1]);
  let l = lRange[0];
  for (let i = 0; i < 20; i++) {
    l = clamp(findMinLightnessAgainstDarker(hue, s, ref, CONTENT_MIN_CONTRAST, 1, 99), lRange[0], lRange[1]);
    const newS = clamp(preserveChroma(seedS, seedL, l), sRange[0], sRange[1]);
    if (Math.abs(newS - s) < 0.5) break;
    s = newS;
  }
  return { h: hue, s, l };
}

function generateLightCard(
  bodyLight: HSL,
  bodyDark: HSL,
  lightFeedBg: RGB,
  titleRef: RGB,
  subtitleRef: RGB
): CardTheme {
  const hue = bodyLight.h;
  const achromatic = isAchromatic(bodyLight);

  // ---- Background gradient start ----
  const start = achromatic
    ? solveLightCardStart(0, 0, 0, lightFeedBg, titleRef, subtitleRef, [70, 96], [0, 0])
    : solveLightCardStart(hue, bodyLight.s, bodyLight.l, lightFeedBg, titleRef, subtitleRef, [70, 96], [8, 95]);

  // ---- Background gradient end: deeper, similar/slightly more chroma ----
  const endL = clamp(start.l - 10, 60, 90);
  const endS = achromatic
    ? 0
    : clamp(Math.max(start.s, preserveChroma(start.s, start.l, endL)), start.s, 95);
  const end: HSL = { h: hue, s: endS, l: endL };

  // ---- Content color: deep version of the hue, AA contrast vs card start ----
  // Saturation seed: take the more saturated of body-light and body-dark
  // forms — the body-dark form is the "deep" expression of the hue and
  // gives card content the punch it needs to read against the light card.
  const startRgb = hslToRgb(start);
  const seedS = achromatic ? 0 : Math.max(bodyLight.s, bodyDark.s);
  const seedL = achromatic ? bodyLight.l : (bodyDark.s >= bodyLight.s ? bodyDark.l : bodyLight.l);
  const content = solveLightContent(
    hue,
    seedS,
    seedL,
    startRgb,
    [18, 50],
    achromatic ? [0, 0] : [15, 85]
  );

  return {
    background: {
      baseColor: rgbToHex(startRgb),
      linearGradient: [rgbToHex(startRgb), rgbToHex(hslToRgb(end))],
    },
    content: { accentColor: rgbToHex(hslToRgb(content)) },
  };
}

function generateDarkCard(
  bodyLight: HSL,
  bodyDark: HSL,
  darkFeedBg: RGB,
  titleRef: RGB,
  subtitleRef: RGB
): CardTheme {
  const hue = bodyDark.h;
  const achromatic = isAchromatic(bodyDark);

  // Dark cards lean on saturation to read as a hue at very low L — keep
  // body-dark's saturation as the floor (with a 30 minimum for colored hues).
  const startSeedS = achromatic ? bodyDark.s : clamp(bodyDark.s, 30, 100);
  const startSRange: [number, number] = achromatic ? [bodyDark.s, bodyDark.s] : [30, 100];
  const start = solveDarkCardStart(hue, startSeedS, bodyDark.l, darkFeedBg, titleRef, subtitleRef, [6, 18], startSRange);

  const endL = clamp(start.l + 10, 12, 30);
  const endS = achromatic
    ? start.s
    : clamp(preserveChroma(start.s, start.l, endL), 25, 100);
  const end: HSL = { h: hue, s: endS, l: endL };

  // Dark-theme content is itself a light tint, so chroma-preserve from the
  // body's light form (which tracks the hue's natural softness at high L).
  const startRgb = hslToRgb(start);
  const seedS = achromatic ? 0 : (bodyLight.s > 0 ? bodyLight.s : bodyDark.s * 0.4);
  const seedL = achromatic ? bodyDark.l : (bodyLight.s > 0 ? bodyLight.l : bodyDark.l);
  const content = solveDarkContent(
    hue,
    seedS,
    seedL,
    startRgb,
    [50, 80],
    achromatic ? [0, 0] : [15, 70]
  );

  return {
    background: {
      baseColor: rgbToHex(startRgb),
      linearGradient: [rgbToHex(startRgb), rgbToHex(hslToRgb(end))],
    },
    content: { accentColor: rgbToHex(hslToRgb(content)) },
  };
}

/**
 * Build card colors (background gradient + content color) for both themes,
 * using the body output as the hue source and the feed backgrounds + text
 * colors as contrast references.
 */
export function generateCardThemes(
  bodyLightHex: string,
  bodyDarkHex: string,
  lightFeedBg?: RGB,
  darkFeedBg?: RGB,
  lightTitle?: string,
  lightSubtitle?: string,
  darkTitle?: string,
  darkSubtitle?: string
): { light: CardTheme; dark: CardTheme } {
  const lightHsl = rgbToHsl(hexToRgb(bodyLightHex));
  const darkHsl = rgbToHsl(hexToRgb(bodyDarkHex));

  const lightTitleRgb = hexToRgb(lightTitle ?? "#2A2925");
  const lightSubtitleRgb = hexToRgb(lightSubtitle ?? "#51504D");
  const darkTitleRgb = hexToRgb(darkTitle ?? "#FCFCFC");
  const darkSubtitleRgb = hexToRgb(darkSubtitle ?? "#A09F9E");

  return {
    light: generateLightCard(
      lightHsl,
      darkHsl,
      lightFeedBg ?? LIGHT_FEED_BG,
      lightTitleRgb,
      lightSubtitleRgb
    ),
    dark: generateDarkCard(
      lightHsl,
      darkHsl,
      darkFeedBg ?? DARK_FEED_BG,
      darkTitleRgb,
      darkSubtitleRgb
    ),
  };
}
