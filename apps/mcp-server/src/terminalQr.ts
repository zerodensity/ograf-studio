import qrcode from 'qrcode-generator';

const WHITE = '\u001b[48;2;255;255;255m';
const BLACK = '\u001b[48;2;0;0;0m';
const RESET = '\u001b[0m';
const QUIET_ZONE = 4;

/** Two terminal spaces make each QR module approximately square. */
export function formatTerminalQr(url: string): { columns: number; text: string } {
  const qr = qrcode(0, 'L');
  qr.addData(url, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const rows: string[] = [];
  for (let row = -QUIET_ZONE; row < size + QUIET_ZONE; row++) {
    let line = '';
    let shade: string | undefined;
    for (let col = -QUIET_ZONE; col < size + QUIET_ZONE; col++) {
      const inCode = row >= 0 && row < size && col >= 0 && col < size;
      const color = inCode && qr.isDark(row, col) ? BLACK : WHITE;
      if (shade !== color) {
        line += color;
        shade = color;
      }
      line += '  ';
    }
    rows.push(line + RESET);
  }
  return { columns: 2 * (size + 2 * QUIET_ZONE), text: rows.join('\n') };
}
