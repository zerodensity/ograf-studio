import type { PathElement } from './types';

export interface PathStretchSlice {
  column: 1 | 2 | 3;
  row: 1 | 2 | 3;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pathStretchSlices(element: PathElement): PathStretchSlice[] {
  const insets = element.stretchInsets;
  if (!insets) return [];
  const left = Math.max(0, Math.min(element.viewBoxWidth, insets.left));
  const right = Math.max(0, Math.min(element.viewBoxWidth - left, insets.right));
  const top = Math.max(0, Math.min(element.viewBoxHeight, insets.top));
  const bottom = Math.max(0, Math.min(element.viewBoxHeight - top, insets.bottom));
  const xs = [0, left, element.viewBoxWidth - right];
  const widths = [left, element.viewBoxWidth - left - right, right];
  const ys = [0, top, element.viewBoxHeight - bottom];
  const heights = [top, element.viewBoxHeight - top - bottom, bottom];
  return ys.flatMap((y, row) =>
    xs.flatMap((x, column) => {
      const width = widths[column]!,
        height = heights[row]!;
      return width > 0 && height > 0
        ? [{ column: (column + 1) as 1 | 2 | 3, row: (row + 1) as 1 | 2 | 3, x, y, width, height }]
        : [];
    }),
  );
}

export function normalizePathStretchInsets(
  element: PathElement,
  value: PathElement['stretchInsets'],
): PathElement['stretchInsets'] {
  if (!value) return undefined;
  const number = (input: number) => Math.max(0, Math.round(Number.isFinite(input) ? input : 0));
  const left = Math.min(element.viewBoxWidth, number(value.left));
  const right = Math.min(element.viewBoxWidth - left, number(value.right));
  const top = Math.min(element.viewBoxHeight, number(value.top));
  const bottom = Math.min(element.viewBoxHeight - top, number(value.bottom));
  return { left, right, top, bottom };
}
