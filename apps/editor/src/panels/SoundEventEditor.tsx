import {
  createId,
  getTotalFrames,
  mediaCueStartFrame,
  type MediaCue,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSoundEventSelectionStore } from '../state/soundEventSelectionStore';
import { soundEventSource } from '../state/soundEvents';
import { FrameDurationControl } from './FrameDurationControl';
import { MillisecondDurationInput } from './MillisecondDurationControl';
import './SoundEventEditor.css';

export function SoundEventEditor({ cue }: { cue: MediaCue }) {
  const composition = useActiveComposition();
  const updateMediaCue = useProjectStore((state) => state.updateMediaCue);
  const removeMediaCue = useProjectStore((state) => state.removeMediaCue);
  const selectSoundEvent = useSoundEventSelectionStore((state) => state.selectSoundEvent);
  const source = soundEventSource(cue);
  const audioAssets = composition.assets.filter((asset) => asset.kind === 'audio');
  const frame = mediaCueStartFrame(cue, composition) ?? 0;
  const maxFrame = getTotalFrames(composition);
  const update = (patch: Partial<MediaCue>) => updateMediaCue(cue.id, patch);

  return (
    <div className="sound-event-editor">
      <label>
        Name
        <input value={cue.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label>
        Audio file
        <select
          value={source?.src.startsWith('asset:') ? source.src.slice('asset:'.length) : ''}
          onChange={(event) => {
            const asset = audioAssets.find((candidate) => candidate.id === event.target.value);
            if (!asset) return;
            const sourceId = source?.id ?? createId('media-source');
            update({
              sources: [
                {
                  id: sourceId,
                  name: asset.name,
                  kind: 'clip',
                  mediaType: 'audio',
                  src: `asset:${asset.id}`,
                },
              ],
              activeSourceId: sourceId,
            });
          }}
        >
          {audioAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <FrameDurationControl
        label="Timeline start"
        frames={frame}
        frameRate={composition.frameRate}
        minFrames={0}
        maxFrames={maxFrame}
        onChange={(startFrame) => update({ trigger: { type: 'timeline', startFrame } })}
      />
      <label>
        Volume
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={cue.volume}
          onChange={(event) =>
            update({ volume: Math.max(0, Math.min(1, Number(event.target.value))) })
          }
        />
      </label>
      <label>
        Start offset
        <MillisecondDurationInput
          label="Sound start offset"
          value={cue.trimStartMs}
          frameRate={composition.frameRate}
          onChange={(trimStartMs) => update({ trimStartMs: trimStartMs ?? cue.trimStartMs })}
        />
      </label>
      <label>
        Retrigger
        <select
          value={cue.retrigger}
          onChange={(event) => update({ retrigger: event.target.value as MediaCue['retrigger'] })}
        >
          <option value="restart">Restart</option>
          <option value="resume">Resume</option>
          <option value="ignore">Ignore while playing</option>
        </select>
      </label>
      <button
        type="button"
        className="sound-event-remove"
        onClick={() => {
          removeMediaCue(cue.id);
          selectSoundEvent(null);
        }}
      >
        Delete Sound Event
      </button>
    </div>
  );
}
