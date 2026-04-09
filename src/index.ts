import sharp from "sharp";
import {
  RGB, HSL, rgbToHsl, hslToRgb, rgbToHex, contrastRatio, LIGHT_TEXT, DARK_TEXT,
} from "./colorUtils";

export interface ThemeColors { light: string; dark: string }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b); return d > 180 ? 360 - d : d; };

function circularMean(hues: number[], w: number[]) {
  let ss = 0, sc = 0, tw = 0;
  for (let i = 0; i < hues.length; i++) {
    if (w[i] <= 0) continue;
    const r = hues[i] * Math.PI / 180;
    ss += w[i] * Math.sin(r); sc += w[i] * Math.cos(r); tw += w[i];
  }
  if (tw === 0) return 0;
  let a = Math.atan2(ss / tw, sc / tw) * 180 / Math.PI;
  return a < 0 ? a + 360 : a;
}

function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] * (hi - i) + s[hi] * (i - lo);
}

function findMinL(h: number, s: number, text: RGB, ratio: number) {
  let lo = 50, hi = 100;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    contrastRatio(hslToRgb({ h, s, l: m }), text) >= ratio ? hi = m : lo = m;
  }
  return hi;
}

function ensureDark(hsl: HSL): HSL {
  let a = { ...hsl };
  for (let i = 0; i < 120; i++) {
    if (contrastRatio(hslToRgb(a), DARK_TEXT) >= 7.0) return a;
    a = { ...a, l: a.l - 0.5 };
  }
  return a;
}

// row: 0=top, 1=bottom.  col: 0=left, 1=right.
interface Px { h: number; s: number; l: number; r: number; g: number; b: number; row: number; col: number }

interface An {
  domH: number; domS: number; domL: number;
  bottomH: number; bottomS: number; // hue/sat of the very bottom edge (gradient zone)
  bgH: number; bgS: number;
  accentH: number; accentS: number; accentL: number; accentStr: number;
  darkH: number; darkS: number;
  avgSat: number; medianL: number;
}

function analyze(px: Px[]): An {
  const n = px.length;

  // ---- Dominant hue: full image with extra weight for border/background pixels ----
  // Border = bottom 15% strip + left/right 10% edges in bottom half
  // These are likely background (subjects are centered), so boost them 3x.
  const bins = 36, hist = new Float64Array(bins);
  for (const p of px) {
    if (p.s < 3) continue;
    const isBorder = p.row >= 0.85 || (p.row >= 0.5 && (p.col < 0.10 || p.col > 0.90));
    const weight = (1 + p.row) * (isBorder ? 3 : 1);
    hist[Math.floor(p.h / 10) % bins] += weight;
  }
  let maxW = 0, best = 0;
  for (let i = 0; i < bins; i++) {
    const wt = hist[(i - 1 + bins) % bins] + hist[i] + hist[(i + 1) % bins];
    if (wt > maxW) { maxW = wt; best = i; }
  }
  const db = [(best - 1 + bins) % bins, best, (best + 1) % bins];
  const domH = circularMean(db.filter(b => hist[b] > 0).map(b => b * 10 + 5), db.map(b => hist[b]));

  const nearDom = px.filter(p => p.s >= 3 && hueDist(p.h, domH) < 20);
  const domS = clamp(pct(nearDom.map(p => p.s), 0.25), 0, 60);
  const domL = pct(nearDom.map(p => p.l), 0.50);

  // ---- Background from avg RGB of very bright pixels (L > 90%) ----
  const vb = px.filter(p => p.l > 90);
  let bgH = 0, bgS = 0;
  if (vb.length > 20) {
    const ar = vb.reduce((s, p) => s + p.r, 0) / vb.length;
    const ag = vb.reduce((s, p) => s + p.g, 0) / vb.length;
    const ab = vb.reduce((s, p) => s + p.b, 0) / vb.length;
    const hsl = rgbToHsl({ r: Math.round(ar), g: Math.round(ag), b: Math.round(ab) });
    bgH = hsl.h; bgS = hsl.s;
  }

  // ---- Accent: bright non-dominant, L²-weighted ----
  const accentPx = px.filter(p => p.l > 25 && p.s > 15 && hueDist(p.h, domH) > 25);
  let accentH = 0, accentS = 0, accentL = 50, accentStr = 0;
  if (accentPx.length > 15) {
    const w = accentPx.map(p => p.s * p.l * p.l);
    accentH = circularMean(accentPx.map(p => p.h), w);
    const tw = w.reduce((a, b) => a + b, 0);
    accentS = w.reduce((s, wi, i) => s + accentPx[i].s * wi, 0) / tw;
    accentL = w.reduce((s, wi, i) => s + accentPx[i].l * wi, 0) / tw;
    accentStr = accentPx.length / n;
  }

  // ---- Bottom edge hue (last 10% of rows) — where the gradient meets article text ----
  const bottomPx = px.filter(p => p.row >= 0.90 && p.s >= 3);
  let bottomH = domH, bottomS = domS;
  if (bottomPx.length > 10) {
    const bw = bottomPx.map(p => p.s);
    bottomH = circularMean(bottomPx.map(p => p.h), bw);
    bottomS = clamp(pct(bottomPx.map(p => p.s), 0.25), 0, 60);
  }

  // ---- Darkest 10% colored ----
  const sortedL = [...px].sort((a, b) => a.l - b.l);
  const topN = Math.max(30, Math.floor(n * 0.10));
  const dc = sortedL.slice(0, topN).filter(p => p.s > 5);
  let darkH = 30, darkS = 5;
  if (dc.length > 10) {
    const w = dc.map(p => p.s);
    darkH = circularMean(dc.map(p => p.h), w); darkS = dc.reduce((s, p) => s + p.s, 0) / dc.length;
  }

  return { domH, domS, domL, bottomH, bottomS, bgH, bgS, accentH, accentS, accentL, accentStr, darkH, darkS,
    avgSat: px.reduce((s, p) => s + p.s, 0) / n, medianL: pct(px.map(p => p.l), 0.50) };
}

// ---- Strategy ----
type Strat = "achromatic" | "dominant_mid" | "light_bg" | "dark_bg";

function pickStrat(a: An): Strat {
  if (a.avgSat < 8) return "achromatic";
  if (a.medianL > 70) return "light_bg";
  if (a.domS >= 15 && a.domL >= 20 && a.domL <= 65) return "dominant_mid";
  if (a.domL < 20) {
    if (a.accentStr > 0.001 && a.accentS > 15) return "dark_bg";
    if (a.domS >= 15) return "dominant_mid";
    return "dark_bg";
  }
  return "dominant_mid";
}

// ---- Chroma helpers ----
function chromaS(origS: number, origL: number, newL: number) {
  const c = (origS / 100) * (1 - Math.abs(2 * origL / 100 - 1));
  const r = 1 - Math.abs(2 * newL / 100 - 1);
  return r < 0.01 ? 0 : clamp(c / r * 100, 0, 100);
}

function solveLightSL(h: number, origS: number, origL: number, targetRatio: number) {
  let s = origS, l = 85;
  for (let i = 0; i < 15; i++) {
    l = clamp(findMinL(h, s, LIGHT_TEXT, targetRatio), 70, 97);
    const ns = clamp(chromaS(origS, origL, l), 15, 100);
    if (Math.abs(ns - s) < 0.5) break;
    s = ns;
  }
  return { s, l };
}

// ---- Generation ----

function genDominantMid(a: An): ThemeColors {
  // If the bottom edge has a distinctly different hue, the image is multi-hue
  // (e.g. blue sky + green hill). Use bottom hue for dark, accent for light.
  const bottomDiffers = hueDist(a.bottomH, a.domH) > 40;

  let lightH: number, lightOrigS: number, lightOrigL: number;
  if (bottomDiffers && a.accentStr > 0.01 && a.accentS > 10) {
    lightH = a.accentH;
    lightOrigS = a.accentS;
    lightOrigL = a.accentL;
  } else {
    lightH = a.domH;
    lightOrigS = a.domS;
    lightOrigL = a.domL;
  }
  const { s, l } = solveLightSL(lightH, lightOrigS, lightOrigL, 9.5);

  const dh = bottomDiffers ? a.bottomH : a.domH;
  const ds = bottomDiffers ? clamp(a.bottomS * 1.5, 25, 100) : clamp(a.domS * 1.5, 25, 100);
  const dark = ensureDark({ h: dh, s: ds, l: 12 });
  return { light: rgbToHex(hslToRgb({ h: lightH, s, l })), dark: rgbToHex(hslToRgb(dark)) };
}

function genLightBg(a: An): ThemeColors {
  let lh = a.bgH, ls = clamp(a.bgS, 10, 50);
  if (a.bgS < 3) { lh = 40; ls = 15; }
  const ll = clamp(findMinL(lh, ls, LIGHT_TEXT, 12.0), 85, 97);

  let dh: number, ds: number, dl: number;
  const bgIsCool = a.bgH >= 180 && a.bgH <= 300;
  if (a.bgS >= 3 && bgIsCool) {
    // Cool background: use bottom edge hue (more accurate than avg bg) and slightly higher L
    dh = a.bottomH; ds = clamp(a.bottomS * 1.2, 15, 50); dl = 20;
  } else if (a.accentStr > 0.01 && a.accentS > 15) {
    dh = a.accentH; ds = clamp(a.accentS * 1.8, 25, 70); dl = 18;
  } else if (a.bgS >= 3) {
    dh = a.bgH; ds = clamp(a.bgS * 1.5, 15, 50); dl = 18;
  } else {
    dh = a.darkH; ds = clamp(a.darkS, 15, 50); dl = 18;
  }
  const dark = ensureDark({ h: dh, s: ds, l: dl });
  return { light: rgbToHex(hslToRgb({ h: lh, s: ls, l: ll })), dark: rgbToHex(hslToRgb(dark)) };
}

function genDarkBg(a: An): ThemeColors {
  let lh: number, ls: number, ll: number;
  if (a.accentStr > 0.001 && a.accentS > 15) {
    lh = a.accentH;
    if (a.accentStr > 0.05) {
      ls = clamp(a.accentS * 0.6, 15, 80);
    } else {
      ls = 100;
    }
    ll = 85;
    if (contrastRatio(hslToRgb({ h: lh, s: ls, l: ll }), LIGHT_TEXT) < 7.0)
      ll = clamp(findMinL(lh, ls, LIGHT_TEXT, 7.0), 75, 97);
  } else {
    lh = a.domH; ls = clamp(a.domS * 0.5, 10, 40);
    ll = clamp(findMinL(lh, ls, LIGHT_TEXT, 9.5), 75, 97);
  }

  const ds = clamp(a.domS * 1.5, 20, 100);
  // Higher domS → can go darker (color still visible); lower domS → keep lighter
  const darkL = clamp(14 - a.domS * 0.07, 6, 12);
  const dark = ensureDark({ h: a.domH, s: ds, l: darkL });
  return { light: rgbToHex(hslToRgb({ h: lh, s: ls, l: ll })), dark: rgbToHex(hslToRgb(dark)) };
}

function generate(a: An): ThemeColors {
  const st = pickStrat(a);
switch (st) {
    case "achromatic": return { light: "#FFFFFF", dark: "#2A2925" };
    case "dominant_mid": return genDominantMid(a);
    case "light_bg": return genLightBg(a);
    case "dark_bg": return genDarkBg(a);
  }
}

// ---- Main ----
export async function imageToColors(input: string | Buffer): Promise<ThemeColors> {
  const { data, info } = await sharp(input)
    .resize(150, 150, { fit: "inside" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const pixels: Px[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      pixels.push({ ...rgbToHsl({ r, g, b }), r, g, b, row: y / h, col: x / w });
    }
  return generate(analyze(pixels));
}
