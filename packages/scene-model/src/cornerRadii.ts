import type { CornerRadii } from './types';

export type CornerRadiiInput = number | Partial<CornerRadii> | null | undefined;

const finiteRadius = (value: unknown): number => {
  const radius = Number(value);
  return Number.isFinite(radius) ? Math.max(0, radius) : 0;
};

export function createCornerRadii(value = 0): CornerRadii {
  const radius = finiteRadius(value);
  return {
    topLeft: radius,
    topRight: radius,
    bottomRight: radius,
    bottomLeft: radius,
  };
}

/** Accepts the legacy single-number form as well as incomplete imported objects. */
export function normalizeCornerRadii(value: CornerRadiiInput): CornerRadii {
  if (typeof value === 'number') return createCornerRadii(value);
  if (!value || typeof value !== 'object') return createCornerRadii();
  return {
    topLeft: finiteRadius(value.topLeft),
    topRight: finiteRadius(value.topRight),
    bottomRight: finiteRadius(value.bottomRight),
    bottomLeft: finiteRadius(value.bottomLeft),
  };
}

/** CSS radius order is top-left, top-right, bottom-right, bottom-left. */
export function cornerRadiiToCss(value: CornerRadiiInput): string {
  const radii = normalizeCornerRadii(value);
  return `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
}

/** Applies the same proportional reduction CSS uses when adjacent radii exceed the box. */
export function clampCornerRadii(
  value: CornerRadiiInput,
  width: number,
  height: number,
): CornerRadii {
  const radii = normalizeCornerRadii(value);
  const ratios = [
    radii.topLeft + radii.topRight > 0 ? Math.max(0, width) / (radii.topLeft + radii.topRight) : 1,
    radii.bottomLeft + radii.bottomRight > 0
      ? Math.max(0, width) / (radii.bottomLeft + radii.bottomRight)
      : 1,
    radii.topLeft + radii.bottomLeft > 0
      ? Math.max(0, height) / (radii.topLeft + radii.bottomLeft)
      : 1,
    radii.topRight + radii.bottomRight > 0
      ? Math.max(0, height) / (radii.topRight + radii.bottomRight)
      : 1,
  ];
  const scale = Math.min(1, ...ratios);
  return {
    topLeft: radii.topLeft * scale,
    topRight: radii.topRight * scale,
    bottomRight: radii.bottomRight * scale,
    bottomLeft: radii.bottomLeft * scale,
  };
}

export function roundedRectangleSvgPath(
  width: number,
  height: number,
  value: CornerRadiiInput,
): string {
  const radius = clampCornerRadii(value, width, height);
  return [
    `M ${radius.topLeft} 0`,
    `H ${width - radius.topRight}`,
    `Q ${width} 0 ${width} ${radius.topRight}`,
    `V ${height - radius.bottomRight}`,
    `Q ${width} ${height} ${width - radius.bottomRight} ${height}`,
    `H ${radius.bottomLeft}`,
    `Q 0 ${height} 0 ${height - radius.bottomLeft}`,
    `V ${radius.topLeft}`,
    `Q 0 0 ${radius.topLeft} 0`,
    'Z',
  ].join(' ');
}
