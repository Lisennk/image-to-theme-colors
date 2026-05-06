/**
 * The four strategies for generating theme colors from an image:
 *
 * - `achromatic` — grayscale/B&W image → white and warm near-black.
 * - `dominant_mid` — a clear mid-tone color dominates → lighten/darken it.
 * - `light_bg` — image has a bright background (median L > 70%) → use its tint.
 * - `dark_bg` — image is mostly dark with a bright accent → amplify the accent.
 */
export type ThemeStrategy =
  | "achromatic"
  | "dominant_mid"
  | "light_bg"
  | "dark_bg";

/**
 * Body base colors returned by strategy generators. The light/dark hex
 * pair becomes `body.background.baseColor` for each theme; the article
 * pipeline derives gradient stops, accents, label, and card colors
 * from these two values.
 */
export interface BaseColors {
  light: string;
  dark: string;
}
