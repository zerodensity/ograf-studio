export type SvgMatrix = [number, number, number, number, number, number];
export const SVG_IDENTITY: SvgMatrix = [1, 0, 0, 1, 0, 0];
export function multiplySvgMatrix(a: SvgMatrix, b: SvgMatrix): SvgMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function parseSvgTransform(value: string | null): SvgMatrix {
  if (!value) return [...SVG_IDENTITY];
  const expression = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  let result: SvgMatrix = [...SVG_IDENTITY],
    end = 0,
    count = 0;
  for (const match of value.matchAll(expression)) {
    if (!/^[\s,]*$/.test(value.slice(end, match.index)) || ++count > 64)
      throw Error('Invalid SVG transform.');
    const raw = match[2]!.trim();
    if (!/^[\s,+\-.\deE]*$/.test(raw)) throw Error('Invalid SVG transform arguments.');
    const values = raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (!values.every(Number.isFinite)) throw Error('Invalid SVG transform arguments.');
    const [a = 0, b = 0, c = 0] = values;
    let next: SvgMatrix;
    if (match[1] === 'matrix' && values.length === 6) next = values as SvgMatrix;
    else if (match[1] === 'translate' && [1, 2].includes(values.length)) next = [1, 0, 0, 1, a, b];
    else if (match[1] === 'scale' && [1, 2].includes(values.length))
      next = [a, 0, 0, values[1] ?? a, 0, 0];
    else if (match[1] === 'rotate' && [1, 3].includes(values.length)) {
      const angle = (a * Math.PI) / 180,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      next = multiplySvgMatrix(multiplySvgMatrix([1, 0, 0, 1, b, c], [cos, sin, -sin, cos, 0, 0]), [
        1,
        0,
        0,
        1,
        -b,
        -c,
      ]);
    } else if (match[1] === 'skewX' && values.length === 1)
      next = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    else if (match[1] === 'skewY' && values.length === 1)
      next = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    else throw Error('Unsupported SVG transform.');
    result = multiplySvgMatrix(result, next);
    end = match.index! + match[0].length;
  }
  if (!count || !/^[\s,]*$/.test(value.slice(end)) || !result.every(Number.isFinite))
    throw Error('Invalid SVG transform.');
  return result;
}
