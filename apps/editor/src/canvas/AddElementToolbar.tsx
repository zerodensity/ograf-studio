import { canvasFrame, useCanvasViewStore } from '../state/canvasViewStore';
import { ColorInput } from '../components/ColorInput';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { ImagePicker } from '../components/ImagePicker';
import { defaultTransformFor, parseLottieJson } from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore, type NewLayerKind } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { isPersistentGroupSelection } from './groupSelection';
import { arrangeSelectedLayers, type LayerArrangeAction } from '../state/layerZOrder';
import './AddElementToolbar.css';
import { usePatternDialogStore } from '../state/patternDialogStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useCanvasBackdropStore, type CanvasBackdropMode } from '../state/canvasBackdropStore';
import { onAirFrame } from '../state/onAirFrame';
import { canvasInsertion } from './canvasInsertion';
import { repeatPreview } from './repeatPreview';
import { usePenToolStore } from '../state/penToolStore';
import { cameraSettingsDialogOpen, isCanvasBackdropInteraction } from './canvasBackdropInteraction';
import { PreviewBackgroundControls } from '../panels/PreviewBackgroundControls';
import { usePresentationBackgroundStore } from '../state/presentationBackgroundStore';
import { useProgramMonitorStore } from '../state/programMonitorStore';
import { stopWebcamPresentation } from '../state/webcamPreview';
import {
  choosePresentationBackground,
  presentationBackgroundChoice,
  PRESENTATION_BACKGROUND_OPTIONS,
} from '../state/presentationBackgroundSelection';

const KINDS: { kind: NewLayerKind; label: string }[] = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'text', label: 'Text' },
  { kind: 'clock', label: 'Clock / Timer' },
  { kind: 'ticker', label: 'Ticker' },
  { kind: 'image', label: 'Image' },
  { kind: 'path', label: 'Path' },
  { kind: 'pattern', label: 'Procedural Pattern' },
  { kind: 'image-sequence', label: 'Image Sequence' },
];

function ElementIcon({ kind }: { kind: NewLayerKind }) {
  return (
    <svg className="element-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'pattern' && (
        <>
          <circle cx="7" cy="7" r="3" />
          <circle cx="17" cy="7" r="3" />
          <circle cx="7" cy="17" r="3" />
          <circle cx="17" cy="17" r="3" />
        </>
      )}
      {kind === 'rectangle' && <rect x="3.5" y="5" width="17" height="14" rx="1.4" />}
      {kind === 'ellipse' && <ellipse cx="12" cy="12" rx="8.5" ry="6.8" />}
      {kind === 'text' && (
        <>
          <path d="M4 5.5h16M12 5.5v13M8.2 18.5h7.6" />
          <path d="M5.5 5.5v3M18.5 5.5v3" />
        </>
      )}
      {kind === 'clock' && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 6.5V12l4 2.5M12 3.5v1M12 19.5v1M3.5 12h1M19.5 12h1" />
        </>
      )}
      {kind === 'ticker' && (
        <>
          <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
          <path d="M6 10h10M6 14h7M17 12h4m-2-2 2 2-2 2" />
        </>
      )}
      {kind === 'image' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
          <circle cx="8.5" cy="9" r="1.6" />
          <path d="m5.5 17 4.2-4.3 2.8 2.7 2.5-2.4 3.5 4" />
        </>
      )}
      {kind === 'path' && (
        <>
          <path d="M5 17C7 7 15 7 19 16" />
          <path d="M5 17 9 8M19 16l-4-8M9 8h6" className="element-tool-guide" />
          <circle cx="5" cy="17" r="1.7" />
          <circle cx="9" cy="8" r="1.35" />
          <circle cx="15" cy="8" r="1.35" />
          <circle cx="19" cy="16" r="1.7" />
        </>
      )}
      {kind === 'image-sequence' && (
        <>
          <rect x="5.5" y="3.5" width="14.5" height="12" rx="1.4" />
          <path d="M3.5 7.5v11.2c0 1 .8 1.8 1.8 1.8h13.2" />
          <circle cx="10" cy="7.8" r="1.2" />
          <path d="m7.5 13 3-2.8 2.1 2 2-1.8 2.8 2.6" />
        </>
      )}
      {kind === 'lottie' && (
        <>
          <path d="M5.2 14.8c1.3 3.4 5.3 5.1 8.8 3.8 3.6-1.3 5.4-5.3 4-8.8-1.3-3.4-5.2-5.2-8.7-4" />
          <path d="M5.2 14.8 4 10.7M5.2 14.8l4-1.4" />
          <path d="m11.2 9 4.3 3-4.3 3z" />
        </>
      )}
    </svg>
  );
}

const ARRANGE_ACTIONS: Array<{ action: LayerArrangeAction; label: string }> = [
  { action: 'send-to-back', label: 'Send to Back' },
  { action: 'send-backward', label: 'Send Backward' },
  { action: 'bring-forward', label: 'Bring Forward' },
  { action: 'bring-to-front', label: 'Bring to Front' },
];

function ArrangeIcon({ action }: { action: LayerArrangeAction }) {
  const movesForward = action === 'bring-forward' || action === 'bring-to-front';
  const movesToEnd = action === 'send-to-back' || action === 'bring-to-front';
  return (
    <svg className="arrange-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="8.5" width="9.5" height="9.5" rx="1" />
      <rect x="7.5" y="4.5" width="9.5" height="9.5" rx="1" />
      <path
        d={movesForward ? 'M20 15V5M17.5 7.5 20 5l2.5 2.5' : 'M20 5v10m-2.5-2.5L20 15l2.5-2.5'}
      />
      {movesToEnd && <path d={movesForward ? 'M17.5 3h5' : 'M17.5 17h5'} />}
    </svg>
  );
}

export function AddElementToolbar() {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePlacement, setImagePlacement] = useState<{
    position: { x: number; y: number };
    groupId?: string;
    parentId?: string;
  }>();
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatCount, setRepeatCount] = useState(3);
  const [repeatDirection, setRepeatDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [repeatGap, setRepeatGap] = useState(24);
  const [repeatError, setRepeatError] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const backgroundControlRef = useRef<HTMLDivElement>(null);
  const [backgroundSettingsOpen, setBackgroundSettingsOpen] = useState(false);
  const backdrop = useCanvasBackdropStore();
  const presentation = usePresentationBackgroundStore();
  const program = useProgramMonitorStore();
  const presentationChoice = presentationBackgroundChoice(
    presentation.settings.mode,
    program.background,
  );
  const usingPresentation = backdrop.showPresentation && presentationChoice !== 'none';
  const visiblePresentationOptions = PRESENTATION_BACKGROUND_OPTIONS.filter((option) =>
    ['big-buck-bunny', 'still-image', 'webcam', 'program:video'].includes(option.value),
  );
  const hasOtherPreview =
    presentationChoice !== 'none' &&
    !visiblePresentationOptions.some((option) => option.value === presentationChoice);
  const followingOtherPreview = usingPresentation && hasOtherPreview;
  const configurablePresentation = [
    'webcam',
    'still-image',
    'program:video',
    'big-buck-bunny',
  ].includes(presentationChoice);
  useEffect(() => {
    if (!backgroundSettingsOpen) return;
    const document = backgroundControlRef.current?.ownerDocument;
    if (!document) return;
    const outside = (event: PointerEvent) => {
      if (!isCanvasBackdropInteraction(backgroundControlRef.current, event.target))
        setBackgroundSettingsOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (cameraSettingsDialogOpen(document)) return;
        event.stopPropagation();
        setBackgroundSettingsOpen(false);
        backgroundControlRef.current
          ?.querySelector<HTMLButtonElement>('.canvas-backdrop-settings-button')
          ?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [backgroundSettingsOpen]);
  const composition = useActiveComposition();
  const addLayer = useProjectStore((s) => s.addLayer);
  const addLowerThird = useProjectStore((s) => s.addLowerThird);
  const addBug = useProjectStore((s) => s.addBug);
  const addTicker = useProjectStore((s) => s.addTicker);
  const addScoreboard = useProjectStore((s) => s.addScoreboard);
  const addClock = useProjectStore((s) => s.addClock);
  const addCountdown = useProjectStore((s) => s.addCountdown);
  const addRepeater = useProjectStore((s) => s.addRepeater);
  const alignLayers = useProjectStore((s) => s.alignLayers);
  const distributeLayers = useProjectStore((s) => s.distributeLayers);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const groupLayers = useProjectStore((s) => s.groupLayers);
  const ungroupLayers = useProjectStore((s) => s.ungroupLayers);
  const select = useSelectionStore((s) => s.select);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const playheadFrame = useTimelineStore((s) => s.currentFrame);
  const viewMode = useCanvasViewStore((s) => s.mode);
  const currentFrame = canvasFrame(composition, playheadFrame, viewMode);
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const renameLayer = useProjectStore((s) => s.renameLayer);
  const lottieInputRef = useRef<HTMLInputElement>(null);
  const selectionIsPersistentGroup = isPersistentGroupSelection(composition, selectedLayerIds);
  const orderedLayerIds = composition.layers.map((layer) => layer.id);

  const arrangementFor = (action: LayerArrangeAction) =>
    arrangeSelectedLayers(orderedLayerIds, selectedLayerIds, action);

  const canArrange = (action: LayerArrangeAction) =>
    arrangementFor(action).some((layerId, index) => layerId !== orderedLayerIds[index]);

  const importLottie = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const animationData = parseLottieJson(await file.text());
      const root = toolbarRef.current?.closest('.canvas-stage') ?? null;
      const layerId = addLayer(
        'lottie',
        canvasInsertion(root, composition, 'lottie', selectedLayerIds, currentFrame),
      );
      updateLayerElement(layerId, { animationData });
      renameLayer(layerId, file.name.replace(/\.json$/i, '') || 'Lottie');
      select(layerId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  const addRecipe = (event: ChangeEvent<HTMLSelectElement>) => {
    const recipe = event.target.value;
    event.target.value = '';
    const labels: Record<string, string> = {
      'lower-third': 'Lower Third',
      bug: 'Bug / DOG',
      ticker: 'Ticker',
      scoreboard: 'Scoreboard',
      clock: 'Clock / Timer',
      countdown: 'Countdown',
    };
    const result = runDiscreteHistoryStep(
      () =>
        recipe === 'lower-third'
          ? addLowerThird()
          : recipe === 'bug'
            ? addBug()
            : recipe === 'ticker'
              ? addTicker()
              : recipe === 'scoreboard'
                ? addScoreboard()
                : recipe === 'clock'
                  ? addClock()
                  : recipe === 'countdown'
                    ? addCountdown()
                    : null,
      `Add ${labels[recipe] ?? 'recipe'}`,
    );
    if (result) {
      selectMany([...new Set(Object.values(result.layers))]);
      const state = useProjectStore.getState();
      const active = state.project.compositions.find(
        (item) => item.id === state.activeCompositionId,
      );
      if (active) {
        const frame = onAirFrame(active);
        const step = active.keyframes.find((item) => item.role === 'step');
        if (step) state.setActiveKeyframe(step.id);
        useTimelineStore.getState().controller?.seek(frame);
        useTimelineStore.getState().setCurrentFrame(frame);
      }
    }
  };

  const preview = repeatOpen
    ? repeatPreview(composition, selectedLayerIds, repeatCount, repeatDirection, repeatGap)
    : { boxes: [], outsideTitleSafe: false };
  const previewTarget = repeatOpen
    ? toolbarRef.current?.closest('.canvas-stage')?.querySelector('.canvas-stage-pasteboard')
    : null;

  const penActive = usePenToolStore((s) => s.active);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key.toLowerCase() !== 'p' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        target?.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      event.preventDefault();
      usePenToolStore.getState().start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="add-element-toolbar" ref={toolbarRef}>
      <select
        className="recipe-select"
        aria-label="Add broadcast recipe"
        defaultValue=""
        onChange={addRecipe}
      >
        <option value="" disabled>
          + Recipe…
        </option>
        <option value="lower-third">Lower Third</option>
        <option value="bug">Bug / DOG</option>
        <option value="ticker">Ticker</option>
        <option value="scoreboard">Scoreboard</option>
        <option value="clock">Clock / Timer</option>
        <option value="countdown">Countdown</option>
      </select>
      <div className="element-tools" role="group" aria-label="Add element">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="element-tool-button"
            data-editor-shortcuts="allow"
            aria-label={`Add ${label}`}
            title={`Add ${label}`}
            data-tooltip={label}
            onClick={() => {
              if (kind === 'image') {
                const root = toolbarRef.current?.closest('.canvas-stage') ?? null;
                const placement = canvasInsertion(
                  root,
                  composition,
                  kind,
                  selectedLayerIds,
                  currentFrame,
                );
                const size = defaultTransformFor(kind);
                setImagePlacement({
                  position: { x: placement.x + size.width / 2, y: placement.y + size.height / 2 },
                  groupId: placement.groupId,
                  parentId: placement.parentId,
                });
                setImagePickerOpen(true);
              } else if (kind === 'pattern') usePatternDialogStore.getState().open();
              else {
                const root = toolbarRef.current?.closest('.canvas-stage') ?? null;
                const placement = canvasInsertion(
                  root,
                  composition,
                  kind,
                  selectedLayerIds,
                  currentFrame,
                );
                runDiscreteHistoryStep(() => select(addLayer(kind, placement)), `Add ${label}`);
              }
            }}
          >
            <ElementIcon kind={kind} />
          </button>
        ))}
        <button
          type="button"
          className="element-tool-button"
          aria-label="Pen tool"
          title="Pen (P): click to add corners, drag for curves, click first point to close; Esc finishes, Shift constrains"
          aria-pressed={penActive}
          onClick={() =>
            penActive ? usePenToolStore.getState().stop() : usePenToolStore.getState().start()
          }
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 21 7 12 18 2l4 4-10 11-9 4Zm4-9 5 5M3 21l6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <button
          type="button"
          className="element-tool-button"
          data-editor-shortcuts="allow"
          aria-label="Add Lottie JSON"
          title="Add Lottie JSON"
          data-tooltip="Lottie"
          onClick={() => lottieInputRef.current?.click()}
        >
          <ElementIcon kind="lottie" />
        </button>
      </div>
      <input
        ref={lottieInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void importLottie(event)}
      />
      {imagePickerOpen && (
        <ImagePicker {...imagePlacement} onClose={() => setImagePickerOpen(false)} />
      )}
      {selectedLayerIds.length > 0 && (
        <div className="arrange-toolbar" role="group" aria-label="Arrange selected layers">
          {ARRANGE_ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className="arrange-tool-button"
              aria-label={label}
              title={label}
              data-tooltip={label}
              disabled={!canArrange(action)}
              onClick={() => reorderLayers(arrangementFor(action))}
            >
              <ArrangeIcon action={action} />
            </button>
          ))}
        </div>
      )}
      {selectedLayerIds.length > 1 && (
        <div className="layout-toolbar" role="group" aria-label="Align and group selected layers">
          {[
            ['left', 'Align left', '⇤'],
            ['horizontal-center', 'Align horizontal centers', '↔'],
            ['right', 'Align right', '⇥'],
            ['top', 'Align top', '↥'],
            ['vertical-center', 'Align vertical centers', '↕'],
            ['bottom', 'Align bottom', '↧'],
          ].map(([mode, title, label]) => (
            <button
              key={mode}
              type="button"
              title={title}
              onClick={() =>
                alignLayers(
                  selectedLayerIds,
                  currentFrame,
                  mode as Parameters<typeof alignLayers>[2],
                )
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            title="Distribute horizontally"
            onClick={() => distributeLayers(selectedLayerIds, currentFrame, 'horizontal')}
          >
            H≡
          </button>
          <button
            type="button"
            title="Distribute vertically"
            onClick={() => distributeLayers(selectedLayerIds, currentFrame, 'vertical')}
          >
            V≡
          </button>
          <span className="layout-toolbar-divider" aria-hidden="true" />
          <select
            aria-label="Combine selected shapes"
            title="Combine fill outlines at this frame; strokes and effects are not included. Sources are hidden but kept. Subtract uses back-to-front order; Undo restores visibility."
            value=""
            onChange={(event) => {
              const operation = event.currentTarget
                .value as import('./shapeBoolean').ShapeBooleanOperation;
              if (!operation) return;
              void import('./shapeBoolean')
                .then(({ combineShapePaths }) => {
                  try {
                    const state = useProjectStore.getState();
                    if (
                      state.activeCompositionId !== composition.id ||
                      canvasFrame(composition) !== currentFrame
                    )
                      throw new Error('The template or frame changed; choose the operation again.');
                    const currentSelection = useSelectionStore.getState().selectedLayerIds;
                    if (
                      currentSelection.length !== selectedLayerIds.length ||
                      currentSelection.some((id) => !selectedLayerIds.includes(id))
                    )
                      throw new Error('The selection changed; select the shapes again.');
                    const active = state.project.compositions.find(
                      (entry) => entry.id === state.activeCompositionId,
                    );
                    if (!active) throw new Error('The active composition is no longer available.');
                    const selected = active.layers.filter((layer) =>
                      selectedLayerIds.includes(layer.id),
                    );
                    if (selected.length !== selectedLayerIds.length)
                      throw new Error('The selection changed; select the shapes again.');
                    if (
                      selected.some((source) =>
                        active.layers.some((layer) => layer.parentId === source.id),
                      )
                    )
                      throw new Error('Unparent child layers before combining their parent shape.');
                    const result = combineShapePaths(selected, currentFrame, operation);
                    runDiscreteHistoryStep(() => {
                      const id = useProjectStore.getState().addDrawnPath(result);
                      useProjectStore.getState().updateLayerElement(id, {
                        fill: result.fill,
                        strokeColor: 'transparent',
                        strokeWidth: 0,
                      });
                      useProjectStore.getState().renameLayer(id, `Shape ${operation}`);
                      for (const source of selected)
                        if (source.isVisible)
                          useProjectStore.getState().toggleLayerVisibility(source.id);
                      useSelectionStore.getState().select(id);
                    }, `Shape ${operation}`);
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : String(error));
                  }
                })
                .catch((error) =>
                  window.alert(error instanceof Error ? error.message : String(error)),
                );
            }}
          >
            <option value="" disabled>
              Combine shapes…
            </option>
            <option value="union">Union</option>
            <option value="subtract">Subtract</option>
            <option value="intersect">Intersect</option>
            <option value="exclude">Exclude</option>
          </select>
          {selectionIsPersistentGroup ? (
            <button type="button" onClick={() => ungroupLayers(selectedLayerIds)}>
              Ungroup
            </button>
          ) : (
            <button type="button" onClick={() => groupLayers(selectedLayerIds)}>
              Group
            </button>
          )}
        </div>
      )}
      <div className="canvas-backdrop-control" ref={backgroundControlRef}>
        <label>
          <select
            aria-label="Canvas backdrop"
            value={
              followingOtherPreview
                ? 'presentation:follow-preview'
                : usingPresentation
                  ? `presentation:${presentationChoice}`
                  : `local:${backdrop.mode}`
            }
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value.startsWith('local:')) {
                backdrop.setBackdrop({
                  mode: value.slice(6) as CanvasBackdropMode,
                  showPresentation: false,
                });
                setBackgroundSettingsOpen(false);
              } else if (value === 'presentation:follow-preview') {
                backdrop.setBackdrop({ showPresentation: true });
                setBackgroundSettingsOpen(false);
              } else {
                const source = value.slice('presentation:'.length);
                if (
                  choosePresentationBackground(
                    source,
                    presentation.ownerKey,
                    presentation.settings,
                    presentation.update,
                    program.setBackground,
                    stopWebcamPresentation,
                  )
                ) {
                  backdrop.setBackdrop({ showPresentation: true });
                  setBackgroundSettingsOpen(
                    source === 'webcam' || source === 'still-image' || source === 'program:video',
                  );
                }
              }
            }}
          >
            <option value="local:dark">Dark checker</option>
            <option value="local:light">Light checker</option>
            <option value="local:solid">Solid backdrop</option>
            {hasOtherPreview && <option value="presentation:follow-preview">Follow preview</option>}
            {visiblePresentationOptions.map((option) => (
              <option
                key={option.value}
                value={`presentation:${option.value}`}
                disabled={!presentation.ownerKey}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="canvas-backdrop-action-slot">
          {!usingPresentation && backdrop.mode === 'solid' ? (
            <span className="canvas-backdrop-color">
              <ColorInput
                label="Canvas backdrop color"
                value={backdrop.color}
                alpha={false}
                onChange={(color) => backdrop.setBackdrop({ color })}
              />
            </span>
          ) : usingPresentation && configurablePresentation ? (
            <button
              type="button"
              className="canvas-backdrop-settings-button"
              aria-label="Presentation background settings"
              title="Presentation background settings"
              aria-expanded={backgroundSettingsOpen}
              onClick={() => setBackgroundSettingsOpen(!backgroundSettingsOpen)}
            >
              ⋯
            </button>
          ) : null}
        </div>
        {usingPresentation && configurablePresentation && backgroundSettingsOpen && (
          <div
            className="canvas-backdrop-popover"
            role="dialog"
            aria-label="Presentation background settings"
          >
            <PreviewBackgroundControls initiallyOpen compact />
          </div>
        )}
      </div>
      <div className="repeat-control">
        <button
          type="button"
          disabled={!selectedLayerIds.length}
          aria-expanded={repeatOpen}
          onClick={() => {
            setRepeatError('');
            setRepeatOpen((open) => !open);
          }}
        >
          Repeat…
        </button>
        {repeatOpen && selectedLayerIds.length > 0 && (
          <div
            className="repeat-popover"
            role="dialog"
            aria-label="Repeat selection"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setRepeatOpen(false);
              }
            }}
          >
            <label>
              Count{' '}
              <input
                type="number"
                min={2}
                max={50}
                value={repeatCount}
                onChange={(event) =>
                  setRepeatCount(Math.max(2, Math.min(50, Number(event.currentTarget.value) || 2)))
                }
              />
            </label>
            <label>
              Direction{' '}
              <select
                value={repeatDirection}
                onChange={(event) =>
                  setRepeatDirection(event.currentTarget.value as 'horizontal' | 'vertical')
                }
              >
                <option value="horizontal">Row</option>
                <option value="vertical">Column</option>
              </select>
            </label>
            <label>
              Gap{' '}
              <input
                type="number"
                min={0}
                value={repeatGap}
                onChange={(event) =>
                  setRepeatGap(Math.max(0, Number(event.currentTarget.value) || 0))
                }
              />
            </label>
            {preview.outsideTitleSafe && (
              <p role="status">Copies extend outside the title-safe area.</p>
            )}
            {repeatError && <p role="alert">{repeatError}</p>}
            <div>
              <button
                type="button"
                onClick={() => {
                  const applied = runDiscreteHistoryStep(() => {
                    const result = addRepeater(
                      selectedLayerIds,
                      repeatCount,
                      repeatDirection,
                      repeatGap,
                    );
                    if (result)
                      selectMany(result.items.flatMap((item) => Object.values(item.layers)));
                    return Boolean(result);
                  }, 'Repeat selection');
                  if (applied) setRepeatOpen(false);
                  else
                    setRepeatError(
                      'Could not repeat this selection. Check that its objects are unlocked and can be grouped.',
                    );
                }}
              >
                Apply
              </button>
              <button type="button" onClick={() => setRepeatOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {previewTarget &&
        createPortal(
          <div className="repeat-ghost-overlay" aria-hidden="true">
            {preview.boxes.map((box, index) => (
              <div
                key={index}
                className="repeat-ghost"
                style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
              />
            ))}
          </div>,
          previewTarget,
        )}
    </div>
  );
}
