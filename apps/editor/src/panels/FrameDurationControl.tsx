import { useEffect, useState, type ReactNode } from 'react';
import { PropertyRow } from '../components/PropertyRow';
import { useWorkspaceStore } from '../state/workspaceStore';
import {
  formatDurationInput,
  parseDurationInput,
  resolveFrameDurationDraft,
} from './durationInput';
import './FrameDurationControl.css';

interface FrameDurationControlProps {
  label: string;
  frames: number;
  frameRate: number;
  minFrames: number;
  maxFrames?: number;
  disabled?: boolean;
  onChange: (frames: number) => void;
  compact?: boolean;
  propertyColumns?: boolean;
  labelSuffix?: ReactNode;
}

/** Frame-aligned storage with a user-selectable duration display and explicit-unit input. */
export function FrameDurationControl({
  label,
  frames,
  frameRate,
  minFrames,
  maxFrames,
  disabled = false,
  onChange,
  compact = false,
  propertyColumns = false,
  labelSuffix,
}: FrameDurationControlProps) {
  const unit = useWorkspaceStore((state) => state.editorPreferences.durationUnit ?? 'seconds');
  const formatted = formatDurationInput(frames, frameRate, unit);
  const [draft, setDraft] = useState(formatted);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);
  const commit = () => {
    const parsed = resolveFrameDurationDraft(draft, formatted, frameRate, unit);
    if (parsed === undefined) {
      setMessage('');
      return;
    }
    if (!parsed) {
      setMessage('Enter a duration such as 0.5s, 500ms, 12f or 00:00:01:05.');
      return;
    }
    const next = Math.min(maxFrames ?? Number.MAX_SAFE_INTEGER, Math.max(minFrames, parsed.frames));
    if (next !== frames) onChange(next);
    setDraft(formatDurationInput(next, frameRate, unit));
    setMessage(
      parsed.rounded || next !== parsed.frames
        ? `${draft.trim()} → ${next}f at ${Number(frameRate.toFixed(3))} fps`
        : '',
    );
  };
  return (
    <div className={`frame-duration-control${compact ? ' compact' : ''}`}>
      <PropertyRow
        resizable={propertyColumns}
        help="Enter seconds, milliseconds, frames or non-drop timecode. Values are stored as whole frames."
      >
        <span>{label}</span>
        <input
          aria-label={/duration$/i.test(label) ? label : `${label} duration`}
          type="text"
          disabled={disabled}
          inputMode="decimal"
          value={draft}
          aria-invalid={Boolean(message && !parseDurationInput(draft, frameRate, unit))}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setMessage('');
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(formatted);
              setMessage('');
            }
          }}
        />
      </PropertyRow>
      {(message || labelSuffix) && (
        <div
          className={`frame-duration-provenance ${message ? 'frame-duration-warning' : 'frame-duration-exact'}`}
        >
          <span role={message ? 'status' : undefined}>{message}</span>
          {labelSuffix}
        </div>
      )}
    </div>
  );
}
