/** A single pixel with its color data and position within the image. */
export interface PixelData {
  /** Hue in degrees (0–360). */
  h: number;
  /** Saturation as a percentage (0–100). */
  s: number;
  /** Lightness as a percentage (0–100). */
  l: number;
  /** Red channel (0–255). */
  r: number;
  /** Green channel (0–255). */
  g: number;
  /** Blue channel (0–255). */
  b: number;
  /** Vertical position, 0 = top, 1 = bottom. */
  row: number;
  /** Horizontal position, 0 = left, 1 = right. */
  col: number;
}

/**
 * Results of analyzing an image's pixel data.
 *
 * Contains the dominant color, background tint, accent color, bottom-edge
 * color, dark-region color, and global statistics — everything the strategy
 * selector and color generators need to produce theme colors.
 */
export interface ImageAnalysis {
  /** Dominant hue (from border-weighted histogram). */
  dominantHue: number;
  /** Dominant saturation (25th percentile of pixels near dominant hue, capped at 60). */
  dominantSaturation: number;
  /** Dominant lightness (median of pixels near dominant hue). */
  dominantLightness: number;

  /** Hue at the very bottom edge (last 10% of rows) — the gradient transition zone. */
  bottomHue: number;
  /** Saturation at the bottom edge. */
  bottomSaturation: number;
  /** Whether the bottom-edge color is a real background (concentrated at the bottom)
   *  rather than a foreground object that happens to extend to the edge. */
  bottomIsBackground: boolean;

  /** Background hue derived from average RGB of very bright pixels (L > 90%). */
  backgroundHue: number;
  /** Background saturation from the same bright-pixel average. */
  backgroundSaturation: number;

  /** Accent hue — the most prominent bright color with a different hue from the dominant. */
  accentHue: number;
  /** Accent saturation (L²-weighted average). */
  accentSaturation: number;
  /** Accent lightness (L²-weighted average). */
  accentLightness: number;
  /** Fraction of pixels belonging to the accent (0–1). */
  accentStrength: number;

  /** Hue of the darkest 10% of colored pixels. */
  darkRegionHue: number;
  /** Saturation of the darkest 10% of colored pixels. */
  darkRegionSaturation: number;

  /** Mean saturation across all pixels. */
  averageSaturation: number;
  /** Median lightness across all pixels. */
  medianLightness: number;
}
