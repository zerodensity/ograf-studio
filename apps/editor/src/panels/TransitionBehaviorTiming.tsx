import { useId } from 'react';
import { behaviorSeconds } from './transitionBehaviorFormatting';
import './TransitionBehaviorTiming.css';

export interface BehaviorTimingPhase {
  key: string;
  label: string;
  frames: number;
  kind: 'layout' | 'wait' | 'content';
}

/** Each control adjusts one supported planner phase; offsets and totals are calculated for the user. */
export function TransitionBehaviorTiming({
  title,
  phases,
  frameRate,
  minimumTotalFrames = 0,
  tailFrames = 0,
  onChange,
  disabled = false,
}: {
  title: string;
  phases: BehaviorTimingPhase[];
  frameRate: number;
  minimumTotalFrames?: number;
  tailFrames?: number;
  onChange: (key: string, frames: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const sequenceFrames = phases.reduce((sum, phase) => sum + phase.frames, 0);
  const totalFrames = Math.max(sequenceFrames, minimumTotalFrames) + tailFrames;
  const displayPhases: BehaviorTimingPhase[] = [
    ...phases,
    ...(minimumTotalFrames > sequenceFrames
      ? [
          {
            key: 'preserved-shared',
            label: 'Shared movement',
            frames: minimumTotalFrames - sequenceFrames,
            kind: 'layout' as const,
          },
        ]
      : []),
    ...(tailFrames > 0
      ? [{ key: 'preserved-hold', label: 'Hold', frames: tailFrames, kind: 'wait' as const }]
      : []),
  ];
  return (
    <fieldset className="tl-behavior-timing" disabled={disabled}>
      <legend>{title}</legend>
      <div className="tl-behavior-timing-total">
        <span>First → then</span>
        <strong>
          {behaviorSeconds(totalFrames, frameRate)} · {totalFrames}f
        </strong>
      </div>
      <div className="tl-behavior-phase-strip" aria-label={`${title}: ${totalFrames} frames`}>
        {displayPhases.map((phase) => (
          <div
            key={phase.key}
            className={`tl-behavior-phase tl-behavior-phase-${phase.kind}`}
            style={{ flexGrow: Math.max(phase.frames, 1) }}
            title={`${phase.label}: ${phase.frames} frames (${behaviorSeconds(phase.frames, frameRate)})`}
          >
            <span>{phase.label}</span>
            <small>{phase.frames}f</small>
          </div>
        ))}
      </div>
      <div className="tl-behavior-phase-controls">
        {phases.map((phase) => {
          const labelId = `${id}-${phase.key}`;
          return (
            <div className="tl-behavior-phase-control" key={phase.key}>
              <label htmlFor={`${labelId}-frames`} id={labelId}>
                {phase.label}
              </label>
              <input
                type="range"
                aria-labelledby={labelId}
                aria-valuetext={`${phase.frames} frames, ${behaviorSeconds(phase.frames, frameRate)}`}
                min={0}
                max={Math.max(
                  Math.round(frameRate * (phase.kind === 'wait' ? 2 : 5)),
                  phase.frames,
                )}
                step={1}
                value={phase.frames}
                onChange={(event) => onChange(phase.key, event.currentTarget.valueAsNumber)}
              />
              <span className="tl-behavior-frame-input">
                <input
                  id={`${labelId}-frames`}
                  type="number"
                  min={0}
                  max={360000}
                  step={1}
                  value={phase.frames}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(value))
                      onChange(phase.key, Math.min(360000, Math.max(0, Math.round(value))));
                  }}
                />
                <span>f</span>
              </span>
              <small>{behaviorSeconds(phase.frames, frameRate)}</small>
            </div>
          );
        })}
      </div>
      {minimumTotalFrames > sequenceFrames && (
        <p className="tl-muted">
          Other shared movement runs alongside these phases for{' '}
          {behaviorSeconds(minimumTotalFrames, frameRate)}. Its timing is preserved.
        </p>
      )}
      {tailFrames > 0 && (
        <p className="tl-muted">
          An additional hold of {behaviorSeconds(tailFrames, frameRate)} is preserved after the
          movement. Adjust it in Advanced details.
        </p>
      )}
    </fieldset>
  );
}
