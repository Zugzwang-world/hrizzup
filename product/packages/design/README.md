# @hrizzup/design: the design values

Every colour, typeface, text style, spacing, corner and icon the website and the app use, defined once (PLAN.md section 3, "Design", and step 1.4). Both surfaces read them from here, so one change reaches every screen on both.

## What's here

| File                     | What it holds                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`           | The shape of the values: the colour roles (shadcn/ui's names plus Hrizzup's own), each category's look, the typefaces, the text styles, spacing, corners, cards, icons and motion            |
| `src/directions/`        | One full set of values per design direction. Step 1.4's first pass compares three; once the founder chooses, the others go (the design log keeps what they were)                             |
| `src/values.ts`          | Which direction is active: the values every screen reads                                                                                                                                     |
| `src/icon-names.ts`      | Every icon in use, by its name in [Lucide](https://lucide.dev) (ISC licence)                                                                                                                 |
| `src/icons.generated.ts` | Those icons' drawings, copied from Lucide (written by the script below)                                                                                                                      |
| `src/contrast.ts`        | The readable-text check: every text colour on every background the screens use, in light and dark, must reach WCAG's 4.5 to 1                                                                |
| `src/css.ts`             | Turns the values into the website's CSS                                                                                                                                                      |
| `tokens.css`             | That CSS, written by the script below: custom properties for light and dark (following the device's setting), the names Tailwind and shadcn/ui read, and one `type-…` utility per text style |
| `LICENSE-lucide.txt`     | Lucide's licence, kept next to the icons copied from it                                                                                                                                      |

## How each surface reads them

- **The website** imports `@hrizzup/design/tokens.css` into its stylesheet, then uses ordinary Tailwind classes: `bg-background`, `text-muted-foreground`, `px-gutter`, `rounded-card`, `type-headline`. shadcn/ui's components work unchanged, because the colour roles carry its names. Each typeface is loaded by `next/font` under the CSS variable `fontVariable()` names (`--font-eczar`, `--font-anek-latin`).
- **The app** imports `values` and picks `light` or `dark` with React Native's `useColorScheme()`. Sizes are in pixels at the default text size, which React Native scales with the phone's text-size setting.

## Changing a value

1. Change it in the direction's file in `src/directions/` (or the icon list in `src/icon-names.ts`).
2. Run `pnpm --filter @hrizzup/design write`, which rewrites `tokens.css` and `src/icons.generated.ts`.
3. Add a line to the design log (`docs/design/log.md`): what changed, why, and which reference it came from.

The Quick checks fail while `tokens.css` or the icons are out of date, while any text colour is below 4.5 to 1 in light or dark, or while the categories differ from the hand-over agreement's list.
