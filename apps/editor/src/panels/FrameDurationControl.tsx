import { useEditorWindow } from '../layout/EditorWindow';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PropertyRow } from '../components/PropertyRow';
import { analyzeMillisecondDuration, millisecondsForFrames } from './timelineFormatting';
import './FrameDurationControl.css';

interface FrameDurationControlProps {
  label: string;
  frames: number;
  frameRate: number;
  minFrames: number;
  onChange: (frames: number) => void;
  compact?: boolean;
  propertyColumns?: boolean;
}

const displayMilliseconds = (milliseconds: number) => Number(milliseconds.toFixed(3)).toString();

export function FrameDurationControl({
  label,
  frames,
  frameRate,
  minFrames,
  onChange,
  compact = false,
  propertyColumns = false,
}: FrameDurationControlProps) {
  const { window, document } = useEditorWindow();
  const rootRef = useRef<HTMLDivElement>(null);
  const exactMilliseconds = millisecondsForFrames(frames, frameRate);
  const [milliseconds, setMilliseconds] = useState(exactMilliseconds);
  useEffect(() => setMilliseconds(exactMilliseconds), [exactMilliseconds]);
  const analysis = useMemo(
    () => analyzeMillisecondDuration(milliseconds, frameRate),
    [milliseconds, frameRate],
  );
  const commitFrames = (nextFrames: number) => {
    const clamped = Math.max(minFrames, nextFrames);
    onChange(clamped);
    setMilliseconds(millisecondsForFrames(clamped, frameRate));
  };
  const explanation = analysis.representable
    ? `${analysis.nearestFrames} exact frame${analysis.nearestFrames === 1 ? '' : 's'} at ${Number(frameRate.toFixed(3))} fps`
    : `${milliseconds} ms = ${analysis.exactFrames.toFixed(3)} frames`;
  const rounding = (
    <div className="frame-duration-rounding" role="group" aria-label="Frame rounding choices">
      <button type="button" onClick={() => commitFrames(analysis.floorFrames)}>
        Down {Math.max(minFrames, analysis.floorFrames)}
      </button>
      <button type="button" onClick={() => commitFrames(analysis.nearestFrames)}>
        Nearest {Math.max(minFrames, analysis.nearestFrames)}
      </button>
      <button type="button" onClick={() => commitFrames(analysis.ceilFrames)}>
        Up {Math.max(minFrames, analysis.ceilFrames)}
      </button>
    </div>
  );
  const bounds =
    compact && !analysis.representable ? rootRef.current?.getBoundingClientRect() : undefined;

  return (
    <div
      ref={rootRef}
      className={`frame-duration-control${compact ? ' compact' : ''}`}
      title={compact ? `${label}: ${explanation}` : undefined}
    >
      <PropertyRow
        help={`${label === 'Update crossfade' ? 'Duration of transitions when new playback data is applied.' : 'Duration of the incoming lifecycle transition.'} Enter an exact frame count; the milliseconds value follows the composition frame rate.`}
        resizable={propertyColumns}
        title={compact ? `${label} in frames` : undefined}
      >
        <span>{compact ? 'f' : `${label} frames`}</span>
        <input
          aria-label={`${label} frames`}
          type="number"
          min={minFrames}
          step={1}
          value={frames}
          onChange={(event) => commitFrames(Math.round(Number(event.target.value)))}
        />
      </PropertyRow>
      <PropertyRow
        help={`${label === 'Update crossfade' ? 'Duration of transitions when new playback data is applied.' : 'Duration of the incoming lifecycle transition.'} Enter milliseconds. If the value falls between frames, choose a rounding option to keep the timeline frame-aligned.`}
        resizable={propertyColumns}
        className="frame-duration-milliseconds"
        title={compact ? `${label} in milliseconds` : undefined}
      >
        <span>{compact ? 'ms' : 'milliseconds'}</span>
        <input
          aria-label={`${label} milliseconds`}
          type="number"
          min={0}
          step="any"
          value={displayMilliseconds(milliseconds)}
          aria-invalid={!analysis.representable}
          onKeyDown={(event) => {
            if (compact && event.key === 'Escape') setMilliseconds(exactMilliseconds);
          }}
          onChange={(event) => {
            const value = Math.max(0, Number(event.target.value));
            setMilliseconds(value);
            const next = analyzeMillisecondDuration(value, frameRate);
            if (next.representable) commitFrames(next.nearestFrames);
          }}
        />
      </PropertyRow>
      {!compact && (
        <span
          className={analysis.representable ? 'frame-duration-exact' : 'frame-duration-warning'}
        >
          {explanation}
        </span>
      )}
      {!analysis.representable &&
        (compact && bounds
          ? createPortal(
              <div
                className="frame-duration-popover"
                style={{
                  left: Math.max(8, Math.min(bounds.left, window.innerWidth - 300)),
                  top:
                    bounds.bottom + 100 < window.innerHeight
                      ? bounds.bottom + 6
                      : Math.max(8, bounds.top - 86),
                }}
              >
                <p className="frame-duration-warning" role="alert">
                  {explanation}
                </p>
                {rounding}
              </div>,
              document.body,
            )
          : rounding)}
    </div>
  );
}
