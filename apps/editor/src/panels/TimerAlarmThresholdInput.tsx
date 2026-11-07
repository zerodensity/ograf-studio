import { useEffect, useState } from 'react';
import { formatTimerAlarmThreshold, parseTimerAlarmThreshold } from '../state/timerAlarmRules';

export function TimerAlarmThresholdInput({
  value,
  onChange,
  label = 'Alarm threshold',
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(() => formatTimerAlarmThreshold(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(formatTimerAlarmThreshold(value));
    setInvalid(false);
  }, [value]);
  return (
    <input
      className="timer-alarm-threshold"
      type="text"
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={
        invalid
          ? 'Enter a non-negative duration, such as 00:05 or 5 seconds.'
          : 'Duration: mm:ss, hh:mm:ss, or seconds'
      }
      value={draft}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        setInvalid(false);
      }}
      onBlur={() => {
        const parsed = parseTimerAlarmThreshold(draft);
        setInvalid(parsed === null);
        if (parsed !== null) {
          setDraft(formatTimerAlarmThreshold(parsed));
          if (parsed !== value) onChange(parsed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          setDraft(formatTimerAlarmThreshold(value));
          setInvalid(false);
        }
      }}
    />
  );
}
