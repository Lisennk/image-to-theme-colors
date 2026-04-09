/** RGB color with channels in the 0–255 range. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** HSL color: hue 0–360, saturation 0–100, lightness 0–100. */
export interface HSL {
  h: number;
  s: number;
  l: number;
}
