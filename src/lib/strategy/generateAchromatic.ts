import { ThemeColors } from "../imageToColors";

/** Achromatic images (B&W, grayscale) → pure white and warm near-black. */
export function generateAchromatic(): ThemeColors {
  return { light: "#FFFFFF", dark: "#2A2925" };
}
