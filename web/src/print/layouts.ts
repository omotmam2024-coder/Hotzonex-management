export type CardsPerPage = 24 | 40 | 50;

/** Fixed millimetre layouts inside an A4 page with 8 mm margins (194 × 281 mm usable). */
export interface SheetLayout {
  perPage: CardsPerPage;
  cols: number;
  rows: number;
  /** Largest code that still fits at the code font size. */
  maxCodeLength: number;
  codePt: number;
  sitePt: number;
  pricePt: number;
  smallPt: number;
  qrMm: number;
  barMm: number;
  padMm: number;
  /** Height of the business logo in the card's top line. */
  logoMm: number;
}

export const PAGE_MARGIN_MM = 8;
// 1 mm below the 281 mm usable height so rounding never pushes a row onto a new page.
export const SHEET_WIDTH_MM = 194;
export const SHEET_HEIGHT_MM = 280;

export const LAYOUTS: Record<CardsPerPage, SheetLayout> = {
  24: { perPage: 24, cols: 3, rows: 8, maxCodeLength: 10, codePt: 26, sitePt: 7.5, pricePt: 10, smallPt: 7, qrMm: 15, barMm: 2.5, padMm: 1.6, logoMm: 4.2 },
  40: { perPage: 40, cols: 4, rows: 10, maxCodeLength: 10, codePt: 22, sitePt: 6, pricePt: 7.5, smallPt: 6, qrMm: 11, barMm: 1.8, padMm: 1.2, logoMm: 3.4 },
  50: { perPage: 50, cols: 5, rows: 10, maxCodeLength: 8, codePt: 22, sitePt: 5.5, pricePt: 6.8, smallPt: 5.5, qrMm: 10.5, barMm: 1.8, padMm: 1.2, logoMm: 3.4 },
};
