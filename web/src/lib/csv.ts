type Cell = string | number | null | undefined;

function escape(cell: Cell): string {
  const s = cell === null || cell === undefined ? '' : String(cell);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds CSV text (with a BOM so Excel opens UTF-8 correctly). */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n');
}

/** Saves text as a file in the browser. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
