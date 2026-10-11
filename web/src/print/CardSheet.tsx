import { LAYOUTS, PAGE_MARGIN_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM, type CardsPerPage } from './layouts';
import type { PrintBrand } from './brand';
import { VoucherCard, type CardData } from './VoucherCard';

/** Splits cards into A4 pages; each page is a fixed grid, so no card is ever split across pages. */
export function CardSheet({ cards, perPage, brand }: { cards: CardData[]; perPage: CardsPerPage; brand: PrintBrand }) {
  const layout = LAYOUTS[perPage];
  const pages: CardData[][] = [];
  for (let i = 0; i < cards.length; i += perPage) pages.push(cards.slice(i, i + perPage));

  return (
    <div className="card-sheet">
      <style>{`
        @page { size: A4 portrait; margin: ${PAGE_MARGIN_MM}mm; }
        .card-sheet .sheet-paper { width: 210mm; padding: ${PAGE_MARGIN_MM}mm; margin: 0 auto 16px; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); box-sizing: border-box; }
        @media print {
          .card-sheet .sheet-paper { width: auto; padding: 0; margin: 0; box-shadow: none; break-after: page; }
          .card-sheet .sheet-paper:last-child { break-after: auto; }
        }
      `}</style>
      {pages.map((page, index) => (
        <div key={index} className="sheet-paper">
          <div
            style={{
              width: `${SHEET_WIDTH_MM}mm`,
              height: `${SHEET_HEIGHT_MM}mm`,
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
              gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
              overflow: 'hidden',
            }}
          >
            {page.map((card) => (
              <VoucherCard key={card.id} card={card} layout={layout} brand={brand} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
