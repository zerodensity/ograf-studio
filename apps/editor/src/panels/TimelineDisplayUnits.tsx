import { useWorkspaceStore } from '../state/workspaceStore';
import { nextTimelineDurationUnit, timelineDurationUnits as units } from './timelineDurationUnits';

/** The same saved editor preference controls the ruler and duration fields throughout Studio. */
export function TimelineDisplayUnits() {
  const selected = useWorkspaceStore((state) => state.editorPreferences.durationUnit ?? 'seconds');
  const setPreferences = useWorkspaceStore((state) => state.updateEditorPreferences);
  const current = units.find((unit) => unit.value === selected) ?? units[0];
  const next = units.find((unit) => unit.value === nextTimelineDurationUnit(current.value))!;
  return (
    <button
      type="button"
      className="timeline-display-units"
      data-duration-unit-cycle
      aria-label={`Duration display: ${current.label}. Switch to ${next.label}.`}
      title={`Durations: ${current.label}. Click for ${next.label} throughout Studio.`}
      onClick={() => setPreferences({ durationUnit: next.value })}
    >
      {current.short}
    </button>
  );
}
