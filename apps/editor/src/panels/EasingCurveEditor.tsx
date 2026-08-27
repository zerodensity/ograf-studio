import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  cubicBezierProgress,
  easedProgress,
  type CubicBezierCurve,
  type EasingPreset,
} from '@ograf-editor/scene-model';

const WIDTH = 190;
const HEIGHT = 92;
const PADDING = 12;
const DEFAULT_CURVE: CubicBezierCurve = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const pointX = (value: number) => PADDING + value * (WIDTH - PADDING * 2);
const pointY = (value: number) => HEIGHT - PADDING - value * (HEIGHT - PADDING * 2);

export function EasingCurveEditor({
  easing,
  curve,
  onChange,
}: {
  easing: EasingPreset;
  curve?: CubicBezierCurve;
  onChange: (curve: CubicBezierCurve | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<'first' | 'second' | null>(null);
  const path = useMemo(() => {
    const points = Array.from({ length: 65 }, (_, index) => {
      const progress = index / 64;
      const value = curve ? cubicBezierProgress(progress, curve) : easedProgress(progress, easing);
      return `${index === 0 ? 'M' : 'L'} ${pointX(progress)} ${pointY(value)}`;
    });
    return points.join(' ');
  }, [curve, easing]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging || !curve) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp01((event.clientX - rect.left - PADDING) / (rect.width - PADDING * 2));
    const y = clamp01(1 - (event.clientY - rect.top - PADDING) / (rect.height - PADDING * 2));
    onChange(dragging === 'first' ? { ...curve, x1: x, y1: y } : { ...curve, x2: x, y2: y });
  };

  const setValue = (key: keyof CubicBezierCurve, value: number) => {
    onChange({ ...(curve ?? DEFAULT_CURVE), [key]: clamp01(value) });
  };

  return (
    <div className="easing-curve-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={curve ? 'Editable cubic Bézier easing curve' : `${easing} easing curve preview`}
        onPointerMove={updateFromPointer}
        onPointerUp={(event) => {
          if (dragging) event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
      >
        <rect
          x={PADDING}
          y={PADDING}
          width={WIDTH - PADDING * 2}
          height={HEIGHT - PADDING * 2}
          className="easing-curve-grid"
        />
        <path d={path} className="easing-curve-path" />
        {curve && (
          <>
            <line
              x1={pointX(0)}
              y1={pointY(0)}
              x2={pointX(curve.x1)}
              y2={pointY(curve.y1)}
              className="easing-curve-handle-line"
            />
            <line
              x1={pointX(1)}
              y1={pointY(1)}
              x2={pointX(curve.x2)}
              y2={pointY(curve.y2)}
              className="easing-curve-handle-line"
            />
            <circle
              cx={pointX(curve.x1)}
              cy={pointY(curve.y1)}
              r="5"
              className="easing-curve-handle"
              onPointerDown={(event) => {
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                setDragging('first');
              }}
            />
            <circle
              cx={pointX(curve.x2)}
              cy={pointY(curve.y2)}
              r="5"
              className="easing-curve-handle"
              onPointerDown={(event) => {
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                setDragging('second');
              }}
            />
          </>
        )}
      </svg>
      <div className="easing-curve-actions">
        {curve ? (
          <button type="button" onClick={() => onChange(null)}>
            Use preset
          </button>
        ) : (
          <button type="button" onClick={() => onChange(DEFAULT_CURVE)}>
            Make custom curve
          </button>
        )}
      </div>
      {curve && (
        <div className="easing-curve-values">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={Number(curve[key].toFixed(3))}
                onChange={(event) => setValue(key, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
