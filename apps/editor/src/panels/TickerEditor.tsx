import { isGradientPaint as isAnimatorGradient } from '@ograf-editor/scene-model';
import { supportsTextAnimatorColor } from '@ograf-editor/scene-model';
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  createId,
  createLayerOfKind,
  createShaderPaint,
  createRectangleElement,
  isShaderPaint,
  normalizeTextAnimation,
  parseLottieJson,
  segmentTextAnimationUnits,
  textAnimationSplit,
  type Composition,
  type Paint,
  type TickerContentElement,
  type TickerElement,
  type TickerItem,
} from '@ograf-editor/scene-model';
import { PropertyRow } from '../components/PropertyRow';
import { useProjectStore } from '../state/projectStore';
import { IMAGE_ACCEPT } from '../state/imageImport';
import { PaintEditor } from './PaintEditor';
import { TextAnimationEditor } from './TextAnimationEditor';
import { useEditorWindow } from '../layout/EditorWindow';
import { openShaderResourceEditor } from '../state/shaderEditorRequest';
import { FONT_OPTIONS } from './fontOptions';
import { useEditorPreviewSourceStore } from '../state/editorPreviewSourceStore';
import { useTickerUpdateStatuses } from './useTickerUpdateStatuses';
import { TickerPendingUpdates } from './TickerPendingUpdates';
import { MillisecondDurationInput } from './MillisecondDurationControl';
import './TickerEditor.css';

type ItemKind = TickerContentElement['type'];
const KINDS: Array<{ type: ItemKind; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'image', label: 'Image / logo' },
  { type: 'lottie', label: 'Lottie animation' },
  { type: 'image-sequence', label: 'Image sequence' },
  { type: 'rectangle', label: 'Rectangle' },
  { type: 'ellipse', label: 'Ellipse' },
  { type: 'shader', label: 'Shader' },
];

function createTickerEditorItem(type: ItemKind): TickerItem {
  const element = type === 'shader' ? createShaderPaint() : createLayerOfKind(type).element;
  if (element.type === 'text') {
    element.content = 'Your headline';
    element.fontSize = 40;
    element.fill = '#ffffff';
  }
  return {
    id: createId('ticker-item'),
    name: KINDS.find((kind) => kind.type === type)?.label ?? type,
    width: type === 'text' ? 640 : 96,
    element: element as TickerContentElement,
  };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PropertyRow className="inspector-row" help={`Edit the ticker ${label.toLowerCase()}.`}>
      <span>{label}</span>
      {children}
    </PropertyRow>
  );
}

export function TickerEditor({
  layerId,
  value,
  composition,
  disabled = false,
  onChange,
}: {
  layerId: string;
  value: TickerElement;
  composition: Composition;
  disabled?: boolean;
  onChange: (patch: Partial<TickerElement>) => void;
}) {
  const [selectedId, setSelectedId] = useState(value.items[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { window: ownerWindow } = useEditorWindow();
  const uploadRef = useRef<HTMLInputElement>(null);
  const outputRoot = useEditorPreviewSourceStore((state) => state.source?.root ?? null);
  const pendingUpdates = useTickerUpdateStatuses(outputRoot).filter(
    (status) => status.layerId === layerId,
  );
  const item = value.items.find((candidate) => candidate.id === selectedId) ?? value.items[0];
  const element = item?.element;
  const patchItem = (patch: Partial<TickerItem>) => {
    if (!item) return;
    onChange({
      items: value.items.map((candidate) =>
        candidate.id === item.id ? { ...candidate, ...patch } : candidate,
      ),
    });
  };
  const patchElement = (patch: Record<string, unknown>) => {
    if (element) patchItem({ element: { ...element, ...patch } as TickerContentElement });
  };
  const itemPaint: Paint | undefined = element?.type === 'shader' ? element : element?.fill;
  const moveItem = (direction: -1 | 1) => {
    if (!item) return;
    const items = [...value.items];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    onChange({ items });
  };
  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!item || !element || !files.length) return;
    setBusy(true);
    setError('');
    try {
      if (element.type === 'lottie') {
        patchElement({ animationData: parseLottieJson(await files[0]!.text()) });
      } else {
        const sources: string[] = [];
        for (const file of files) {
          const id = /\.svg$/i.test(file.name)
            ? (await useProjectStore.getState().importSvgBundle([file])).assetId
            : await useProjectStore.getState().importAsset(file);
          sources.push(`asset:${id}`);
        }
        patchElement(element.type === 'image-sequence' ? { frames: sources } : { src: sources[0] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="ticker-editor" disabled={disabled || busy}>
      <Row label="Apply updates">
        <select
          aria-label="Ticker apply updates"
          title="Next appearance keeps visible items unchanged until they leave. New items enter in order; removed items finish their visible pass."
          value={value.updatePolicy ?? 'next-appearance'}
          onChange={(event) =>
            onChange({ updatePolicy: event.target.value as TickerElement['updatePolicy'] })
          }
        >
          <option value="next-appearance">Next appearance</option>
          <option value="immediate">Immediately</option>
        </select>
      </Row>
      <TickerPendingUpdates statuses={pendingUpdates} />
      <Row label="Speed px/s">
        <input
          aria-label="Ticker speed"
          type="number"
          min={0}
          max={2000}
          step={0.1}
          value={value.speedPixelsPerSecond}
          onChange={(event) => onChange({ speedPixelsPerSecond: Number(event.target.value) })}
        />
      </Row>
      <Row label="Scroll">
        <select
          aria-label="Ticker scrolling direction"
          value={value.direction}
          onChange={(event) =>
            onChange({ direction: event.target.value as TickerElement['direction'] })
          }
        >
          <option value="left">Right to left ←</option>
          <option value="right">Left to right →</option>
        </select>
      </Row>
      <Row label="Text direction">
        <select
          aria-label="Ticker text direction"
          value={value.textDirection}
          onChange={(event) =>
            onChange({ textDirection: event.target.value as TickerElement['textDirection'] })
          }
        >
          <option value="auto">Automatic</option>
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left (Arabic / Hebrew)</option>
        </select>
      </Row>
      <Row label="Gap px">
        <input
          aria-label="Ticker item gap"
          type="number"
          min={0}
          max={16384}
          value={value.gap}
          onChange={(event) => onChange({ gap: Number(event.target.value) })}
        />
      </Row>
      <Row label="Entry fade px">
        <input
          aria-label="Ticker entry fade"
          type="number"
          min={0}
          max={16384}
          value={value.entryFade}
          onChange={(event) => onChange({ entryFade: Number(event.target.value) })}
        />
      </Row>
      <Row label="Exit fade px">
        <input
          aria-label="Ticker exit fade"
          type="number"
          min={0}
          max={16384}
          value={value.exitFade}
          onChange={(event) => onChange({ exitFade: Number(event.target.value) })}
        />
      </Row>
      <Row label="Fade softness">
        <input
          aria-label="Ticker fade softness"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value.fadeSoftness}
          onChange={(event) => onChange({ fadeSoftness: Number(event.target.value) })}
        />
      </Row>
      <PaintEditor
        value={value.background ?? 'transparent'}
        label="Background"
        allowMedia={false}
        onEditShader={() =>
          openShaderResourceEditor(
            { compositionId: composition.id, layerId, slot: 'fill', tickerBackground: true },
            ownerWindow,
          )
        }
        onChange={(background) => onChange({ background })}
      />
      <p className="inspector-hint">
        Speed uses pixels per second at every output frame rate. Edge fades reveal the graphics
        underneath; the background is independent.
      </p>
      <div className="ticker-item-heading">
        <strong>Items · {value.items.length}</strong>
        <select
          aria-label="Add ticker item"
          value=""
          disabled={value.items.length >= 128}
          onChange={(event) => {
            const next = createTickerEditorItem(event.target.value as ItemKind);
            onChange({ items: [...value.items, next] });
            setSelectedId(next.id);
          }}
        >
          <option value="">+ Add item…</option>
          {KINDS.map((kind) => (
            <option key={kind.type} value={kind.type}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>
      {value.items.length ? (
        <Row label="Selected item">
          <select
            aria-label="Ticker selected item"
            value={item?.id ?? ''}
            onChange={(event) => {
              setSelectedId(event.target.value);
            }}
          >
            {value.items.map((candidate, index) => (
              <option key={candidate.id} value={candidate.id}>
                {index + 1}. {candidate.name ?? candidate.element.type}
              </option>
            ))}
          </select>
        </Row>
      ) : (
        <p className="inspector-hint">Add text, a logo or an animation to start the ticker.</p>
      )}
      {item && element ? (
        <div className="ticker-item-editor" key={item.id}>
          <div className="ticker-item-actions">
            <button
              type="button"
              aria-label="Move ticker item earlier"
              disabled={value.items[0]?.id === item.id}
              onClick={() => moveItem(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move ticker item later"
              disabled={value.items.at(-1)?.id === item.id}
              onClick={() => moveItem(1)}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => {
                const copy = {
                  ...structuredClone(item),
                  id: createId('ticker-item'),
                  name: `${item.name ?? element.type} copy`,
                };
                onChange({ items: [...value.items, copy] });
                setSelectedId(copy.id);
              }}
              disabled={value.items.length >= 128}
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({ items: value.items.filter((candidate) => candidate.id !== item.id) })
              }
            >
              Remove
            </button>
          </div>
          <Row label="Name">
            <input
              aria-label="Ticker item name"
              value={item.name ?? ''}
              onChange={(event) => patchItem({ name: event.target.value })}
            />
          </Row>
          <Row label="Width px">
            <input
              aria-label="Ticker item width"
              type="number"
              min={1}
              max={16384}
              value={item.width}
              onChange={(event) => patchItem({ width: Math.max(1, Number(event.target.value)) })}
            />
          </Row>
          <Row label="Height px">
            <input
              aria-label="Ticker item height"
              type="number"
              min={1}
              max={16384}
              placeholder="Viewport height"
              value={item.height ?? ''}
              onChange={(event) =>
                patchItem({
                  height: event.target.value ? Math.max(1, Number(event.target.value)) : undefined,
                })
              }
            />
          </Row>
          {element.type === 'text' ? (
            <>
              <Row label="Text">
                <textarea
                  aria-label="Ticker item text"
                  dir={value.textDirection}
                  value={element.content}
                  onChange={(event) => patchElement({ content: event.target.value, runs: [] })}
                />
              </Row>
              <Row label="Font">
                <select
                  aria-label="Ticker item font"
                  value={element.fontFamily}
                  onChange={(event) => patchElement({ fontFamily: event.target.value })}
                >
                  {[
                    ...new Set([
                      element.fontFamily,
                      ...FONT_OPTIONS.map((font) => font.value),
                      ...composition.assets
                        .filter((asset) => asset.kind === 'font' && asset.fontFamily)
                        .map((asset) => asset.fontFamily!),
                    ]),
                  ].map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Font size">
                <input
                  aria-label="Ticker item font size"
                  type="number"
                  min={1}
                  max={1000}
                  value={element.fontSize}
                  onChange={(event) =>
                    patchElement({ fontSize: Math.max(1, Number(event.target.value)) })
                  }
                />
              </Row>
              <Row label="Weight">
                <select
                  aria-label="Ticker item font weight"
                  value={element.fontWeight}
                  onChange={(event) => patchElement({ fontWeight: Number(event.target.value) })}
                >
                  {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </select>
              </Row>
              <TextAnimationEditor
                animation={element.textAnimation}
                unitCount={
                  segmentTextAnimationUnits(
                    element.content,
                    textAnimationSplit(element.textAnimation),
                  ).length
                }
                frameRate={composition.frameRate}
                colorAllowed={supportsTextAnimatorColor(element)}
                gradientColor={isAnimatorGradient(element.fill)}
                customActions={composition.customActions ?? []}
                onChange={(patch) =>
                  patchElement({
                    textAnimation: normalizeTextAnimation({ ...element.textAnimation, ...patch }),
                  })
                }
              />
            </>
          ) : null}
          {['image', 'image-sequence', 'lottie'].includes(element.type) ? (
            <>
              <button type="button" onClick={() => uploadRef.current?.click()}>
                {busy
                  ? 'Opening…'
                  : element.type === 'lottie'
                    ? 'Choose Lottie JSON…'
                    : element.type === 'image-sequence'
                      ? 'Choose sequence images…'
                      : 'Choose image…'}
              </button>
              <input
                ref={uploadRef}
                type="file"
                hidden
                accept={element.type === 'lottie' ? '.json,application/json' : IMAGE_ACCEPT}
                multiple={element.type === 'image-sequence'}
                onChange={(event) => void importFiles(event)}
              />
              {element.type !== 'lottie' ? (
                <Row label="Image resource">
                  <select
                    aria-label="Ticker image resource"
                    value=""
                    onChange={(event) => {
                      if (event.target.value)
                        patchElement(
                          element.type === 'image-sequence'
                            ? { frames: [...element.frames, `asset:${event.target.value}`] }
                            : { src: `asset:${event.target.value}` },
                        );
                    }}
                  >
                    <option value="">Choose from Resources…</option>
                    {composition.assets
                      .filter((asset) => asset.kind === 'image')
                      .map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                  </select>
                </Row>
              ) : null}
              {element.type === 'image' ? (
                <>
                  <Row label="Source">
                    <input
                      aria-label="Ticker image source"
                      value={element.src ?? ''}
                      onChange={(event) => patchElement({ src: event.target.value || null })}
                    />
                  </Row>
                  <Row label="Image fit">
                    <select
                      aria-label="Ticker image fit"
                      value={element.fit ?? 'contain'}
                      onChange={(event) => patchElement({ fit: event.target.value })}
                    >
                      <option value="contain">Contain</option>
                      <option value="cover">Cover</option>
                      <option value="fill">Stretch</option>
                    </select>
                  </Row>
                </>
              ) : null}
              {element.type === 'image-sequence' ? (
                <>
                  <p className="inspector-hint">
                    {element.frames.length} frames · Files play in selection order.
                  </p>
                  <Row label="Sequence FPS">
                    <input
                      aria-label="Ticker sequence FPS"
                      type="number"
                      min={0.01}
                      step={0.1}
                      value={element.fps}
                      onChange={(event) =>
                        patchElement({ fps: Math.max(0.01, Number(event.target.value)) })
                      }
                    />
                  </Row>
                  <Row label="Loop">
                    <input
                      aria-label="Loop ticker sequence"
                      type="checkbox"
                      checked={element.loop}
                      onChange={(event) => patchElement({ loop: event.target.checked })}
                    />
                  </Row>
                </>
              ) : null}
              {element.type === 'lottie' ? (
                <Row label="Animation speed">
                  <input
                    aria-label="Ticker Lottie speed"
                    type="number"
                    min={0}
                    step={0.1}
                    value={element.speed}
                    onChange={(event) =>
                      patchElement({ speed: Math.max(0, Number(event.target.value)) })
                    }
                  />
                </Row>
              ) : null}
            </>
          ) : null}
          <PaintEditor
            value={itemPaint}
            media={['image', 'image-sequence', 'lottie'].includes(element.type)}
            allowMedia={false}
            onEditShader={() =>
              openShaderResourceEditor(
                { compositionId: composition.id, layerId, slot: 'fill', itemId: item.id },
                ownerWindow,
              )
            }
            onChange={(fill) =>
              element.type === 'shader'
                ? patchItem({
                    element: isShaderPaint(fill) ? fill : createRectangleElement({ fill }),
                  })
                : patchElement({ fill })
            }
          />
          <Row label="Take animation">
            <select
              aria-label="Ticker item animation"
              value={item.animation?.type ?? 'none'}
              onChange={(event) =>
                patchItem({
                  animation: {
                    type: event.target.value as NonNullable<TickerItem['animation']>['type'],
                    durationMs: item.animation?.durationMs ?? 600,
                    delayMs: item.animation?.delayMs ?? 0,
                  },
                })
              }
            >
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="rise">Rise</option>
              <option value="scale">Scale</option>
            </select>
          </Row>
          <p className="inspector-hint">
            Take animation follows the ticker's shared clock; it does not restart each time an item
            passes the edge.
          </p>
          {item.animation && item.animation.type !== 'none' ? (
            <>
              <Row label="Duration">
                <MillisecondDurationInput
                  label="Ticker item animation duration"
                  frameRate={composition.frameRate}
                  minMs={0}
                  maxMs={60000}
                  value={item.animation.durationMs}
                  onChange={(durationMs) =>
                    patchItem({
                      animation: {
                        ...item.animation!,
                        durationMs: durationMs ?? item.animation!.durationMs,
                      },
                    })
                  }
                />
              </Row>
              <Row label="Delay">
                <MillisecondDurationInput
                  label="Ticker item animation delay"
                  frameRate={composition.frameRate}
                  minMs={0}
                  maxMs={60000}
                  value={item.animation.delayMs}
                  onChange={(delayMs) =>
                    patchItem({
                      animation: {
                        ...item.animation!,
                        delayMs: delayMs ?? item.animation!.delayMs,
                      },
                    })
                  }
                />
              </Row>
            </>
          ) : null}
          <details>
            <summary>Copy artwork from an object</summary>
            <select
              aria-label="Copy ticker item artwork"
              value=""
              onChange={(event) => {
                const source = composition.layers.find((layer) => layer.id === event.target.value);
                if (
                  source &&
                  source.element.type !== 'ticker' &&
                  source.element.type !== 'audio' &&
                  source.element.type !== 'chart'
                )
                  patchItem({
                    element: structuredClone(source.element),
                    effects: structuredClone(source.effects),
                  });
              }}
            >
              <option value="">Choose object…</option>
              {composition.layers
                .filter((layer) => !['ticker', 'audio', 'chart'].includes(layer.element.type))
                .map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
            </select>
            <p className="inspector-hint">
              Copies editable artwork and its paint. The ticker keeps its own placement and timing.
            </p>
          </details>
        </div>
      ) : null}
      {error ? (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
