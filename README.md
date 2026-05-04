# image-to-theme-colors

Extract accessible light and dark theme colors from any image. Designed for an article system where:

- The **article body** (open state) shows a hero image transitioning into a colored background via a gradient.
- A **feed card** (closed state) sits on a feed background and previews the article's color, with a circular control (e.g. a like button) drawn on top.

Given an image, the algorithm analyzes its color composition and outputs:

- `body.background` — solid color and gradient for the open-state article background, with WCAG AAA (7:1) contrast against your text colors.
- `card.background` — solid color and gradient for the feed card surface, with sufficient contrast against your feed background (1.15:1 light, 1.12:1 dark).
- `card.content` — color for circular controls / icons sitting on the card, with WCAG AA (4.5:1) contrast against the card surface.
- `card.text` — title (AAA / 7:1) and subtitle (6:1) text colors echoed back from the inputs.

…all on a shared hue per theme so the body, card, icon, and text read as one color family.

![Examples showing light and dark theme colors extracted from four different images](https://raw.githubusercontent.com/Lisennk/image-to-theme-colors/master/assets/examples.png)

## Install

```bash
npm install image-to-theme-colors
```

Requires Node.js 18+ and [sharp](https://sharp.pixelplumbing.com/) (installed automatically).

## Quick start

```ts
import { imageToColors } from "image-to-theme-colors";

const result = await imageToColors("./hero.jpg");
// result.themes.light.body.background.color           "#C0D0FF"
// result.themes.light.body.background.linearGradient  ["#C0D0FF", "#BAC9F9"]
// result.themes.light.card.background.color           "#D5E2ED"
// result.themes.light.card.background.linearGradient  ["#D5E2ED", "#B2CADD"]
// result.themes.light.card.content.color              "#4F6678"
// result.themes.light.card.text.title                 "#2A2925"
// result.themes.light.card.text.subtitle              "#51504D"
// result.themes.dark.body.background.color            "#0F172F"
// …
```

## API

### `imageToColors(input, options?)`

Analyzes an image and returns body and card colors for light and dark themes.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string \| Buffer` | File path or image buffer |
| `options` | `ImageToColorsOptions` | Optional configuration |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lightThemeTextColor` | `string` | `"#2A2925"` | Text color on the light body background. The body background guarantees 7:1 contrast against this. |
| `darkThemeTextColor` | `string` | `"#FFFFFF"` | Text color on the dark body background. The body background guarantees 7:1 contrast against this. |
| `lightThemeFeedBackgroundColor` | `string` | `"#F0F0F0"` | Feed (page) background behind cards on the light theme. The card background guarantees 1.15:1 contrast against this. |
| `darkThemeFeedBackgroundColor` | `string` | `"#110F0E"` | Feed (page) background behind cards on the dark theme. The card background guarantees 1.12:1 contrast against this. |
| `lightThemeCardTitleColor` | `string` | `"#2A2925"` | Title text color on light-theme cards. The card guarantees 7:1 (AAA) contrast against this. |
| `lightThemeCardSubtitleColor` | `string` | `"#51504D"` | Subtitle text color on light-theme cards. The card guarantees 6:1 contrast against this. |
| `darkThemeCardTitleColor` | `string` | `"#FCFCFC"` | Title text color on dark-theme cards. The card guarantees 7:1 (AAA) contrast against this. |
| `darkThemeCardSubtitleColor` | `string` | `"#A09F9E"` | Subtitle text color on dark-theme cards. The card guarantees 6:1 contrast against this. |

**Returns:** `Promise<ImageToColorsResult>`

```ts
interface ImageToColorsResult {
  themes: {
    light: ThemeColors;
    dark: ThemeColors;
  };
}

interface ThemeColors {
  body: { background: BackgroundColors };
  card: {
    background: BackgroundColors;
    content: { color: string };
    text: { title: string; subtitle: string };
  };
}

interface BackgroundColors {
  color: string;                     // solid background, e.g. "#C0D0FF"
  linearGradient: [string, string];  // gradient stops, e.g. ["#C0D0FF", "#BAC9F9"]
}
```

### Examples

With custom text and feed colors:

```ts
const result = await imageToColors(buffer, {
  lightThemeTextColor: "#1A1A1A",
  darkThemeTextColor: "#F0F0F0",
  lightThemeFeedBackgroundColor: "#F5F5F5",
  darkThemeFeedBackgroundColor: "#0A0A0A",
});
```

Using the gradient in CSS:

```ts
const { light } = (await imageToColors("./hero.jpg")).themes;

// open-state body
articleEl.style.backgroundColor = light.body.background.color;
articleEl.style.backgroundImage =
  `linear-gradient(to bottom, ${light.body.background.linearGradient[0]}, ${light.body.background.linearGradient[1]})`;

// feed card
cardEl.style.backgroundColor = light.card.background.color;
cardEl.style.backgroundImage =
  `linear-gradient(to bottom, ${light.card.background.linearGradient[0]}, ${light.card.background.linearGradient[1]})`;

// like button on the card
likeBtnEl.style.color = light.card.content.color;
```

From an HTTP upload (Express + multer):

```ts
app.post("/upload", upload.single("image"), async (req, res) => {
  const colors = await imageToColors(req.file.buffer);
  res.json(colors);
});
```

## How it works

The algorithm runs in four phases:

**1. Pixel extraction** — Resizes the image to 150px (preserving aspect ratio) and converts to HSL pixel data.

**2. Analysis** — Builds a hue histogram with extra weight on border/edge pixels (which are more likely to be the image background rather than the subject). Also detects accent colors, background tints, and bottom-edge colors for gradient transitions.

**3. Strategy selection** — Picks one of four approaches based on the image:

| Strategy | Trigger | Example |
|----------|---------|---------|
| **Achromatic** | Average saturation < 8% | B&W line art |
| **Dominant mid-tone** | Clear mid-tone color dominates | Green painting, blue illustration |
| **Light background** | Median lightness > 70% | Person on white/pastel background |
| **Dark background** | Mostly dark with bright accent | Night sky with a star |

**4. Color generation** — Produces the body colors using chroma-preserving lightness adjustment, iterative S/L co-solving, and WCAG AAA contrast enforcement, then derives the card colors from the body's hue:

- **Card background:** the lightest tint (light theme) / darkest shade (dark theme) that still clears the feed-background contrast budget *and* the title (7:1) + subtitle (6:1) contrast budgets. If those constraints conflict (text-readability requires a card too close in luminance to the feed bg), text wins and feed contrast may dip below its budget.
- **Card content:** the same hue at the opposite end of the L scale, sized to clear AA (4.5:1) icon contrast against the card surface.
- **Card text:** the configured title and subtitle hex values are echoed back as `card.text.{title, subtitle}` so consumers don't need to thread defaults manually.

### Design decisions

- **Background-first**: Border and bottom-edge pixels are weighted higher because the gradient transitions from the bottom of the image into the article text. The algorithm prioritizes the image's background color over foreground subjects.

- **Foreground detection**: When a foreground object extends to the bottom edge (e.g. hands), the algorithm detects this by checking whether the bottom color is concentrated at the bottom (background) or spread through the image (foreground).

- **Multi-hue images**: When the bottom edge has a distinctly different color from the dominant (e.g. green hill below blue sky), the algorithm uses the bottom color for the dark theme and the accent for the light theme.

- **Card hue follows body**: The feed card never invents its own hue — it inherits from the body so that the closed-state preview, the open-state background, and the icon all read as the same color family.

## Performance

Processing a single image takes **50–100ms** on a modern CPU. The algorithm is fully CPU-bound (no GPU required).

## Development

```bash
git clone <repo-url>
cd image-to-theme-colors
npm install
```

**Run the validation suite** against the 10 reference examples:

```bash
npm run dev:validate
```

**Start the batch preview server** to test multiple images at once:

```bash
npm run dev:server
# Open http://localhost:3000
```

**Start the card+article demo** (single image, full card and open-state preview, with copy-to-clipboard hex outputs):

```bash
npm run dev:demo
# Open http://localhost:3030
```

**Build the library:**

```bash
npm run build
```

## License

MIT
