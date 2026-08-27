export interface ParsedCssTransform {
  x: number;
  y: number;
  rotation: number;
}

function numbers(value: string): number[] {
  return value.split(',').map((part) => Number.parseFloat(part.trim()));
}

/** Reads the transform formats produced by React, GSAP, and Moveable. */
export function parseCssTransform(transform: string): ParsedCssTransform {
  const translate3dMatch = transform.match(
    /translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px,\s*[-\d.]+px\s*\)/,
  );
  const translateMatch = transform.match(/translate\(\s*([-\d.]+)px,\s*([-\d.]+)px\s*\)/);
  const matrix3dMatch = transform.match(/matrix3d\(([^)]+)\)/);
  const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
  const rotateMatch = transform.match(/rotate(?:Z)?\(\s*([-\d.]+)deg\s*\)/);

  let x = 0;
  let y = 0;
  let matrixRotation = 0;

  if (translate3dMatch) {
    x = Number.parseFloat(translate3dMatch[1]!);
    y = Number.parseFloat(translate3dMatch[2]!);
  } else if (translateMatch) {
    x = Number.parseFloat(translateMatch[1]!);
    y = Number.parseFloat(translateMatch[2]!);
  } else if (matrix3dMatch) {
    const values = numbers(matrix3dMatch[1]!);
    x = values[12] ?? 0;
    y = values[13] ?? 0;
    matrixRotation = (Math.atan2(values[1] ?? 0, values[0] ?? 1) * 180) / Math.PI;
  } else if (matrixMatch) {
    const values = numbers(matrixMatch[1]!);
    x = values[4] ?? 0;
    y = values[5] ?? 0;
    matrixRotation = (Math.atan2(values[1] ?? 0, values[0] ?? 1) * 180) / Math.PI;
  }

  return {
    x,
    y,
    rotation: rotateMatch ? Number.parseFloat(rotateMatch[1]!) : matrixRotation,
  };
}
