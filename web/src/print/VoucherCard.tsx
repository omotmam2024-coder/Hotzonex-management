import type { CSSProperties } from 'react';
import { formatSSP } from '../lib/format';
import { durationText } from './duration';
import type { PrintBrand } from './brand';
import type { SheetLayout } from './layouts';
import { loginAddress } from './voucherLinks';

export interface CardData {
  id: string;
  code: string;
  siteName: string;
  dnsName: string;
  /** The hotspot's IP; '' when not known. */
  hotspotIp?: string;
  planColor: string;
  priceSsp: number;
  uptimeSeconds: number;
}

const FONT = 'Arial, Helvetica, sans-serif';

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The plan colour mixed towards black (amount 0–1). */
function darker(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c * (1 - amount)));
  return `rgb(${r}, ${g}, ${b})`;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Black or white text, whichever reads better on the plan colour. */
function textOn(hex: string): string {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.45 ? '#111827' : '#ffffff';
}

function WifiIcon({ size, color }: { size: string; color: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, display: 'block' }} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round">
      <path d="M2 8.8a15 15 0 0 1 20 0" />
      <path d="M5.2 12.3a10.4 10.4 0 0 1 13.6 0" />
      <path d="M8.5 15.8a5.6 5.6 0 0 1 7 0" />
      <circle cx="12" cy="19.4" r="1.5" fill={color} stroke="none" />
    </svg>
  );
}

const exact: CSSProperties = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' };

/**
 * One cut-out portrait voucher card: the logo and WiFi name centred on a band in the plan's
 * colour, then the code, price and time. All sizes are physical (mm / pt) so print output is exact.
 */
export function VoucherCard({ card, layout, brand, codeLabel }: { card: CardData; layout: SheetLayout; brand: PrintBrand; codeLabel: string }) {
  const color = /^#[0-9a-f]{6}$/i.test(card.planColor) ? card.planColor : '#1d4ed8';
  const ink = textOn(color);
  const deep = darker(color, 0.35);
  const pad = `${layout.padMm}mm`;

  return (
    <div style={{ boxSizing: 'border-box', border: '0.2mm dashed #9ca3af', padding: `${layout.insetMm}mm`, breakInside: 'avoid', overflow: 'hidden', background: '#fff', ...exact }}>
      <div
        style={{
          boxSizing: 'border-box',
          height: '100%',
          border: `0.35mm solid ${color}`,
          borderRadius: '2.4mm',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          fontFamily: FONT,
          color: '#111827',
          background: `linear-gradient(180deg, #ffffff 55%, ${alpha(color, 0.1)} 100%)`,
          ...exact,
        }}
      >
        {/* Coloured top: logo in a white circle, the WiFi name under it. */}
        <div
          style={{
            boxSizing: 'border-box',
            width: '100%',
            height: `${layout.headMm}mm`,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: `${layout.padMm * 0.7}mm`,
            padding: `${layout.padMm}mm ${pad} ${layout.padMm * 1.6}mm`,
            background: `radial-gradient(circle at 50% 0%, ${alpha('#ffffff', 0.28)} 0%, transparent 60%), linear-gradient(160deg, ${color} 0%, ${deep} 100%)`,
            borderRadius: `0 0 50% 50% / 0 0 ${layout.padMm * 2.2}mm ${layout.padMm * 2.2}mm`,
            color: ink,
            ...exact,
          }}
        >
          <div
            style={{
              boxSizing: 'border-box',
              width: `${layout.logoMm}mm`,
              height: `${layout.logoMm}mm`,
              borderRadius: '50%',
              background: '#fff',
              border: `0.5mm solid ${alpha('#ffffff', 0.6)}`,
              boxShadow: `0 0 0 0.6mm ${alpha('#000000', 0.12)}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
              ...exact,
            }}
          >
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
            ) : (
              <WifiIcon size="62%" color={deep} />
            )}
          </div>
          <div
            style={{
              maxWidth: '100%',
              fontSize: `${layout.namePt}pt`,
              lineHeight: 1.1,
              fontWeight: 800,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            }}
          >
            {brand.name}
          </div>
        </div>

        {/* Code, price and time. */}
        <div style={{ boxSizing: 'border-box', width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-evenly', padding: `${layout.padMm * 0.6}mm ${pad}` }}>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: `${layout.smallPt}pt`, lineHeight: 1.2, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: deep }}>{codeLabel}</div>
            <div
              style={{
                boxSizing: 'border-box',
                marginTop: '0.6mm',
                padding: `${layout.padMm * 0.5}mm ${layout.padMm * 0.4}mm`,
                border: `0.3mm dashed ${color}`,
                borderRadius: '1.4mm',
                background: alpha(color, 0.08),
                fontSize: `${layout.codePt}pt`,
                lineHeight: 1.15,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
                ...exact,
              }}
            >
              {/* The code always reads left to right, also on Arabic cards. */}
              <span dir="ltr">{card.code}</span>
            </div>
          </div>
          <div style={{ fontSize: `${layout.pricePt}pt`, lineHeight: 1.1, fontWeight: 900, color: '#111827', whiteSpace: 'nowrap' }}>
            <span dir="ltr">{formatSSP(card.priceSsp)}</span>
          </div>
          <div
            style={{
              fontSize: `${layout.smallPt}pt`,
              lineHeight: 1,
              fontWeight: 800,
              padding: `${layout.padMm * 0.5}mm ${layout.padMm * 1.4}mm`,
              borderRadius: '9mm',
              background: color,
              color: ink,
              whiteSpace: 'nowrap',
              ...exact,
            }}
          >
            {durationText(card.uptimeSeconds)}
          </div>
        </div>

        {/* Where to log in. */}
        <div
          style={{
            boxSizing: 'border-box',
            width: '100%',
            flexShrink: 0,
            padding: `${layout.padMm * 0.5}mm ${pad}`,
            borderTop: `0.2mm dotted ${alpha(color, 0.6)}`,
            fontSize: `${layout.footPt}pt`,
            lineHeight: 1.2,
            fontWeight: 700,
            color: deep,
            wordBreak: 'break-all',
          }}
        >
          <span dir="ltr">{loginAddress(card.dnsName)}</span>
        </div>
      </div>
    </div>
  );
}
