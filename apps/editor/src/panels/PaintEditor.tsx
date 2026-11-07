import { ColorInput } from '../components/ColorInput';
import { WithWarning } from '../components/WarningBadge';
import { LiveInputControls } from '../components/LiveInputControls';
import { defaultLiveMediaInput, liveMediaInputNames } from '../state/liveMediaInputs';
import { PropertyRow } from '../components/PropertyRow';
import { useEffect, useRef, useState } from 'react';
import {
  createMediaPaint,
  createDefaultGradient,
  createShaderPaint,
  isGradientPaint,
  isMediaPaint,
  isShaderPaint,
  type GradientPaint,
  type MediaPaint,
  type Paint,
  type ShaderParameterValue,
} from '@ograf-editor/scene-model';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import { shaderPaintWithPatch } from '../state/shaderResources';
import { SHADER_RESOURCE_MIME, shaderPaintFromResourceDrag } from '../state/shaderDrag';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { mediaPaintReadyToCommit } from './mediaPaintDraft';
import { SourceCropEditor } from './SourceCropEditor';
import { MillisecondDurationInput } from './MillisecondDurationControl';
import { MEDIA_FILE_ACCEPT, mediaFileImportError } from './mediaFileImport';
import './PaintEditor.css';

const MEDIA_PAINT_WARNING =
  'Media is real-time-only. Studio keeps Real-time enabled and Non-real-time disabled while a Media paint is present. Prefer H.264 MP4 or VP8/VP9 WebM, and test the exported package on the target renderer because browser codec support varies.';

interface PaintEditorProps {
  value: Paint | undefined;
  /** Only set for a paint on an actual scene layer, not a component source or shared style. */
  layerId?: string;
  onChange: (value: Paint | undefined) => void;
  /** Media keeps its original pixels until a shader fill is chosen. */
  media?: boolean;
  /** Optional native appearance, such as per-dataset chart colors. */
  originalLabel?: string;
  allowShader?: boolean;
  allowGradient?: boolean;
  allowMedia?: boolean;
  label?: string;
  disabled?: boolean;
  onShaderParameterChange?: (name: string, value: ShaderParameterValue) => void;
  onShaderParameterPreview?: (name: string, value: ShaderParameterValue) => void;
  onEditShader?: () => void;
  shaderAnimationActive?: boolean;
}

const isNonePaint = (value: Paint | undefined) =>
  typeof value === 'string' &&
  (['transparent', 'none'].includes(value.trim().toLowerCase()) ||
    /^#(?:[\da-f]{6}00|[\da-f]{3}0)$/i.test(value.trim()));

export function PaintEditor({
  value,
  layerId,
  onChange,
  media = false,
  originalLabel,
  allowShader = true,
  allowGradient = true,
  allowMedia = true,
  label = 'Fill',
  disabled = false,
  onShaderParameterChange,
  onShaderParameterPreview,
  onEditShader,
  shaderAnimationActive = false,
}: PaintEditorProps) {
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [mediaDraft, setMediaDraft] = useState<MediaPaint | null>(null);
  useEffect(() => setMediaDraft(null), [value]);
  const activeMedia = mediaDraft ?? (isMediaPaint(value) ? value : null);
  const kind = activeMedia
    ? 'media'
    : value === undefined
      ? 'original'
      : typeof value === 'string'
        ? 'solid'
        : value.type;
  const selectedKind =
    activeMedia?.source.kind === 'live' ? 'live' : isNonePaint(value) ? 'none' : kind;
  const composition = useActiveComposition();
  const gradient = isGradientPaint(value) ? value : null;
  const updateGradient = (patch: Partial<GradientPaint>) => {
    if (gradient) onChange({ ...gradient, ...patch });
  };
  const currentState = useProjectStore.getState();
  const tokenLayer = currentState.project.compositions
    .find((item) => item.id === currentState.activeCompositionId)
    ?.layers.find((item) => item.id === layerId);
  const tokenFill =
    label === 'Fill' &&
    tokenLayer &&
    ['rectangle', 'ellipse', 'path', 'pattern', 'text'].includes(tokenLayer.element.type);
  const colorTokenTarget = tokenFill
    ? tokenLayer.element.type === 'text'
      ? 'color'
      : 'fill'
    : null;

  return (
    <div className="paint-editor">
      <div
        className={`paint-shader-drop${dragOver ? ' is-drag-over' : ''}`}
        data-shader-drop-slot={allowShader ? label.toLowerCase() : undefined}
        onDragEnter={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragOver(!disabled);
        }}
        onDragOver={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragOver(!disabled);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          if (disabled) return;
          try {
            const paint = shaderPaintFromResourceDrag(
              useProjectStore.getState().project,
              event.dataTransfer.getData(SHADER_RESOURCE_MIME),
            );
            setMediaDraft(null);
            onChange(paint);
            setDropError(null);
          } catch (cause) {
            setDropError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <PropertyRow
          help={
            label === 'Outline'
              ? 'Choose the text outline paint. Its shader follows editable characters and uses the Stroke Width below. Drop a shader from Resources onto this row to replace it.'
              : activeMedia
                ? 'Media is this object’s fill. Choosing or dropping a shader here replaces Media; drop the shader onto Effects stack to process the video instead.'
                : 'Choose the object fill. None keeps a transparent shape with its outline and effects. Drop a shader from Resources onto this row to apply it.'
          }
          className="inspector-row"
        >
          <span>{label}</span>
          <select
            value={selectedKind}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'live') {
                setMediaDraft(null);
                onChange(
                  createMediaPaint({
                    source: { kind: 'live', tag: defaultLiveMediaInput(composition) },
                  }),
                );
                return;
              }
              if (next === 'media') {
                setMediaDraft(createMediaPaint());
                return;
              }
              setMediaDraft(null);
              onChange(
                next === 'none'
                  ? 'transparent'
                  : next === 'original'
                    ? undefined
                    : next === 'shader'
                      ? createShaderPaint()
                      : next === 'solid'
                        ? '#3b3f4a'
                        : createDefaultGradient(next as GradientPaint['type']),
              );
            }}
          >
            {!media && <option value="none">None</option>}
            {(media || originalLabel) && (
              <option value="original">{originalLabel ?? 'Original pixels'}</option>
            )}
            {!media && (
              <>
                <option value="solid">Solid</option>
                {allowGradient && (
                  <>
                    <option value="linear">Linear gradient</option>
                    <option value="radial">Radial gradient</option>
                    <option value="conic">Conic gradient</option>
                  </>
                )}
              </>
            )}
            {allowShader && <option value="shader">Shader</option>}
            {allowMedia && <option value="media">Media</option>}
            {allowMedia && <option value="live">Live input</option>}
          </select>
        </PropertyRow>
      </div>
      {dropError && (
        <p className="shader-source-error" role="alert">
          {dropError}
        </p>
      )}
      {activeMedia ? (
        <>
          {mediaDraft && !mediaPaintReadyToCommit(mediaDraft) ? (
            <p className="inspector-hint media-paint-pending">
              Choose or import a clip. Media is applied only after its source is valid.
            </p>
          ) : null}
          <MediaPaintControls
            value={activeMedia}
            layerId={layerId}
            disabled={disabled}
            onChange={(next) => {
              if (!isMediaPaint(next)) return;
              if (mediaPaintReadyToCommit(next)) {
                setMediaDraft(null);
                onChange(next);
              } else {
                setMediaDraft(next);
              }
            }}
          />
        </>
      ) : isShaderPaint(value) ? (
        <>
          {shaderAnimationActive && (
            <p className="inspector-hint">
              Keyframed controls follow Timeline. Use Auto-keyframe for playhead edits, or edit
              repeating values in the loop editor.
            </p>
          )}
          <ShaderSourceEditor
            element={value}
            showSourceEditor={false}
            onEditShader={onEditShader}
            labelPrefix={label === 'Fill' ? 'Shader' : `${label} shader`}
            onChange={(patch) => onChange(shaderPaintWithPatch(value, patch))}
            onParameterChange={onShaderParameterChange}
            onParameterPreview={onShaderParameterPreview}
          />
        </>
      ) : typeof value === 'string' && selectedKind !== 'none' ? (
        <PropertyRow
          help={
            'Solid fill color inside the shape. For multiple colors or moving highlights, switch the fill type to a gradient.'
          }
          className="inspector-row"
        >
          <span>Color</span>
          <ColorInput
            label={`${label} color`}
            value={value}
            disabled={disabled}
            onChange={onChange}
            onTokenSelect={
              layerId && colorTokenTarget
                ? (tokenId) =>
                    useProjectStore.getState().bindDesignToken(layerId, tokenId, colorTokenTarget)
                : undefined
            }
          />
        </PropertyRow>
      ) : isGradientPaint(value) ? (
        <>
          {value.type !== 'radial' && (
            <PropertyRow
              help={
                'Gradient direction or rotation in degrees. Changing the angle moves the color transition around the shape without changing its outline.'
              }
              className="inspector-row"
            >
              <span>Angle</span>
              <input
                type="number"
                value={value.angle}
                onChange={(event) => updateGradient({ angle: Number(event.target.value) })}
              />
            </PropertyRow>
          )}
          <div className="paint-stops">
            {value.stops.map((stop, index) => (
              <div className="paint-stop" key={index}>
                <label className="paint-stop-control">
                  <span>Color</span>
                  <ColorInput
                    label={`Stop ${index + 1} color`}
                    value={stop.color}
                    disabled={disabled}
                    onChange={(color) =>
                      updateGradient({
                        stops: value.stops.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, color } : item,
                        ),
                      })
                    }
                    onTokenSelect={
                      layerId && tokenFill
                        ? (tokenId) =>
                            useProjectStore
                              .getState()
                              .bindDesignToken(layerId, tokenId, `fill.stops[${index}].color`)
                        : undefined
                    }
                  />
                </label>
                <label className="paint-stop-control">
                  <span>Position %</span>
                  <input
                    aria-label={`Stop ${index + 1} offset`}
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(stop.offset * 100)}
                    onChange={(event) =>
                      updateGradient({
                        stops: value.stops.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                offset: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="paint-stop-control">
                  <span>Alpha %</span>
                  <input
                    aria-label={`Stop ${index + 1} alpha`}
                    title="100% is opaque; 0% is transparent. Each gradient stop has its own alpha."
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(stop.opacity * 100)}
                    onChange={(event) =>
                      updateGradient({
                        stops: value.stops.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Delete stop ${index + 1}`}
                  title={`Delete stop ${index + 1}`}
                  disabled={value.stops.length <= 2}
                  onClick={() =>
                    updateGradient({
                      stops: value.stops.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="paint-gradient-actions">
              <button
                type="button"
                onClick={() =>
                  updateGradient({
                    stops: [...value.stops, { offset: 0.5, color: '#ffffff', opacity: 1 }].sort(
                      (a, b) => a.offset - b.offset,
                    ),
                  })
                }
              >
                + Stop
              </button>
              <button
                type="button"
                title="Fade the first stop's color and alpha to a fully transparent endpoint."
                onClick={() => {
                  const first = value.stops[0]!;
                  updateGradient({
                    stops: [
                      { ...first, offset: 0 },
                      { offset: 1, color: first.color, opacity: 0 },
                    ],
                  });
                }}
              >
                Fade to transparent
              </button>
            </div>
            <p className="paint-alpha-hint">Alpha: 100% opaque · 0% transparent</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MediaPaintControls({
  value,
  layerId,
  disabled,
  onChange,
}: {
  value: MediaPaint;
  layerId?: string;
  disabled: boolean;
  onChange: (value: Paint) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaImportError, setMediaImportError] = useState('');
  const [customClipSource, setCustomClipSource] = useState(
    value.source.kind === 'clip' ? value.source.src : '',
  );
  useEffect(() => {
    if (value.source.kind === 'clip' && !value.source.src.startsWith('asset:')) {
      setCustomClipSource(value.source.src);
    }
  }, [value.source]);
  const composition = useActiveComposition();
  const importAsset = useProjectStore((state) => state.importAsset);
  const mediaAssets = composition.assets.filter((asset) => asset.kind === 'media');
  const imageAssets = composition.assets.filter((asset) => asset.kind === 'image');
  const patch = (next: Partial<MediaPaint>) => onChange(createMediaPaint({ ...value, ...next }));
  const cropReference = value.source.kind === 'clip' ? value.source.src : value.source.fallback;
  const cropPreview = cropReference?.startsWith('asset:')
    ? composition.assets.find((asset) => asset.id === cropReference.slice('asset:'.length))?.dataUri
    : cropReference;

  return (
    <div className="media-paint-controls">
      <PropertyRow
        help="Choose a video clip or a live input for this object. Media paint is always muted."
        className="inspector-row"
      >
        <span>Source</span>
        <WithWarning message={MEDIA_PAINT_WARNING}>
          <select
            value={value.source.kind}
            disabled={disabled}
            onChange={(event) =>
              patch({
                source:
                  event.target.value === 'live'
                    ? { kind: 'live', tag: defaultLiveMediaInput(composition) }
                    : { kind: 'clip', src: '' },
              })
            }
          >
            <option value="clip">Clip</option>
            <option value="live">Live input</option>
          </select>
        </WithWarning>
      </PropertyRow>
      {value.source.kind === 'clip' ? (
        <>
          <PropertyRow help="Packaged clip or custom video URL." className="inspector-row">
            <span>Clip</span>
            <select
              value={value.source.src.startsWith('asset:') ? value.source.src : '__custom'}
              disabled={disabled}
              onChange={(event) =>
                patch({
                  source: {
                    kind: 'clip',
                    src: event.target.value === '__custom' ? '' : event.target.value,
                  },
                })
              }
            >
              <option value="__custom">URL / reference</option>
              {mediaAssets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </select>
          </PropertyRow>
          {!value.source.src.startsWith('asset:') ? (
            <PropertyRow help="Absolute video URL or asset reference." className="inspector-row">
              <span>Source</span>
              <span className="media-paint-source-editor">
                <input
                  type="text"
                  value={customClipSource}
                  disabled={disabled}
                  placeholder="https://example.com/clip.mp4"
                  onChange={(event) => setCustomClipSource(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && customClipSource.trim()) {
                      patch({ source: { kind: 'clip', src: customClipSource } });
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={disabled || !customClipSource.trim()}
                  onClick={() => patch({ source: { kind: 'clip', src: customClipSource.trim() } })}
                >
                  Apply
                </button>
              </span>
            </PropertyRow>
          ) : null}
          <div className="inspector-button-row media-paint-import">
            <button type="button" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
              Import clip…
            </button>
            <input
              ref={fileInputRef}
              className="inspector-file-input"
              type="file"
              accept={MEDIA_FILE_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const problem = mediaFileImportError(file);
                if (problem) {
                  setMediaImportError(problem);
                  return;
                }
                setMediaImportError('');
                void importAsset(file)
                  .then((assetId) => patch({ source: { kind: 'clip', src: `asset:${assetId}` } }))
                  .catch((cause: unknown) =>
                    setMediaImportError(
                      cause instanceof Error ? cause.message : 'The clip could not be imported.',
                    ),
                  );
              }}
            />
          </div>
          {mediaImportError ? (
            <p className="inspector-error" role="alert">
              {mediaImportError}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <LiveInputControls
            inputNames={liveMediaInputNames(composition)}
            initialName={defaultLiveMediaInput(composition)}
            currentName={value.source.tag}
            destination={
              composition.layers.find((layer) => layer.id === layerId)?.name ?? 'this fill'
            }
            disabled={disabled}
            onUse={(tag) => {
              patch({ source: { ...value.source, kind: 'live', tag } });
              return true;
            }}
          />
          <PropertyRow
            help="Portable image shown when live media is unavailable."
            className="inspector-row"
          >
            <span>Fallback</span>
            <select
              value={value.source.fallback ?? ''}
              disabled={disabled}
              onChange={(event) =>
                patch({
                  source: {
                    kind: 'live',
                    tag: value.source.kind === 'live' ? value.source.tag : '',
                    ...(event.target.value ? { fallback: event.target.value } : {}),
                  },
                })
              }
            >
              <option value="">Transparent</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </select>
          </PropertyRow>
        </>
      )}
      <PropertyRow
        help="How the moving image fits inside the painted object."
        className="inspector-row"
      >
        <span>Fit</span>
        <select
          value={value.fit}
          disabled={disabled}
          onChange={(event) => patch({ fit: event.target.value as MediaPaint['fit'] })}
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Stretch</option>
        </select>
      </PropertyRow>
      <SourceCropEditor
        layerId={layerId}
        value={value.crop}
        src={cropPreview}
        video={value.source.kind === 'clip'}
        disabled={disabled}
        onChange={(crop) => patch({ crop })}
      />
      <div className="inspector-grid">
        <PropertyRow help="Horizontal focal position." className="inspector-row">
          <span>Position X</span>
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(value.positionX * 100)}
            disabled={disabled}
            onChange={(event) => patch({ positionX: Number(event.target.value) / 100 })}
          />
        </PropertyRow>
        <PropertyRow help="Vertical focal position." className="inspector-row">
          <span>Position Y</span>
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(value.positionY * 100)}
            disabled={disabled}
            onChange={(event) => patch({ positionY: Number(event.target.value) / 100 })}
          />
        </PropertyRow>
      </div>
      {value.source.kind === 'clip' ? (
        <>
          <PropertyRow
            help="Loop the clip continuously while the graphic is active."
            className="inspector-row inspector-checkbox-row"
          >
            <span>Loop</span>
            <input
              type="checkbox"
              checked={value.loop}
              disabled={disabled}
              onChange={(event) => patch({ loop: event.target.checked })}
            />
          </PropertyRow>
          <div className="inspector-grid">
            <PropertyRow help="Muted playback speed multiplier." className="inspector-row">
              <span>Speed</span>
              <input
                type="number"
                min={0.1}
                max={16}
                step={0.1}
                value={value.speed}
                disabled={disabled}
                onChange={(event) => patch({ speed: Number(event.target.value) })}
              />
            </PropertyRow>
            <PropertyRow
              help="Initial offset into the clip in milliseconds."
              className="inspector-row"
            >
              <span>Offset</span>
              <MillisecondDurationInput
                label="Media offset"
                value={value.offsetMs}
                frameRate={composition.frameRate}
                disabled={disabled}
                onChange={(offsetMs) => patch({ offsetMs: offsetMs ?? value.offsetMs })}
              />
            </PropertyRow>
            <PropertyRow
              help="Optional end trim in milliseconds. Leave blank to use the clip duration."
              className="inspector-row"
            >
              <span>Trim end</span>
              <MillisecondDurationInput
                label="Media trim end"
                value={value.trimEndMs}
                frameRate={composition.frameRate}
                allowNull
                disabled={disabled}
                onChange={(trimEndMs) => patch({ trimEndMs })}
              />
            </PropertyRow>
            <PropertyRow
              help="Composition time in milliseconds when clip playback becomes active."
              className="inspector-row"
            >
              <span>Timeline start</span>
              <MillisecondDurationInput
                label="Media timeline start"
                value={value.timelineStartMs}
                frameRate={composition.frameRate}
                disabled={disabled}
                onChange={(timelineStartMs) =>
                  patch({ timelineStartMs: timelineStartMs ?? value.timelineStartMs })
                }
              />
            </PropertyRow>
          </div>
        </>
      ) : null}
      <p className="inspector-hint">Media paint is visual-only and always muted.</p>
    </div>
  );
}
