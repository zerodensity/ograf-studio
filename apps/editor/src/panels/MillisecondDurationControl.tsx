import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { formatMillisecondDuration, resolveMillisecondDraft } from './durationInput';

/** Editable exact-millisecond values with the shared duration display preference. */
export function MillisecondDurationInput({
  label,
  value,
  frameRate,
  onChange,
  allowNull = false,
  minMs = 0,
  maxMs = Number.MAX_SAFE_INTEGER,
  disabled = false,
}: {
  label: string;
  value: number | null;
  frameRate: number;
  onChange: (ms: number | null) => void;
  allowNull?: boolean;
  minMs?: number;
  maxMs?: number;
  disabled?: boolean;
}) {
  const unit = useWorkspaceStore((state) => state.editorPreferences.durationUnit ?? 'seconds');
  const formatted = value === null ? '' : formatMillisecondDuration(value, frameRate, unit);
  const [draft, setDraft] = useState(formatted);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(formatted);
    setInvalid(false);
  }, [formatted]);
  const commit = () => {
    const result = resolveMillisecondDraft(
      draft,
      formatted,
      frameRate,
      unit,
      allowNull,
      minMs,
      maxMs,
    );
    if (result.kind === 'invalid') {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (result.kind === 'unchanged') return;
    if (result.value !== value) onChange(result.value);
    setDraft(result.value === null ? '' : formatMillisecondDuration(result.value, frameRate, unit));
  };
  return (
    <input
      aria-label={label}
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={draft}
      placeholder={allowNull ? 'Automatic' : undefined}
      aria-invalid={invalid || undefined}
      title={
        invalid
          ? 'Enter a duration such as 0.5s, 500ms, 12f or 00:00:01:05.'
          : 'Enter seconds, milliseconds, frames or non-drop timecode. Stored millisecond precision is preserved.'
      }
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(formatted);
          setInvalid(false);
        }
      }}
    />
  );
}
