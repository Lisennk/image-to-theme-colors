// ---- RGB / HSL conversions ----

export interface RGB {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

// ---- Hex conversions ----

export function rgbToHex(rgb: RGB): string {
  const toHex = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// ---- WCAG luminance & contrast ----

function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

export function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Text colors
export const LIGHT_TEXT = hexToRgb("#2A2925");
export const DARK_TEXT = hexToRgb("#FFFFFF");

/**
 * Adjust HSL lightness to meet AAA contrast (7:1) with the given text color.
 * For light backgrounds: increases L until contrast is met.
 * For dark backgrounds: decreases L until contrast is met.
 */
export function ensureContrast(
  hsl: HSL,
  textColor: RGB,
  isLightTheme: boolean
): HSL {
  const step = 0.5;
  let adjusted = { ...hsl };
  for (let i = 0; i < 200; i++) {
    const rgb = hslToRgb(adjusted);
    const ratio = contrastRatio(rgb, textColor);
    if (ratio >= 7.0) return adjusted;
    if (isLightTheme) {
      adjusted.l = Math.min(100, adjusted.l + step);
    } else {
      adjusted.l = Math.max(0, adjusted.l - step);
    }
  }
  // If we can't reach 7:1, also try reducing saturation
  adjusted = { ...hsl };
  for (let i = 0; i < 400; i++) {
    const rgb = hslToRgb(adjusted);
    const ratio = contrastRatio(rgb, textColor);
    if (ratio >= 7.0) return adjusted;
    if (isLightTheme) {
      adjusted.l = Math.min(100, adjusted.l + step);
      if (adjusted.l >= 100) adjusted.s = Math.max(0, adjusted.s - step);
    } else {
      adjusted.l = Math.max(0, adjusted.l - step);
      if (adjusted.l <= 0) adjusted.s = Math.max(0, adjusted.s - step);
    }
  }
  return adjusted;
}

// ---- Distance metrics ----

export function rgbDistance(a: RGB, b: RGB): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  );
}

export function maxChannelDiff(a: RGB, b: RGB): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b)
  );
}

/** Returns the percentage difference (0-100) as max channel diff / 255 * 100 */
export function colorDiffPercent(a: RGB, b: RGB): number {
  return (rgbDistance(a, b) / Math.sqrt(3 * 255 * 255)) * 100;
}
