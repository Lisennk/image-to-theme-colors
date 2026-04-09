/** Clamp a value to the [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Circular distance between two hue angles (0–360). Returns 0–180. */
export function hueDistance(hueA: number, hueB: number): number {
  const d = Math.abs(hueA - hueB);
  return d > 180 ? 360 - d : d;
}

/** Weighted circular mean of hue angles (in degrees). */
export function circularWeightedMean(hues: number[], weights: number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < hues.length; i++) {
    if (weights[i] <= 0) continue;
    const rad = (hues[i] * Math.PI) / 180;
    sinSum += weights[i] * Math.sin(rad);
    cosSum += weights[i] * Math.cos(rad);
    totalWeight += weights[i];
  }
  if (totalWeight === 0) return 0;
  let angle =
    (Math.atan2(sinSum / totalWeight, cosSum / totalWeight) * 180) / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

/** Compute the p-th percentile (0–1) of a numeric array via linear interpolation. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi
    ? sorted[lo]
    : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}
