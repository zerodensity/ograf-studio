import type { ChartMarkPose } from '@ograf-editor/scene-model';

export interface ChartMarkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type MarkGeometry = Record<string, unknown>;

const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Bars keep their native sign/base; arcs use each sector rather than the whole chart as pivot. */
export function chartMarkBounds(target: MarkGeometry): ChartMarkBounds {
  const x = number(target.x);
  const y = number(target.y);
  if (typeof target.outerRadius !== 'number') {
    const horizontal = target.horizontal === true;
    const base = number(target.base, horizontal ? x : y);
    const width = Math.max(0, number(target.width));
    const height = Math.max(0, number(target.height));
    return horizontal
      ? { x: Math.min(x, base), y: y - height / 2, width: Math.abs(x - base), height }
      : { x: x - width / 2, y: Math.min(y, base), width, height: Math.abs(y - base) };
  }
  const outer = Math.max(0, number(target.outerRadius));
  const inner = Math.max(0, number(target.innerRadius));
  const start = number(target.startAngle);
  const end = number(target.endAngle, start);
  const span = Math.max(0, end - start);
  if (span >= Math.PI * 2)
    return { x: x - outer, y: y - outer, width: outer * 2, height: outer * 2 };
  const angles = [start, end];
  const quarter = Math.PI / 2;
  for (let angle = Math.ceil(start / quarter) * quarter; angle < end; angle += quarter)
    angles.push(angle);
  const points = angles.flatMap((angle) =>
    [inner, outer].map((radius) => ({
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius,
    })),
  );
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: Math.max(...points.map((point) => point.x)) - left,
    height: Math.max(...points.map((point) => point.y)) - top,
  };
}

/** Draw native Chart.js paths unchanged, so borders, rounded corners and masks stay aligned. */
export function drawChartMarkPose(
  ctx: CanvasRenderingContext2D,
  bounds: ChartMarkBounds,
  pose: ChartMarkPose | null,
  draw: () => void,
  clip = true,
): void {
  if (!pose) {
    draw();
    return;
  }
  ctx.save();
  try {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    ctx.translate(centerX + pose.x, centerY + pose.y);
    ctx.rotate((pose.rotation * Math.PI) / 180);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-centerX, -centerY);
    ctx.globalAlpha *= pose.opacity;
    if (pose.blur > 0)
      ctx.filter =
        (ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : '') + `blur(${pose.blur}px)`;
    if (clip && (pose.clipLeft || pose.clipRight || pose.clipTop || pose.clipBottom)) {
      ctx.beginPath();
      ctx.rect(
        bounds.x + pose.clipLeft * bounds.width,
        bounds.y + pose.clipTop * bounds.height,
        Math.max(0, bounds.width * (1 - pose.clipLeft - pose.clipRight)),
        Math.max(0, bounds.height * (1 - pose.clipTop - pose.clipBottom)),
      );
      ctx.clip();
    }
    draw();
  } finally {
    ctx.restore();
  }
}
