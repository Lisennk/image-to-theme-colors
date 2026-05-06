import path from "path";
import sharp from "sharp";
import { imageToColors } from "../lib";
import { hexToRgb, rgbToHex } from "../lib/color/conversion";
import { contrastRatio } from "../lib/color/contrast";
import { RGB } from "../lib/color/types";
import { estimateGlassColor } from "../lib/strategy/generateAccent";

interface Example {
  id: number | string;
  image: string;
  synthetic?: { rgb: RGB; size?: number };
}

const examples: Example[] = [
  { id: 1, image: "1.png" },
  { id: 2, image: "2.jpg" },
  { id: 3, image: "3.jpg" },
  { id: 4, image: "4.png" },
  { id: 5, image: "5.jpg" },
  { id: 6, image: "6.jpg" },
  { id: 7, image: "7.jpg" },
  { id: 8, image: "8.jpg" },
  { id: 9, image: "9.jpg" },
  { id: 10, image: "10.jpg" },
  { id: "all-black", image: "syn-black", synthetic: { rgb: { r: 0, g: 0, b: 0 } } },
  { id: "all-white", image: "syn-white", synthetic: { rgb: { r: 255, g: 255, b: 255 } } },
  { id: "all-mid-gray", image: "syn-gray", synthetic: { rgb: { r: 128, g: 128, b: 128 } } },
  { id: "deep-blue", image: "syn-blue", synthetic: { rgb: { r: 0, g: 16, b: 26 } } },
  { id: "vivid-red", image: "syn-red", synthetic: { rgb: { r: 200, g: 30, b: 40 } } },
];

const TARGET = 4.5;
const MIN = 3.0;

async function loadInput(ex: Example): Promise<string | Buffer> {
  if (ex.synthetic) {
    const { rgb, size = 200 } = ex.synthetic;
    return sharp({
      create: { width: size, height: size, channels: 3, background: { r: rgb.r, g: rgb.g, b: rgb.b } },
    }).png().toBuffer();
  }
  return path.resolve(__dirname, "../../examples", ex.image);
}

async function controlAreaColor(input: string | Buffer): Promise<RGB> {
  const { data, info } = await sharp(input)
    .resize(150, 150, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let n = 0, sR = 0, sG = 0, sB = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      if (data[off + 3] < 128) continue;
      if (y / height < 0.2 && x / width > 0.5) {
        sR += data[off]; sG += data[off + 1]; sB += data[off + 2]; n++;
      }
    }
  }
  if (n < 10) {
    n = 0; sR = sG = sB = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      if (data[off + 3] < 128) continue;
      sR += data[off]; sG += data[off + 1]; sB += data[off + 2]; n++;
    }
  }
  return { r: Math.round(sR / n), g: Math.round(sG / n), b: Math.round(sB / n) };
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const fmt = (c: number, min: number) => `${c.toFixed(2)}:1 ${c >= min ? "✓" : "✗"}`;

interface ThemeRow {
  body: string;
  glassImg: string;
  glassBody: string;
  overImage: string;
  overBody: string;
  cImg: number;
  cBody: number;
}

interface Row {
  ex: string;
  imgArea: string;
  light: ThemeRow;
  dark: ThemeRow;
}

async function validate() {
  const rows: Row[] = [];
  let lImgOk = 0, lBodyOk = 0, dImgOk = 0, dBodyOk = 0;
  let lImgAaa = 0, lBodyAaa = 0, dImgAaa = 0, dBodyAaa = 0;

  for (const ex of examples) {
    const input = await loadInput(ex);
    const result = await imageToColors(input);
    const imgRef = await controlAreaColor(input);

    const lBody = result.themes.light.body.background.baseColor;
    const lAcc = result.themes.light.body.content.accentColor;
    const dBody = result.themes.dark.body.background.baseColor;
    const dAcc = result.themes.dark.body.content.accentColor;

    const glassImg = estimateGlassColor(imgRef);
    const lGlassBody = estimateGlassColor(hexToRgb(lBody));
    const dGlassBody = estimateGlassColor(hexToRgb(dBody));

    const lcImg = contrastRatio(hexToRgb(lAcc.overImage), glassImg);
    const lcBody = contrastRatio(hexToRgb(lAcc.overBody), lGlassBody);
    const dcImg = contrastRatio(hexToRgb(dAcc.overImage), glassImg);
    const dcBody = contrastRatio(hexToRgb(dAcc.overBody), dGlassBody);

    if (lcImg >= MIN) lImgOk++;
    if (lcBody >= MIN) lBodyOk++;
    if (dcImg >= MIN) dImgOk++;
    if (dcBody >= MIN) dBodyOk++;
    if (lcImg >= 7) lImgAaa++;
    if (lcBody >= 7) lBodyAaa++;
    if (dcImg >= 7) dImgAaa++;
    if (dcBody >= 7) dBodyAaa++;

    rows.push({
      ex: String(ex.id),
      imgArea: rgbToHex(imgRef),
      light: {
        body: lBody, glassImg: rgbToHex(glassImg), glassBody: rgbToHex(lGlassBody),
        overImage: lAcc.overImage, overBody: lAcc.overBody, cImg: lcImg, cBody: lcBody,
      },
      dark: {
        body: dBody, glassImg: rgbToHex(glassImg), glassBody: rgbToHex(dGlassBody),
        overImage: dAcc.overImage, overBody: dAcc.overBody, cImg: dcImg, cBody: dcBody,
      },
    });
  }

  console.log("LIGHT THEME");
  console.log(
    pad("Ex", 12) + pad("imgArea", 10) + pad("body", 10) +
    pad("glass(img)", 12) + pad("ovImg accent", 14) + pad("vs glass", 12) +
    pad("glass(body)", 13) + pad("ovBody accent", 15) + pad("vs glass", 12)
  );
  console.log("─".repeat(110));
  for (const r of rows) {
    console.log(
      pad(r.ex, 12) + pad(r.imgArea, 10) + pad(r.light.body, 10) +
      pad(r.light.glassImg, 12) + pad(r.light.overImage, 14) + pad(fmt(r.light.cImg, MIN), 12) +
      pad(r.light.glassBody, 13) + pad(r.light.overBody, 15) + pad(fmt(r.light.cBody, MIN), 12)
    );
  }
  console.log();
  console.log("DARK THEME");
  console.log(
    pad("Ex", 12) + pad("imgArea", 10) + pad("body", 10) +
    pad("glass(img)", 12) + pad("ovImg accent", 14) + pad("vs glass", 12) +
    pad("glass(body)", 13) + pad("ovBody accent", 15) + pad("vs glass", 12)
  );
  console.log("─".repeat(110));
  for (const r of rows) {
    console.log(
      pad(r.ex, 12) + pad(r.imgArea, 10) + pad(r.dark.body, 10) +
      pad(r.dark.glassImg, 12) + pad(r.dark.overImage, 14) + pad(fmt(r.dark.cImg, MIN), 12) +
      pad(r.dark.glassBody, 13) + pad(r.dark.overBody, 15) + pad(fmt(r.dark.cBody, MIN), 12)
    );
  }

  const total = rows.length;
  console.log();
  console.log(`Light  vs glass(img):  ${lImgOk}/${total} ≥3:1   AAA ${lImgAaa}/${total}`);
  console.log(`Light  vs glass(body): ${lBodyOk}/${total} ≥3:1   AAA ${lBodyAaa}/${total}`);
  console.log(`Dark   vs glass(img):  ${dImgOk}/${total} ≥3:1   AAA ${dImgAaa}/${total}`);
  console.log(`Dark   vs glass(body): ${dBodyOk}/${total} ≥3:1   AAA ${dBodyAaa}/${total}`);

  const fails: string[] = [];
  for (const r of rows) {
    if (r.light.cImg < MIN) fails.push(`${r.ex} L over-image ${r.light.cImg.toFixed(2)}`);
    if (r.light.cBody < MIN) fails.push(`${r.ex} L over-body ${r.light.cBody.toFixed(2)}`);
    if (r.dark.cImg < MIN) fails.push(`${r.ex} D over-image ${r.dark.cImg.toFixed(2)}`);
    if (r.dark.cBody < MIN) fails.push(`${r.ex} D over-body ${r.dark.cBody.toFixed(2)}`);
  }
  if (fails.length) {
    console.log("\nFails (< 3:1):");
    for (const f of fails) console.log("  " + f);
  } else {
    console.log("\nAll ≥ 3:1.");
  }
}

validate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
