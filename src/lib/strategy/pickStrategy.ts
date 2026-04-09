import { ImageAnalysis } from "../analysis/types";
import { ThemeStrategy } from "./types";

/**
 * Select the best color-generation strategy based on image analysis.
 *
 * Decision tree:
 * 1. Very low saturation → achromatic (B&W / grayscale)
 * 2. Bright image (median L > 70%) → light_bg (use the background tint)
 * 3. Mid-tone dominant with decent saturation → dominant_mid
 * 4. Dark dominant with a bright accent → dark_bg (amplify the accent)
 * 5. Dark dominant without accent but colored → dominant_mid (stretch the hue)
 */
export function pickStrategy(analysis: ImageAnalysis): ThemeStrategy {
  if (analysis.averageSaturation < 8) return "achromatic";
  if (analysis.medianLightness > 70) return "light_bg";

  if (
    analysis.dominantSaturation >= 15 &&
    analysis.dominantLightness >= 20 &&
    analysis.dominantLightness <= 65
  ) {
    return "dominant_mid";
  }

  if (analysis.dominantLightness < 20) {
    if (analysis.accentStrength > 0.001 && analysis.accentSaturation > 15)
      return "dark_bg";
    if (analysis.dominantSaturation >= 15) return "dominant_mid";
    return "dark_bg";
  }

  return "dominant_mid";
}
