import type { Composition, Layer } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';

export function LoopTimingEditor({
  layer,
  composition,
}: {
  layer: Layer;
  composition: Composition;
}) {
  const setLoop = useProjectStore((state) => state.setLayerLoop);
  const timing = layer.loop?.timing;
  const fields = composition.dataFields.filter(
    (field) => field.type === 'number' || field.type === 'integer',
  );
  if (!layer.loop) return null;
  const update = (next: NonNullable<typeof timing>) => {
    const peers = timing
      ? composition.layers.filter((entry) => entry.loop?.timing?.groupId === timing.groupId)
      : [layer];
    for (const peer of peers) setLoop(peer.id, { timing: next });
  };
  return (
    <details className="timeline-loop-advanced">
      <summary>Loop transport and hold time</summary>
      {!timing ? (
        <button
          type="button"
          disabled={!fields.length}
          onClick={() =>
            update({
              groupId: layer.loop!.name,
              holdFieldId: fields[0]!.id,
              holdRanges: [
                {
                  startFrame: 0,
                  endFrame: Math.min(layer.loop!.durationFrames, composition.frameRate * 4),
                },
              ],
            })
          }
        >
          Link hold duration to data
        </button>
      ) : (
        <>
          <label>
            Transport group
            <input
              aria-label="Loop transport group"
              value={timing.groupId}
              onChange={(event) => update({ ...timing, groupId: event.target.value })}
            />
          </label>
          <label>
            Hold seconds
            <select
              aria-label="Loop hold duration field"
              value={timing.holdFieldId}
              onChange={(event) => update({ ...timing, holdFieldId: event.target.value })}
            >
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label || field.key}
                </option>
              ))}
            </select>
          </label>
          {timing.holdRanges.map((range, index) => (
            <div className="timeline-loop-grid" key={index}>
              <label>
                Hold from
                <input
                  aria-label={`Hold ${index + 1} start frame`}
                  type="number"
                  min={index ? timing.holdRanges[index - 1]!.endFrame : 0}
                  max={range.endFrame - 1}
                  value={range.startFrame}
                  onChange={(event) =>
                    update({
                      ...timing,
                      holdRanges: timing.holdRanges.map((item, i) =>
                        i === index ? { ...item, startFrame: Number(event.target.value) } : item,
                      ),
                    })
                  }
                />
              </label>
              <label>
                To frame
                <input
                  aria-label={`Hold ${index + 1} end frame`}
                  type="number"
                  min={range.startFrame + 1}
                  max={timing.holdRanges[index + 1]?.startFrame ?? layer.loop!.durationFrames}
                  value={range.endFrame}
                  onChange={(event) =>
                    update({
                      ...timing,
                      holdRanges: timing.holdRanges.map((item, i) =>
                        i === index ? { ...item, endFrame: Number(event.target.value) } : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`Remove hold ${index + 1}`}
                disabled={timing.holdRanges.length === 1}
                onClick={() =>
                  update({ ...timing, holdRanges: timing.holdRanges.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={timing.holdRanges.at(-1)!.endFrame >= layer.loop.durationFrames}
            onClick={() =>
              update({
                ...timing,
                holdRanges: [
                  ...timing.holdRanges,
                  {
                    startFrame: timing.holdRanges.at(-1)!.endFrame,
                    endFrame: layer.loop!.durationFrames,
                  },
                ],
              })
            }
          >
            + Hold range
          </button>
          <button type="button" onClick={() => setLoop(layer.id, { timing: null })}>
            Unlink
          </button>
          <p className="inspector-hint">
            Use the same group, ruler and hold ranges on related clips. Preview controls pause or
            advance this group independently. Change frames retain their authored speed.
          </p>
        </>
      )}
    </details>
  );
}
