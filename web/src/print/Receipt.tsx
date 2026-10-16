import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDuration, formatSSP } from '../lib/format';
import type { PrintBrand } from './brand';
import { loginAddress } from './voucherLinks';

export type ReceiptWidth = 58 | 80;

export interface ReceiptData {
  code: string;
  siteName: string;
  dnsName: string;
  /** The hotspot's IP, printed as a second address; '' when not known. */
  hotspotIp?: string;
  planName: string;
  planColor: string;
  priceSsp: number;
  uptimeSeconds: number;
  soldAt: string | null;
  sellerName: string | null;
}

const FONT = 'Arial, Helvetica, sans-serif';
const PT_PER_MM = 72 / 25.4;

// Printable width of common thermal heads: 58 mm paper → 48 mm, 80 mm paper → 72 mm.
const CONTENT_MM: Record<ReceiptWidth, number> = { 58: 48, 80: 72 };

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Juba',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Thermal receipt. Sets its own @page size to the paper width and the receipt's measured height. */
export function Receipt({ data, width, brand, onReady }: { data: ReceiptData; width: ReceiptWidth; brand: PrintBrand; onReady?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [heightMm, setHeightMm] = useState(150);
  // The logo changes the receipt's height, so it is measured again (and printing waits) until it has loaded.
  const [logoDone, setLogoDone] = useState(!brand.logoUrl);
  const contentMm = CONTENT_MM[width];
  const sideMm = (width - contentMm) / 2;
  // Biggest code that fits the paper width (Arial digits are ~0.56 em wide), capped for balance.
  const codePt = Math.min(width === 58 ? 24 : 30, Math.floor((contentMm * PT_PER_MM) / (data.code.length * 0.6)));

  useLayoutEffect(() => {
    if (ref.current) setHeightMm(Math.ceil(ref.current.getBoundingClientRect().height / (96 / 25.4)) + 4);
  }, [data, width, logoDone]);

  useEffect(() => {
    if (logoDone) onReady?.();
  }, [logoDone, onReady]);

  const line = { margin: 0, lineHeight: 1.25 } as const;

  return (
    <div className="receipt-root">
      <style>{`
        @page { size: ${width}mm ${heightMm}mm; margin: 0; }
        .receipt-root .receipt-paper { width: ${width}mm; margin: 0 auto; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
        @media print { .receipt-root .receipt-paper { box-shadow: none; margin: 0; } }
      `}</style>
      <div className="receipt-paper">
        <div ref={ref} style={{ padding: `3mm ${sideMm}mm 4mm`, fontFamily: FONT, color: '#000', textAlign: 'center' }}>
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} style={{ display: 'block', width: `${Math.round(contentMm * 0.75)}mm`, height: 'auto', margin: '0 auto 1mm' }}
              onLoad={() => setLogoDone(true)}
              onError={() => setLogoDone(true)}
            />
          ) : (
            <p style={{ ...line, fontSize: '13pt', fontWeight: 800, textTransform: 'uppercase' }}>{brand.name}</p>
          )}
          <p style={{ ...line, fontSize: '9pt' }}>{data.siteName}</p>
          <div style={{ height: '2mm', background: data.planColor, margin: '2mm 0', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
          <p style={{ ...line, fontSize: '8pt' }}>WiFi code</p>
          <p style={{ ...line, fontSize: `${codePt}pt`, fontWeight: 800, letterSpacing: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{data.code}</p>
          <p style={{ ...line, fontSize: width === 58 ? '13pt' : '16pt', fontWeight: 800, marginTop: '1mm' }}>
            {formatSSP(data.priceSsp)} · {formatDuration(data.uptimeSeconds)}
          </p>
          <p style={{ ...line, fontSize: '8pt' }}>{data.planName}</p>
          <p style={{ ...line, fontSize: '8.5pt', marginTop: '2.5mm' }}>Connect to the WiFi, then open</p>
          <p style={{ ...line, fontSize: width === 58 ? '10pt' : '12pt', fontWeight: 800, wordBreak: 'break-all' }}>{loginAddress(data.dnsName)}</p>
          {data.hotspotIp && <p style={{ ...line, fontSize: '8.5pt' }}>or {loginAddress(data.hotspotIp)}</p>}
          <p style={{ ...line, fontSize: '8.5pt' }}>Username and password are the same code.</p>
          <div style={{ borderTop: '0.3mm dashed #000', margin: '2.5mm 0 1.5mm' }} />
          <p style={{ ...line, fontSize: '8.5pt' }}>{data.soldAt ? `Sold ${dateTime.format(new Date(data.soldAt))}` : `Printed ${dateTime.format(new Date())}`}</p>
          <p style={{ ...line, fontSize: '8.5pt' }}>Seller: {data.sellerName ?? '—'}</p>
          <p style={{ ...line, fontSize: '7.5pt', marginTop: '1.5mm' }}>Keep this receipt until your time ends.</p>
        </div>
      </div>
    </div>
  );
}
