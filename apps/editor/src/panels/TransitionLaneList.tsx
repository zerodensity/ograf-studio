import type { TransitionLogicDefinition, TransitionLogicSlot } from '@ograf-editor/scene-model';
import { layerStates } from '../state/transitionChoreography';

export function TransitionLaneList({
  definition,
  lanes,
  activeLaneId,
  locked,
  onSelectLane,
  onAddLane,
}: {
  definition: TransitionLogicDefinition;
  lanes: readonly TransitionLogicSlot[];
  activeLaneId: string | undefined;
  locked?: string;
  onSelectLane: (slotId: string) => void;
  onAddLane: () => void;
}) {
  return (
    <nav className="tr-lane-list" aria-label="Transition lanes">
      <strong className="tr-lane-list-title">Lanes</strong>
      <div className="tr-lane-list-items">
        {lanes.map((slot) => {
          const states = layerStates(definition, slot.id);
          return (
            <button
              key={slot.id}
              type="button"
              className="tr-lane-list-item"
              aria-pressed={slot.id === activeLaneId}
              aria-label={`${slot.name}, ${states.length} ${states.length === 1 ? 'template' : 'templates'}`}
              title={slot.name}
              onClick={() => onSelectLane(slot.id)}
            >
              <span>{slot.name}</span>
              <small>{states.length}</small>
            </button>
          );
        })}
      </div>
      <button type="button" className="tr-add-lane" disabled={!!locked} onClick={onAddLane}>
        + Add lane
      </button>
    </nav>
  );
}
