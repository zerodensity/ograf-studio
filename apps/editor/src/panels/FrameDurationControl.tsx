import { useEffect, useMemo, useState } from 'react';
import { analyzeMillisecondDuration, millisecondsForFrames } from './timelineFormatting';
import './FrameDurationControl.css';

interface FrameDurationControlProps {
  label: string;
  frames: number;
  frameRate: number;
  minFrames: number;
  onChange: (frames: number) => void;
}

const displayMilliseconds = (milliseconds: number) => Number(milliseconds.toFixed(3)).toString();

export function FrameDurationControl({
  label,
  frames,
  frameRate,
  minFrames,
  onChange,
}: FrameDurationControlProps) {
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

  return (
    <div className="frame-duration-control">
      <label>
        {label} frames
        <input
          aria-label={`${label} frames`}
          type="number"
          min={minFrames}
          step={1}
          value={frames}
          onChange={(event) => commitFrames(Math.round(Number(event.target.value)))}
        />
      </label>
      <label className="frame-duration-milliseconds">
        milliseconds
        <input
          aria-label={`${label} milliseconds`}
          type="number"
          min={0}
          step="any"
          value={displayMilliseconds(milliseconds)}
          onChange={(event) => {
            const value = Math.max(0, Number(event.target.value));
            setMilliseconds(value);
            const next = analyzeMillisecondDuration(value, frameRate);
            if (next.representable) commitFrames(next.nearestFrames);
          }}
        />
      </label>
      <span className={analysis.representable ? 'frame-duration-exact' : 'frame-duration-warning'}>
        {analysis.representable
          ? `${analysis.nearestFrames} exact frame${analysis.nearestFrames === 1 ? '' : 's'} at ${Number(frameRate.toFixed(3))} fps`
          : `${milliseconds} ms = ${analysis.exactFrames.toFixed(3)} frames`}
      </span>
      {!analysis.representable && (
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
      )}
    </div>
  );
}
