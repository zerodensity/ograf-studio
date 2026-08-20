const TARGET_MAJOR_TICK_PX = 72;

export interface RulerScale {
  major: number;
  minor: number;
}

/** Photoshop-style 1/2/5 measurement scale with roughly 72 screen pixels between labels. */
export function rulerScaleForZoom(zoom: number): RulerScale {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const targetUnits = TARGET_MAJOR_TICK_PX / safeZoom;
  const magnitude = 10 ** Math.floor(Math.log10(targetUnits));
  const normalized = targetUnits / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const major = multiplier * magnitude;
  return { major, minor: major / 10 };
}

export type RulerTickKind = 'minor' | 'medium' | 'major';

export interface RulerTick {
  value: number;
  kind: RulerTickKind;
}

export function buildRulerTicks(min: number, max: number, scale: RulerScale): RulerTick[] {
  const first = Math.ceil(min / scale.minor) * scale.minor;
  const ticks: RulerTick[] = [];
  const count = Math.floor((max - first) / scale.minor) + 1;
  for (let index = 0; index < count; index += 1) {
    const value = Number((first + index * scale.minor).toFixed(8));
    const majorRatio = value / scale.major;
    const halfRatio = value / (scale.major / 2);
    const kind: RulerTickKind = Number.isInteger(majorRatio)
      ? 'major'
      : Number.isInteger(halfRatio)
        ? 'medium'
        : 'minor';
    ticks.push({ value, kind });
  }
  return ticks;
}

export function guidePositionFromViewport(
  axis: 'vertical' | 'horizontal',
  pointer: { x: number; y: number },
  viewportRect: { left: number; top: number },
  scroll: { left: number; top: number },
  composition: { width: number; height: number },
  zoom: number,
): number {
  return Math.round(
    axis === 'vertical'
      ? (pointer.x - viewportRect.left + scroll.left) / zoom - composition.width
      : (pointer.y - viewportRect.top + scroll.top) / zoom - composition.height,
  );
}
