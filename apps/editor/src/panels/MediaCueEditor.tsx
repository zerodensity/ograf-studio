import {
  createId,
  mediaCueEffectiveDurationFrames,
  mediaCueSourceDurationMs,
  mediaCueTrimmedDurationMs,
  type MediaCue,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { WebcamPreviewControls } from '../components/WebcamPreviewControls';
import { SourceCropEditor } from './SourceCropEditor';
import { lifecycleLabel } from './lifecycleLabels';
import { FrameDurationControl } from './FrameDurationControl';
import { MillisecondDurationInput } from './MillisecondDurationControl';
import './MediaCueEditor.css';

export function MediaCueEditor({ cue }: { cue: MediaCue }) {
  const composition = useActiveComposition();
  const updateMediaCue = useProjectStore((state) => state.updateMediaCue);
  const removeMediaCue = useProjectStore((state) => state.removeMediaCue);
  const playableAssets = composition.assets.filter(
    (asset) => asset.kind === 'audio' || asset.kind === 'media',
  );
  const activeSource = cue.sources.find((source) => source.id === cue.activeSourceId) ?? null;
  const sourceDurationMs = mediaCueSourceDurationMs(cue, composition.assets);
  const trimmedDurationMs = mediaCueTrimmedDurationMs(cue, composition.assets);
  const effectiveDurationFrames = mediaCueEffectiveDurationFrames(cue, composition);
  const update = (patch: Partial<MediaCue>) => updateMediaCue(cue.id, patch);
  const cropSource = activeSource?.kind === 'clip' ? activeSource.src : activeSource?.fallback;
  const cropPreview = cropSource?.startsWith('asset:')
    ? composition.assets.find((asset) => asset.id === cropSource.slice('asset:'.length))?.dataUri
    : cropSource;

  const addSource = (value: string) => {
    if (!value) return;
    const sourceId = createId('media-source');
    if (value === 'live') {
      update({
        sources: [
          ...cue.sources,
          { id: sourceId, name: 'Live input', kind: 'live', tag: 'live.input' },
        ],
        activeSourceId: sourceId,
      });
      return;
    }
    const asset = composition.assets.find((candidate) => candidate.id === value);
    if (!asset || (asset.kind !== 'audio' && asset.kind !== 'media')) return;
    update({
      sources: [
        ...cue.sources,
        {
          id: sourceId,
          name: asset.name,
          kind: 'clip',
          mediaType: asset.kind === 'audio' ? 'audio' : 'video',
          src: `asset:${asset.id}`,
        },
      ],
      activeSourceId: sourceId,
    });
  };

  return (
    <div className="media-cue-editor">
      <label>
        Name
        <input value={cue.name} onChange={(event) => update({ name: event.target.value })} />
      </label>

      <div className="media-cue-editor-section">
        <strong>Source</strong>
        <label>
          Active source
          <select
            value={cue.activeSourceId ?? ''}
            onChange={(event) => update({ activeSourceId: event.target.value || null })}
          >
            <option value="">None</option>
            {cue.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} · {source.kind === 'live' ? 'Live' : source.mediaType}
              </option>
            ))}
          </select>
        </label>
        <label>
          Add source
          <select value="" onChange={(event) => addSource(event.target.value)}>
            <option value="">Choose…</option>
            {playableAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.kind === 'audio' ? 'Audio' : 'Video'}
              </option>
            ))}
            <option value="live">Live input</option>
          </select>
        </label>
        {activeSource?.kind === 'live' ? (
          <>
            <label>
              Live tag
              <input
                value={activeSource.tag}
                onChange={(event) =>
                  update({
                    sources: cue.sources.map((source) =>
                      source.id === activeSource.id && source.kind === 'live'
                        ? { ...source, tag: event.target.value }
                        : source,
                    ),
                  })
                }
              />
            </label>
            <WebcamPreviewControls tag={activeSource.tag} />
          </>
        ) : null}
      </div>

      <div className="media-cue-editor-section">
        <strong>Video target</strong>
        <label>
          Paint layer
          <select
            value={cue.visual.targetLayerId ?? ''}
            disabled={activeSource?.kind === 'clip' && activeSource.mediaType === 'audio'}
            onChange={(event) =>
              update({
                visual: { ...cue.visual, targetLayerId: event.target.value || null },
              })
            }
          >
            <option value="">No visual target</option>
            {composition.layers
              .filter((layer) => 'fill' in layer.element)
              .map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Fit
          <select
            value={cue.visual.fit}
            onChange={(event) =>
              update({
                visual: {
                  ...cue.visual,
                  fit: event.target.value as MediaCue['visual']['fit'],
                },
              })
            }
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="fill">Stretch</option>
          </select>
        </label>
        <SourceCropEditor
          layerId={cue.visual.targetLayerId ?? undefined}
          value={cue.visual.crop}
          src={cropPreview}
          video={activeSource?.kind === 'clip' && activeSource.mediaType === 'video'}
          disabled={
            !cue.visual.targetLayerId ||
            (activeSource?.kind === 'clip' && activeSource.mediaType === 'audio')
          }
          onChange={(crop) => update({ visual: { ...cue.visual, crop } })}
        />
        <div className="media-cue-inline-fields">
          <label>
            Position X
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={cue.visual.positionX}
              onChange={(event) =>
                update({
                  visual: { ...cue.visual, positionX: Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Position Y
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={cue.visual.positionY}
              onChange={(event) =>
                update({
                  visual: { ...cue.visual, positionY: Number(event.target.value) },
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="media-cue-editor-section">
        <strong>Trigger</strong>
        <label>
          Trigger type
          <select
            value={cue.trigger.type}
            onChange={(event) => {
              const type = event.target.value as MediaCue['trigger']['type'];
              update({
                trigger:
                  type === 'timeline'
                    ? { type, startFrame: 0 }
                    : type === 'lifecycle'
                      ? { type, keyframeId: composition.keyframes[0]!.id }
                      : type === 'customAction'
                        ? { type, actionId: composition.customActions[0]?.actionId ?? '' }
                        : { type: 'manual' },
              });
            }}
          >
            <option value="timeline">Timeline</option>
            <option value="lifecycle">Lifecycle</option>
            <option value="customAction">Custom Action</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        {cue.trigger.type === 'timeline' ? (
          <FrameDurationControl
            label="Start"
            frames={cue.trigger.startFrame}
            frameRate={composition.frameRate}
            minFrames={0}
            onChange={(startFrame) => update({ trigger: { type: 'timeline', startFrame } })}
          />
        ) : cue.trigger.type === 'lifecycle' ? (
          <label>
            Lifecycle state
            <select
              value={cue.trigger.keyframeId}
              onChange={(event) =>
                update({ trigger: { type: 'lifecycle', keyframeId: event.target.value } })
              }
            >
              {composition.keyframes.map((keyframe) => (
                <option key={keyframe.id} value={keyframe.id}>
                  {lifecycleLabel(keyframe, composition.keyframes)}
                </option>
              ))}
            </select>
          </label>
        ) : cue.trigger.type === 'customAction' ? (
          <label>
            Custom action
            <select
              value={cue.trigger.actionId}
              onChange={(event) =>
                update({ trigger: { type: 'customAction', actionId: event.target.value } })
              }
            >
              <option value="">Choose action</option>
              {composition.customActions.map((action) => (
                <option key={action.id} value={action.actionId}>
                  {action.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
      </div>

      <div className="media-cue-editor-section media-cue-editor-grid">
        <strong>Playback</strong>
        <div className="media-cue-duration-summary">
          <span>Source {formatMediaDuration(sourceDurationMs)}</span>
          <span>Trimmed {formatMediaDuration(trimmedDurationMs)}</span>
          <span>Playback {effectiveDurationFrames} f</span>
        </div>
        <div>
          <div className="media-cue-duration-control">
            <FrameDurationControl
              label="Playback duration"
              frames={effectiveDurationFrames}
              frameRate={composition.frameRate}
              minFrames={1}
              onChange={(durationFrames) => update({ durationFrames })}
            />
            <button type="button" onClick={() => update({ durationFrames: null })}>
              Auto
            </button>
          </div>
        </div>
        <label>
          Trim in
          <MillisecondDurationInput
            label="Trim in"
            value={cue.trimStartMs}
            frameRate={composition.frameRate}
            disabled={activeSource?.kind === 'live'}
            onChange={(trimStartMs) => update({ trimStartMs: trimStartMs ?? cue.trimStartMs })}
          />
        </label>
        <label>
          Trim out
          <MillisecondDurationInput
            label="Trim out"
            value={cue.trimEndMs}
            frameRate={composition.frameRate}
            allowNull
            disabled={activeSource?.kind === 'live'}
            onChange={(trimEndMs) => update({ trimEndMs })}
          />
        </label>
        <label>
          Speed
          <input
            type="number"
            min={0.1}
            max={16}
            step={0.1}
            value={cue.speed}
            disabled={activeSource?.kind === 'live'}
            onChange={(event) => update({ speed: Number(event.target.value) })}
          />
        </label>
        <label>
          Volume
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={cue.volume}
            onChange={(event) => update({ volume: Number(event.target.value) })}
          />
        </label>
        <label className="media-cue-checkbox">
          <input
            type="checkbox"
            checked={cue.loop}
            disabled={activeSource?.kind === 'live'}
            onChange={(event) => update({ loop: event.target.checked })}
          />
          Loop
        </label>
        <label className="media-cue-checkbox">
          <input
            type="checkbox"
            checked={cue.muted}
            onChange={(event) => update({ muted: event.target.checked })}
          />
          Mute
        </label>
      </div>

      <div className="media-cue-editor-section">
        <strong>Source transition</strong>
        <label>
          Transition
          <select
            value={cue.transition.type}
            onChange={(event) =>
              update({
                transition: {
                  ...cue.transition,
                  type: event.target.value as MediaCue['transition']['type'],
                },
              })
            }
          >
            <option value="cut">Cut</option>
            <option value="crossfade">Crossfade</option>
          </select>
        </label>
        {cue.transition.type === 'crossfade' ? (
          <FrameDurationControl
            label="Crossfade duration"
            minFrames={1}
            frameRate={composition.frameRate}
            frames={cue.transition.durationFrames}
            onChange={(durationFrames) =>
              update({
                transition: {
                  ...cue.transition,
                  durationFrames,
                },
              })
            }
          />
        ) : null}
        <label>
          Audio transition
          <select
            value={cue.transition.audio}
            onChange={(event) =>
              update({
                transition: {
                  ...cue.transition,
                  audio: event.target.value as MediaCue['transition']['audio'],
                },
              })
            }
          >
            <option value="follow-picture">Follow picture</option>
            <option value="cut">Cut</option>
            <option value="crossfade">Crossfade</option>
          </select>
        </label>
        <label>
          If source fails
          <select
            value={cue.transition.onFailure}
            onChange={(event) =>
              update({
                transition: {
                  ...cue.transition,
                  onFailure: event.target.value as MediaCue['transition']['onFailure'],
                },
              })
            }
          >
            <option value="keep-current">Keep current</option>
            <option value="fallback">Use fallback</option>
            <option value="transparent">Transparency / silence</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        className="media-cue-remove"
        onClick={() => {
          removeMediaCue(cue.id);
        }}
      >
        Remove Media Cue
      </button>
    </div>
  );
}

function formatMediaDuration(value: number | null): string {
  if (value === null) return 'unknown';
  const totalSeconds = Math.max(0, value) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}
