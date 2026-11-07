import { useEffect, useMemo, useState } from 'react';
import type {
  ComponentDefinition,
  TransitionLogicDefinition,
  TransitionLogicReferences,
} from '@ograf-editor/scene-model';
import {
  applyResize,
  clearResize,
  readResizeSetting,
  RESIZE_ANCHORS,
  resizeTargets,
  type ResizeAnchor,
} from '../state/transitionResize';
import { resizeTiming, setResizeTiming } from '../state/transitionResizeTiming';
import { FrameDurationControl } from './FrameDurationControl';
import './TransitionResizeEditor.css';

export interface TransitionResizeEditorProps {
  definition: TransitionLogicDefinition;
  components: ComponentDefinition[];
  references: TransitionLogicReferences;
  triggerSlotId: string;
  affectedSlotId: string;
  affectedStateId: string | null;
  triggerStateId: string | null;
  affectedName: string;
  triggerName: string;
  frameRate: number;
  locked?: string;
  onPhaseChange?: (phase: 'enter' | 'exit') => void;
  /** Controlled object selection, shared with the stage's drag handles. */
  selectedKey?: string;
  onSelectedKeyChange?: (key: string) => void;
  run: (updater: (definition: TransitionLogicDefinition) => TransitionLogicDefinition) => boolean;
}

function positiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function frameNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Explicit element sizing uses the same layout transition as the Make room controls. */
export function TransitionResizeEditor({
  definition,
  components,
  references,
  triggerSlotId,
  affectedSlotId,
  affectedStateId,
  triggerStateId,
  affectedName,
  triggerName,
  frameRate,
  locked,
  onPhaseChange,
  selectedKey: controlledKey,
  onSelectedKeyChange,
  run,
}: TransitionResizeEditorProps) {
  const targets = useMemo(
    () => resizeTargets(definition, components, affectedSlotId, affectedStateId),
    [definition, components, affectedSlotId, affectedStateId],
  );
  const [ownKey, setOwnKey] = useState('');
  const selectedKey = controlledKey ?? ownKey;
  const setSelectedKey = (key: string) => {
    setOwnKey(key);
    onSelectedKeyChange?.(key);
  };
  const target =
    targets.find((candidate) => candidate.key === selectedKey) ??
    targets.find((candidate) => !candidate.disabledReason) ??
    targets[0];
  const setting = target
    ? readResizeSetting(definition, triggerSlotId, affectedSlotId, target)
    : null;
  const otherContributors = target
    ? [
        ...new Set(
          (definition.layoutRules ?? [])
            .filter(
              (rule) =>
                rule.slotId === affectedSlotId &&
                rule.whenSlotId !== triggerSlotId &&
                rule.sharedOffsets.some(
                  (value) =>
                    value.instanceId === target.instanceId &&
                    value.sourceLayerId === target.sourceLayerId &&
                    value.value !== 0,
                ),
            )
            .map((rule) => definition.slots.find((slot) => slot.id === rule.whenSlotId)?.name)
            .filter((name): name is string => !!name),
        ),
      ]
    : [];
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
  const timingResult = useMemo(() => {
    try {
      return {
        value: resizeTiming(definition, triggerSlotId, triggerStateId, phase, frameRate),
        issue: '',
      };
    } catch (reason) {
      return {
        value: null,
        issue: reason instanceof Error ? reason.message : 'Choose a valid transition for timing.',
      };
    }
  }, [definition, triggerSlotId, triggerStateId, phase, frameRate]);
  const timing = timingResult.value;
  const [startFrame, setStartFrame] = useState('');
  const [durationFrames, setDurationFrames] = useState('');
  const [error, setError] = useState('');
  const fingerprint = useMemo(() => JSON.stringify(definition), [definition]);
  const targetKey = target?.key;
  const storedWidth = setting?.width;
  const storedHeight = setting?.height;

  useEffect(() => {
    setWidth(storedWidth === undefined ? '' : String(storedWidth));
    setHeight(storedHeight === undefined ? '' : String(storedHeight));
    setError('');
  }, [targetKey, affectedStateId, fingerprint, storedWidth, storedHeight]);

  useEffect(() => {
    setStartFrame(timing ? String(timing.startFrame) : '');
    setDurationFrames(timing ? String(timing.durationFrames) : '');
    setError('');
  }, [fingerprint, triggerStateId, phase, timing]);

  const commit = (
    update: (current: TransitionLogicDefinition) => TransitionLogicDefinition,
  ): boolean => {
    let failure = '';
    let committed = false;
    try {
      committed = run((current) => {
        try {
          return update(current);
        } catch (reason) {
          failure = reason instanceof Error ? reason.message : 'The resize could not be saved.';
          throw reason;
        }
      });
    } catch (reason) {
      failure = reason instanceof Error ? reason.message : 'The resize could not be saved.';
    }
    setError(
      committed ? '' : failure || 'Could not save resize. Review the transition configuration.',
    );
    return committed;
  };

  const geometryDisabled = !!locked || !target || !!target.disabledReason;
  const commitGeometry = (
    anchor: ResizeAnchor = setting?.anchor ?? 'top-left',
    explicitAnchor = false,
  ) => {
    if (geometryDisabled || !target || !setting) return;
    const nextWidth = positiveNumber(width);
    const nextHeight = positiveNumber(height);
    if (nextWidth === null || nextHeight === null) {
      setError('Width and height must be numbers greater than zero.');
      return;
    }
    if (
      nextWidth === setting.width &&
      nextHeight === setting.height &&
      anchor === setting.anchor &&
      (!setting.issue || !explicitAnchor)
    ) {
      setError('');
      return;
    }
    if (setting.issue && !explicitAnchor) {
      setError('Choose an anchor before replacing this object’s custom position and size offsets.');
      return;
    }
    commit((current) =>
      applyResize(
        current,
        triggerSlotId,
        affectedSlotId,
        target,
        { width: nextWidth, height: nextHeight, anchor },
        references,
      ),
    );
  };
  const timingDisabled = !!locked || !timing;
  const commitTiming = (start = startFrame, duration = durationFrames) => {
    if (timingDisabled || !timing) return;
    const nextStart = frameNumber(start);
    const nextDuration = frameNumber(duration);
    if (
      nextStart === null ||
      nextStart > 1_000_000 ||
      nextDuration === null ||
      nextDuration < 1 ||
      nextDuration > 1_000_000
    ) {
      setError('Use whole frames: start from 0 to 1000000, duration from 1 to 1000000.');
      return;
    }
    if (nextStart === timing.startFrame && nextDuration === timing.durationFrames) {
      setError('');
      return;
    }
    commit((current) =>
      setResizeTiming(
        current,
        triggerSlotId,
        triggerStateId,
        phase,
        { startFrame: nextStart, durationFrames: nextDuration },
        references,
      ),
    );
  };

  return (
    <section className="tr-resize-editor" aria-label={`Resize elements in ${affectedName}`}>
      <div className="tr-resize-heading">
        <h4>Resize in {affectedName}</h4>
        <button
          type="button"
          disabled={!!locked || !target || !setting?.configured}
          title="Remove only this object's resize; keep other objects and timing"
          onClick={() => {
            if (target)
              commit((current) =>
                clearResize(current, triggerSlotId, affectedSlotId, target, references),
              );
          }}
        >
          Reset size
        </button>
      </div>
      {!targets.length ? (
        <p className="tr-muted">Add a shared component to this template to resize its elements.</p>
      ) : (
        <>
          <label className="tr-resize-target">
            <span>Object</span>
            <select
              aria-label="Resize object"
              value={target?.key ?? ''}
              onChange={(event) => {
                setSelectedKey(event.currentTarget.value);
                setError('');
              }}
            >
              {targets.map((candidate) => (
                <option key={candidate.key} value={candidate.key} title={candidate.disabledReason}>
                  {candidate.label}
                  {candidate.disabledReason ? ` — ${candidate.disabledReason}` : ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="tr-resize-fields" disabled={geometryDisabled}>
            <label>
              <span>Width</span>
              <span className="tr-resize-number">
                <input
                  aria-label="Resize width"
                  type="number"
                  min="0.01"
                  step="any"
                  value={width}
                  onChange={(event) => setWidth(event.currentTarget.value)}
                  onBlur={() => commitGeometry()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitGeometry();
                    }
                  }}
                />
                <span>px</span>
              </span>
            </label>
            <label>
              <span>Height</span>
              <span className="tr-resize-number">
                <input
                  aria-label="Resize height"
                  type="number"
                  min="0.01"
                  step="any"
                  value={height}
                  onChange={(event) => setHeight(event.currentTarget.value)}
                  onBlur={() => commitGeometry()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitGeometry();
                    }
                  }}
                />
                <span>px</span>
              </span>
            </label>
            <label className="tr-resize-anchor">
              <span>Anchor</span>
              <select
                aria-label="Resize anchor"
                value={
                  setting?.issue && !target?.disabledReason ? '' : (setting?.anchor ?? 'top-left')
                }
                title="This point stays fixed while the object resizes"
                onChange={(event) =>
                  commitGeometry(event.currentTarget.value as ResizeAnchor, true)
                }
              >
                {!!setting?.issue && !target?.disabledReason && (
                  <option value="" disabled>
                    Choose anchor
                  </option>
                )}
                {RESIZE_ANCHORS.map((anchor) => (
                  <option key={anchor.value} value={anchor.value}>
                    {anchor.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <p className="tr-muted">
            Applies while {triggerName} is on air; only its adjustment is removed when it leaves.
            {!!otherContributors.length && (
              <> Other active lanes add their adjustments: {otherContributors.join(', ')}.</>
            )}
          </p>
          <label className="tr-resize-target">
            <span>Timing</span>
            <select
              aria-label="Resize phase"
              value={phase}
              onChange={(event) => {
                const next = event.currentTarget.value as 'enter' | 'exit';
                setPhase(next);
                onPhaseChange?.(next);
              }}
            >
              <option value="enter">When {triggerName} appears</option>
              <option value="exit">When {triggerName} leaves</option>
            </select>
          </label>
          <fieldset className="tr-resize-fields" disabled={timingDisabled}>
            <FrameDurationControl
              compact
              label="Resize start"
              frameRate={frameRate}
              minFrames={0}
              maxFrames={1_000_000}
              disabled={timingDisabled}
              frames={Number(startFrame) || 0}
              onChange={(frames) => {
                const next = String(frames);
                setStartFrame(next);
                commitTiming(next, durationFrames);
              }}
            />
            <FrameDurationControl
              compact
              label="Resize duration"
              frameRate={frameRate}
              minFrames={1}
              maxFrames={1_000_000}
              disabled={timingDisabled}
              frames={Number(durationFrames) || 1}
              onChange={(frames) => {
                const next = String(frames);
                setDurationFrames(next);
                commitTiming(startFrame, next);
              }}
            />
          </fieldset>
          <p className="tr-muted">
            Timing applies to all layout adjustments triggered by {triggerName} in this transition.
          </p>
          {!!timingResult.issue && <p className="tr-muted">{timingResult.issue}</p>}
          {!!target?.disabledReason && <p className="tr-error">{target.disabledReason}</p>}
          {!!setting?.issue && setting.issue !== target?.disabledReason && (
            <p className="tr-error">{setting.issue}</p>
          )}
        </>
      )}
      {!!locked && <p className="tr-muted">{locked}</p>}
      {!!error && (
        <p className="tr-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
