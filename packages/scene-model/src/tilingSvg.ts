import { patternRows, patternRowOffset } from './tiling';
import { escapeSvgAttribute as esc, svgPaint } from './svgPaint';
import type { PatternElement } from './types';

/** SVG patterns repeat one editable motif; each row needs only one animated pattern offset. */
export function tilingSvgContent(
  element: PatternElement,
  id: string,
  frame = 0,
  pathOnly = false,
): string {
  const pattern = element.definition;
  if (!pattern) return '';
  const symbols = new Map(pattern.symbols.map((symbol) => [symbol.key, symbol]));
  const defs: string[] = [],
    rows: string[] = [];
  for (const row of patternRows(pattern)) {
    const rowId = `${id}-r${row.row}`;
    const geometry = row.entries
      .map((entry) => {
        const source = symbols.get(entry.key)!;
        return `<path d="${esc(source.d)}" transform="translate(${entry.x} 0) scale(${entry.width / source.viewBoxWidth} ${entry.height / source.viewBoxHeight})" fill-rule="${esc(source.fillRule)}" clip-rule="${esc(source.fillRule)}"/>`;
      })
      .join('');
    const paint = svgPaint(
      pathOnly ? 'white' : element.fill,
      row.period,
      row.height,
      `${rowId}-paint`,
    );
    defs.push(paint.defs, `<clipPath id="${rowId}-clip">${geometry}</clipPath>`);
    const stroke =
      !pathOnly && element.strokeWidth > 0
        ? `<g fill="none" stroke="${esc(element.strokeColor)}" stroke-width="${element.strokeWidth}">${geometry}</g>`
        : '';
    // Path geometry is authored with explicit fill:none in the outline group through CSS inheritance.
    defs.push(
      `<pattern id="${rowId}" data-ograf-pattern-row="${row.row}" patternUnits="userSpaceOnUse" x="${patternRowOffset(pattern, row, frame)}" y="${row.y}" width="${row.period}" height="${row.height}"><rect width="${row.period}" height="${row.height}" fill="${paint.fill}" clip-path="url(#${rowId}-clip)"/>${stroke}</pattern>`,
    );
    if (!pathOnly && row.blur > 0)
      defs.push(
        `<filter id="${rowId}-blur" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="${row.blur}"/></filter>`,
      );
    rows.push(
      `<rect x="0" y="${row.y}" width="${pattern.width}" height="${row.height}" fill="url(#${rowId})" opacity="${pathOnly ? 1 : row.opacity}"${!pathOnly && row.blur > 0 ? ` filter="url(#${rowId}-blur)"` : ''}/>`,
    );
  }
  return `<defs>${defs.join('')}</defs>${rows.join('')}`;
}
