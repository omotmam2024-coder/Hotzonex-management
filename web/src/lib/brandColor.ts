/** The Hotzonex blue: used when a business has not chosen a brand colour. */
export const DEFAULT_BRAND_COLOR = '#15479c';

const HEX_RE = /^#[0-9a-f]{6}$/;

/** '#RRGGBB' in lower case, or null when the text is not a full 6-digit colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return HEX_RE.test(v) ? v : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of white text on this colour (1 to 21). The Buy page header writes white text on it. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** True when white text on this colour is easy to read (WCAG AA, 4.5:1). */
export function isReadableBrand(hex: string): boolean {
  return contrastWithWhite(hex) >= 4.5;
}

/** The colour mixed with black (0 = unchanged, 1 = black): the dark end of a gradient. */
export function darken(hex: string, amount: number): string {
  const k = 1 - Math.min(Math.max(amount, 0), 1);
  return `#${channels(hex)
    .map((c) => Math.round(c * k).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** CSS background for a page header in the business's colour (the default blue when none). */
export function brandBackground(hex: string | null | undefined): string {
  const base = normalizeHex(hex) ?? DEFAULT_BRAND_COLOR;
  return `linear-gradient(135deg, ${base}, ${darken(base, 0.6)})`;
}
