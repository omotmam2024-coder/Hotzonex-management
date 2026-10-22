export type CardsPerPage = 24 | 40 | 50;

/** Fixed millimetre layouts of portrait cards inside an A4 page with 8 mm margins (194 × 281 mm usable). */
export interface SheetLayout {
  perPage: CardsPerPage;
  cols: number;
  rows: number;
  /** Largest code that still fits at the code font size. */
  maxCodeLength: number;
  codePt: number;
  /** The WiFi name under the logo. */
  namePt: number;
  pricePt: number;
  /** The time pill and the "WiFi code" label. */
  smallPt: number;
  /** The login address at the bottom. */
  footPt: number;
  /** Height of the coloured top with the logo and WiFi name. */
  headMm: number;
  /** Diameter of the white circle the logo sits in. */
  logoMm: number;
  padMm: number;
  /** Gap between the dashed cut line and the card's rounded frame. */
  insetMm: number;
}

export const PAGE_MARGIN_MM = 8;
// 1 mm below the 281 mm usable height so rounding never pushes a row onto a new page.
export const SHEET_WIDTH_MM = 194;
export const SHEET_HEIGHT_MM = 280;

// Code sizes: Arial bold digits are 0.556 em wide, so codePt × 0.63 × maxCodeLength (room for the box) fits the card's inner width.
export const LAYOUTS: Record<CardsPerPage, SheetLayout> = {
  // 32 × 70 mm
  24: { perPage: 24, cols: 6, rows: 4, maxCodeLength: 10, codePt: 11.5, namePt: 8, pricePt: 13, smallPt: 6.5, footPt: 5.8, headMm: 25, logoMm: 11, padMm: 1.8, insetMm: 1 },
  // 24 × 56 mm
  40: { perPage: 40, cols: 8, rows: 5, maxCodeLength: 10, codePt: 8.6, namePt: 6.3, pricePt: 10, smallPt: 5.4, footPt: 4.8, headMm: 19.5, logoMm: 8.5, padMm: 1.2, insetMm: 0.7 },
  // 19 × 56 mm
  50: { perPage: 50, cols: 10, rows: 5, maxCodeLength: 8, codePt: 8.6, namePt: 5.6, pricePt: 8, smallPt: 5, footPt: 4.4, headMm: 18.5, logoMm: 7.5, padMm: 1, insetMm: 0.6 },
};
