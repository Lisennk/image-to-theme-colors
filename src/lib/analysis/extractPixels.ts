import sharp from "sharp";
import { rgbToHsl } from "../color/conversion";
import { PixelData } from "./types";

/**
 * Extract per-pixel data from an image. Resizes to ≤150×150 (preserving
 * aspect ratio), honors EXIF orientation, drops mostly-transparent
 * pixels, and dampens HSL saturation at extreme L values where it's
 * numerically unstable.
 *
 * Shared by both `composeArticleTheme` and `composeAffirmationTheme`.
 *
 * @param input File path or image buffer.
 * @returns     One `PixelData` per pixel above the alpha threshold,
 *              with `row` and `col` normalized to `[0, 1]`.
 */
export async function extractPixels(
  input: string | Buffer
): Promise<PixelData[]> {
  // `.rotate()` with no argument applies the EXIF orientation tag and
  // then strips it. Without this, a portrait phone photo saved sideways
  // would have its top/bottom regions sampled from the wrong edges.
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
      // HSL saturation is unstable at extreme lightness: a 1/255
      // channel difference in a near-white pixel produces ~100% S.
      // Dampen S when L is within 5% of either end so these pixels
      // read as achromatic.
      if (hsl.l > 95) hsl.s *= (100 - hsl.l) / 5;
      else if (hsl.l < 5) hsl.s *= hsl.l / 5;
      pixels.push({ ...hsl, r, g, b, row: y / height, col: x / width });
    }
  }
  return pixels;
}
