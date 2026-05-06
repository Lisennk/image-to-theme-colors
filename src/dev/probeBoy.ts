import path from "path";
import sharp from "sharp";
import { composeArticleTheme } from "../lib";
import { hexToRgb, rgbToHex } from "../lib/color/conversion";
import { contrastRatio } from "../lib/color/contrast";
import { RGB } from "../lib/color/types";
import { estimateGlassColor } from "../lib/strategy/generateAccent";
import { compositeLabelBackground } from "../lib/strategy/generateLabel";

interface RegionAvg {
  control: RGB;
  lower: RGB;
}

async function sampleRegions(input: string): Promise<RegionAvg> {
  const { data, info } = await sharp(input)
    .resize(150, 150, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let cN = 0, cR = 0, cG = 0, cB = 0;
  let lN = 0, lR = 0, lG = 0, lB = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      if (data[off + 3] < 128) continue;
      const r = y / height, c = x / width;
      if (r < 0.2 && c > 0.5) {
        cR += data[off]; cG += data[off + 1]; cB += data[off + 2]; cN++;
      }
      if (r > 0.8) {
        lR += data[off]; lG += data[off + 1]; lB += data[off + 2]; lN++;
      }
    }
  }
  return {
    control: { r: Math.round(cR / cN), g: Math.round(cG / cN), b: Math.round(cB / cN) },
    lower: { r: Math.round(lR / lN), g: Math.round(lG / lN), b: Math.round(lB / lN) },
  };
}

(async () => {
  const file = path.resolve(__dirname, "../../boy-dark.png");
  const result = await composeArticleTheme(file);
  const { control, lower } = await sampleRegions(file);

  const lb = result.themes.light.body.background.baseColor;
  const la = result.themes.light.body.content.accentColor;
  const ll = result.themes.light.body.content.labelColor;
  const db = result.themes.dark.body.background.baseColor;
  const da = result.themes.dark.body.content.accentColor;
  const dl = result.themes.dark.body.content.labelColor;

  const glassImg = estimateGlassColor(control);
  const lGlassBody = estimateGlassColor(hexToRgb(lb));
  const dGlassBody = estimateGlassColor(hexToRgb(db));

  const lLabelBg = compositeLabelBackground(hexToRgb(lb), lower);
  const dLabelBg = compositeLabelBackground(hexToRgb(db), lower);

  console.log("Image control-area avg:", rgbToHex(control));
  console.log("Image lower-area  avg:", rgbToHex(lower));
  console.log();
  console.log("Glass over image:", rgbToHex(glassImg), " (theme-independent)");
  console.log();
  console.log("LIGHT");
  console.log("  body:           ", lb, " glass:", rgbToHex(lGlassBody));
  console.log("  accent overImg: ", la.overImage,
    " contrast vs glass(image):", contrastRatio(hexToRgb(la.overImage), glassImg).toFixed(2) + ":1");
  console.log("  accent overBody:", la.overBody,
    " contrast vs glass(body): ", contrastRatio(hexToRgb(la.overBody), lGlassBody).toFixed(2) + ":1");
  console.log("  label:          ", ll,
    " labelBg:", rgbToHex(lLabelBg),
    " contrast:", contrastRatio(hexToRgb(ll), lLabelBg).toFixed(2) + ":1");
  console.log("    designer ref:  label #214154 on bg #8EABBB (4.46:1)");
  console.log();
  console.log("DARK");
  console.log("  body:           ", db, " glass:", rgbToHex(dGlassBody));
  console.log("  accent overImg: ", da.overImage,
    " contrast vs glass(image):", contrastRatio(hexToRgb(da.overImage), glassImg).toFixed(2) + ":1");
  console.log("  accent overBody:", da.overBody,
    " contrast vs glass(body): ", contrastRatio(hexToRgb(da.overBody), dGlassBody).toFixed(2) + ":1");
  console.log("  label:          ", dl,
    " labelBg:", rgbToHex(dLabelBg),
    " contrast:", contrastRatio(hexToRgb(dl), dLabelBg).toFixed(2) + ":1");
  console.log("    designer ref:  label #869DAC on bg #152F40 (4.91:1)");
})();
