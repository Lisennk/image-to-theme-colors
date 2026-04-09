import { RGB } from "../color/types";

/** Runtime context passed to all strategy generators. */
export interface GenerationContext {
  /** Text color for the light theme background (for WCAG contrast checks). */
  lightText: RGB;
  /** Text color for the dark theme background (for WCAG contrast checks). */
  darkText: RGB;
}
