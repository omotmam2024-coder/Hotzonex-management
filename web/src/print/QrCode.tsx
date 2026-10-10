import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Builds one SVG path for all dark modules (much smaller than one element per module). */
function qrPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;
      path += `M${start} ${row}h${col - start}v1h-${col - start}z`;
    }
  }
  return { path, size: count };
}

/** Crisp vector QR code sized in millimetres for print. Includes a 2-module quiet zone. */
export function QrCode({ text, sizeMm }: { text: string; sizeMm: number }) {
  const { path, size } = useMemo(() => qrPath(text), [text]);
  const quiet = 2;
  const box = size + quiet * 2;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      width={`${sizeMm}mm`}
      height={`${sizeMm}mm`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code to log in"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
