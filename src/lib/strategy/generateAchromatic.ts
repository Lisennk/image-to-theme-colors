import { BaseColors } from "../composeArticleTheme";

/** Achromatic images (B&W, grayscale) → pure white and warm near-black. */
export function generateAchromatic(): BaseColors {
  return { light: "#FFFFFF", dark: "#2A2925" };
}
