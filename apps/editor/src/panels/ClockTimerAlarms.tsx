import type { ClockTimerSettings } from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { sortedTimerAlarmRules } from '../state/timerAlarmRules';
import { TimerAlarmThresholdInput } from './TimerAlarmThresholdInput';

export function ClockTimerAlarms({
  layerId,
  clock,
}: {
  layerId: string;
  clock: ClockTimerSettings;
}) {
  const composition = useActiveComposition();
  const alarms = sortedTimerAlarmRules(composition.layers, layerId, clock.mode);
  const updateRule = useProjectStore((state) => state.updateLayerVisualRule);
  const removeRule = useProjectStore((state) => state.removeLayerVisualRule);
  const addAlarm = useProjectStore((state) => state.addClockTimerAlarm);
  const isClock = clock.mode === 'clock';
  return (
    <div className="clock-timer-alarms" role="group" aria-label="Timer alarms">
      <div className="clock-timer-alarms-heading">
        <span>Alarms</span>
        <button
          type="button"
          disabled={isClock}
          onClick={() => {
            runDiscreteHistoryStep(() => addAlarm(layerId), 'Add timer alarm');
          }}
        >
          + Add alarm
        </button>
      </div>
      {isClock ? (
        <p className="inspector-hint">
          Alarms run in Count up or Count down mode. Existing alarms are preserved.
        </p>
      ) : null}
      {!isClock && !alarms.length ? (
        <p className="inspector-hint">Add an alarm, then choose its actions in Rules.</p>
      ) : null}
      {alarms.map(({ owner, rule, alarm }) => (
        <div key={`${owner.id}:${rule.id}`} className="clock-timer-alarm-row">
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={owner.isLocked || isClock}
            aria-label={`Enable alarm: ${rule.name}`}
            onChange={(event) =>
              runDiscreteHistoryStep(
                () => updateRule(owner.id, rule.id, { enabled: event.currentTarget.checked }),
                event.currentTarget.checked ? 'Enable timer alarm' : 'Disable timer alarm',
              )
            }
          />
          <span className="clock-timer-alarm-at">At</span>
          <fieldset disabled={owner.isLocked || isClock}>
            <TimerAlarmThresholdInput
              value={alarm.thresholdMs}
              label={`Alarm time: ${rule.name}`}
              onChange={(thresholdMs) =>
                runDiscreteHistoryStep(
                  () => updateRule(owner.id, rule.id, { timerAlarm: { ...alarm, thresholdMs } }),
                  'Change alarm time',
                )
              }
            />
          </fieldset>
          <span
            className="clock-timer-alarm-name"
            title={rule.actions.length ? rule.name : `${rule.name}: choose an action in Rules`}
          >
            {rule.name}
            {!rule.actions.length ? ' · Choose action' : ''}
          </span>
          <button
            type="button"
            title={`Edit ${rule.name} in Rules`}
            aria-label={`Edit alarm rule: ${rule.name}`}
            onClick={() =>
              usePaneRequestStore.getState().revealRule(composition.id, owner.id, rule.id)
            }
          >
            Edit rule
          </button>
          <button
            type="button"
            className="clock-timer-alarm-remove"
            title="Delete alarm and its rule"
            aria-label={`Delete alarm: ${rule.name}`}
            disabled={owner.isLocked}
            onClick={() =>
              runDiscreteHistoryStep(() => removeRule(owner.id, rule.id), 'Delete timer alarm')
            }
          >
            ×
          </button>
        </div>
      ))}
      {alarms.length ? (
        <p className="inspector-hint">Once per run. Reset or Restart rearms every alarm.</p>
      ) : null}
    </div>
  );
}
