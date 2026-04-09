import { RGB, rgbToHsl, HSL } from "./colorUtils";

export interface ColorCluster {
  centroid: RGB;
  hsl: HSL;
  population: number; // fraction of total pixels
}

/**
 * K-means++ initialization: pick initial centroids spread apart.
 */
function kmeansInit(pixels: RGB[], k: number): RGB[] {
  const centroids: RGB[] = [];
  // First centroid: random
  centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);

  for (let c = 1; c < k; c++) {
    // Compute distances to nearest existing centroid
    const dists = pixels.map((p) => {
      let minD = Infinity;
      for (const cent of centroids) {
        const d =
          (p.r - cent.r) ** 2 + (p.g - cent.g) ** 2 + (p.b - cent.b) ** 2;
        if (d < minD) minD = d;
      }
      return minD;
    });
    const totalDist = dists.reduce((a, b) => a + b, 0);
    if (totalDist === 0) {
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
      continue;
    }
    // Weighted random selection
    let r = Math.random() * totalDist;
    for (let i = 0; i < pixels.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        centroids.push(pixels[i]);
        break;
      }
    }
    if (centroids.length <= c) {
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
    }
  }
  return centroids;
}

/**
 * Run k-means clustering on pixel array.
 * Returns clusters sorted by population (descending).
 */
export function kMeans(pixels: RGB[], k: number, maxIter = 25): ColorCluster[] {
  if (pixels.length === 0) return [];
  const n = pixels.length;

  // Subsample if too many pixels (for speed)
  let sample = pixels;
  if (n > 20000) {
    const step = Math.floor(n / 20000);
    sample = pixels.filter((_, i) => i % step === 0);
  }

  let centroids = kmeansInit(sample, k);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign pixels to nearest centroid
    const assignments = new Array(k).fill(null).map(() => ({
      sumR: 0,
      sumG: 0,
      sumB: 0,
      count: 0,
    }));

    for (const p of sample) {
      let minD = Infinity;
      let bestC = 0;
      for (let c = 0; c < centroids.length; c++) {
        const d =
          (p.r - centroids[c].r) ** 2 +
          (p.g - centroids[c].g) ** 2 +
          (p.b - centroids[c].b) ** 2;
        if (d < minD) {
          minD = d;
          bestC = c;
        }
      }
      assignments[bestC].sumR += p.r;
      assignments[bestC].sumG += p.g;
      assignments[bestC].sumB += p.b;
      assignments[bestC].count++;
    }

    // Update centroids
    let changed = false;
    for (let c = 0; c < k; c++) {
      if (assignments[c].count === 0) continue;
      const newR = Math.round(assignments[c].sumR / assignments[c].count);
      const newG = Math.round(assignments[c].sumG / assignments[c].count);
      const newB = Math.round(assignments[c].sumB / assignments[c].count);
      if (
        newR !== centroids[c].r ||
        newG !== centroids[c].g ||
        newB !== centroids[c].b
      ) {
        changed = true;
        centroids[c] = { r: newR, g: newG, b: newB };
      }
    }
    if (!changed) break;
  }

  // Final assignment to compute populations (on full pixel set)
  const pops = new Array(k).fill(0);
  for (const p of pixels) {
    let minD = Infinity;
    let bestC = 0;
    for (let c = 0; c < centroids.length; c++) {
      const d =
        (p.r - centroids[c].r) ** 2 +
        (p.g - centroids[c].g) ** 2 +
        (p.b - centroids[c].b) ** 2;
      if (d < minD) {
        minD = d;
        bestC = c;
      }
    }
    pops[bestC]++;
  }

  const total = pixels.length;
  return centroids
    .map((c, i) => ({
      centroid: c,
      hsl: rgbToHsl(c),
      population: pops[i] / total,
    }))
    .filter((c) => c.population > 0.01) // filter tiny clusters
    .sort((a, b) => b.population - a.population);
}

/**
 * Extract pixels from raw image buffer (RGBA).
 * Applies vertical weighting: bottom rows get more weight (duplicated).
 */
export function extractWeightedPixels(
  data: Buffer,
  width: number,
  height: number,
  bottomWeight: number = 2
): RGB[] {
  const pixels: RGB[] = [];
  const bottomStart = Math.floor(height * 0.5); // bottom 50%

  for (let y = 0; y < height; y++) {
    const isBottom = y >= bottomStart;
    const weight = isBottom ? bottomWeight : 1;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Skip fully transparent pixels
      if (data[idx + 3] < 128) continue;
      const pixel = { r, g, b };
      for (let w = 0; w < weight; w++) {
        pixels.push(pixel);
      }
    }
  }
  return pixels;
}

/**
 * Extract all pixels from raw image buffer (RGBA), no weighting.
 */
export function extractAllPixels(
  data: Buffer,
  width: number,
  height: number
): RGB[] {
  const pixels: RGB[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 128) continue;
      pixels.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  return pixels;
}
