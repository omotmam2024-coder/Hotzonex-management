import qrcode from 'qrcode-generator';

/**
 * The 2-step login QR code, drawn here from the authenticator link (otpauth://…): black squares on a
 * fixed white background with the standard 4-square white border, so it scans in light and dark mode.
 */
export function TotpQr({ uri, label }: { uri: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="h-64 w-64 max-w-full rounded-lg ring-1 ring-slate-200"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
