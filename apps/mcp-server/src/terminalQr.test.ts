import { describe, expect, it } from 'vitest';
import { formatTerminalQr } from './terminalQr';

describe('terminal QR', () => {
  it('fits the longest IPv4 viewer URL in 80 columns with a quiet zone', () => {
    const url = 'http://255.255.255.254:65535/v/AAAAAAAAAAAAAAAAAAAAAA';
    const { columns, text } = formatTerminalQr(url);
    const rows = text.split('\n');
    expect(columns).toBe(74);
    expect(rows).toHaveLength(37);
    const white = '\u001b[48;2;255;255;255m';
    const black = '\u001b[48;2;0;0;0m';
    const reset = '\u001b[0m';
    const whiteRow = white + ' '.repeat(columns) + reset;
    expect(rows.slice(0, 4)).toEqual(Array<string>(4).fill(whiteRow));
    expect(rows.slice(-4)).toEqual(Array<string>(4).fill(whiteRow));
    expect(text).toContain(black);
    for (const row of rows) {
      expect(row.replaceAll(white, '').replaceAll(black, '').replaceAll(reset, '')).toBe(
        ' '.repeat(columns),
      );
    }
  });
});
