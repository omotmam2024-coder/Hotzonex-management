import { formatDuration, formatSSP } from '../lib/format';
import type { PrintBrand } from './brand';
import type { SheetLayout } from './layouts';
import { QrCode } from './QrCode';
import { loginAddress, loginUrl } from './voucherLinks';

export interface CardData {
  id: string;
  code: string;
  siteName: string;
  dnsName: string;
  planColor: string;
  priceSsp: number;
  uptimeSeconds: number;
}

const FONT = 'Arial, Helvetica, sans-serif';

/** One cut-out voucher card. All sizes are physical (mm / pt) so print output is exact. */
export function VoucherCard({ card, layout, brand }: { card: CardData; layout: SheetLayout; brand: PrintBrand }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        border: '0.2mm dashed #9ca3af',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        breakInside: 'avoid',
        fontFamily: FONT,
        color: '#000',
        background: '#fff',
      }}
    >
      <div style={{ height: `${layout.barMm}mm`, background: card.planColor, flexShrink: 0, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
      <div style={{ padding: `${layout.padMm * 0.6}mm ${layout.padMm}mm ${layout.padMm}mm`, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1mm', minWidth: 0 }}>
          {brand.logoUrl && <img src={brand.logoUrl} alt="" style={{ height: `${layout.logoMm}mm`, width: 'auto', flexShrink: 0 }} />}
          <div style={{ fontSize: `${layout.sitePt}pt`, lineHeight: 1.2, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brand.logoUrl ? card.siteName : `${brand.name} · ${card.siteName}`}
          </div>
        </div>
        <div
          style={{
            fontSize: `${layout.codePt}pt`,
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: 0,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {card.code}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1mm', marginTop: 'auto' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: `${layout.pricePt}pt`, lineHeight: 1.15, fontWeight: 800 }}>{formatSSP(card.priceSsp)}</div>
            <div style={{ fontSize: `${layout.pricePt}pt`, lineHeight: 1.15, fontWeight: 700 }}>{formatDuration(card.uptimeSeconds)}</div>
            <div style={{ fontSize: `${layout.smallPt}pt`, lineHeight: 1.15, wordBreak: 'break-all' }}>{loginAddress(card.dnsName)}</div>
          </div>
          <QrCode text={loginUrl(card.dnsName, card.code)} sizeMm={layout.qrMm} />
        </div>
      </div>
    </div>
  );
}
