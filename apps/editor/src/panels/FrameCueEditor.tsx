import { useEffect, useState } from 'react';
import {
  MAX_FRAME_CUE_NAME_LENGTH,
  MAX_FRAME_CUE_PAYLOAD_BYTES,
  type FrameCue,
  type LogicJsonValue,
} from '@ograf-editor/scene-model';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useProjectStore } from '../state/projectStore';

function cueDraft(cue: FrameCue) {
  return {
    name: cue.name,
    frame: String(cue.frame),
    payload: cue.payload === undefined ? '' : JSON.stringify(cue.payload, null, 2),
  };
}

export function FrameCueEditor({
  cue,
  cues,
  endFrame,
  onSelect,
  onDelete,
}: {
  cue: FrameCue;
  cues: readonly FrameCue[];
  endFrame: number;
  onSelect(id: string): void;
  onDelete(): void;
}) {
  const [draft, setDraft] = useState(() => cueDraft(cue));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(cueDraft(cue));
    setError('');
  }, [cue]);

  const apply = () => {
    try {
      if (!draft.frame.trim()) throw new Error('Enter a frame number.');
      let payload: LogicJsonValue | undefined;
      if (draft.payload.trim()) {
        if (draft.payload.length > MAX_FRAME_CUE_PAYLOAD_BYTES * 4)
          throw new Error('The JSON payload is too large.');
        try {
          payload = JSON.parse(draft.payload) as LogicJsonValue;
        } catch {
          throw new Error('Enter valid JSON for the payload, or leave it blank.');
        }
      }
      runDiscreteHistoryStep(
        () =>
          useProjectStore.getState().updateFrameCue(cue.id, {
            name: draft.name,
            frame: Number(draft.frame),
            ...(payload === undefined ? {} : { payload }),
          }),
        'Edit frame cue',
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <form
      className="timeline-frame-cue-editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {cues.length > 1 && (
        <label>
          Cue
          <select value={cue.id} onChange={(event) => onSelect(event.currentTarget.value)}>
            {cues.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · frame {item.frame}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Name
        <input
          value={draft.name}
          maxLength={MAX_FRAME_CUE_NAME_LENGTH}
          onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
        />
      </label>
      <label>
        Frame
        <input
          type="number"
          min={0}
          max={endFrame}
          step={1}
          value={draft.frame}
          onChange={(event) => setDraft({ ...draft, frame: event.currentTarget.value })}
        />
      </label>
      <label>
        Payload (JSON, optional)
        <textarea
          value={draft.payload}
          rows={3}
          maxLength={MAX_FRAME_CUE_PAYLOAD_BYTES * 4}
          onChange={(event) => setDraft({ ...draft, payload: event.currentTarget.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="timeline-frame-cue-actions">
        <button type="submit">Apply</button>
        <button
          type="button"
          onClick={() => {
            runDiscreteHistoryStep(
              () => useProjectStore.getState().removeFrameCue(cue.id),
              'Delete frame cue',
            );
            onDelete();
          }}
        >
          Delete cue
        </button>
      </div>
    </form>
  );
}
