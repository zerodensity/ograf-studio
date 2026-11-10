import { useReviewPlacementStore } from '../state/reviewPlacementStore';
import { CanvasPoseGhosts } from './CanvasPoseGhosts';
import { canvasFrame, useCanvasViewStore } from '../state/canvasViewStore';
import { registerEditorPreviewSource } from '../state/editorPreviewSourceStore';
import {
  editorVisualRuleEffects,
  resolveDesignerElement,
  resolveDesignerTransform,
} from '../state/dataBinding';
import {
  copyLayers as copyLayerSelection,
  deleteLayers as deleteLayerSelection,
  groupLayers as groupLayerSelection,
  pasteLayers as pasteLayerClipboard,
  ungroupLayers as ungroupLayerSelection,
} from '../state/layerCommands';
import { useTestDataStore } from '../state/testDataStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useCanvasBackdropStore } from '../state/canvasBackdropStore';
import { shouldRenderEditorCanvas } from './canvasVisibility';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import Moveable from 'react-moveable';
import {
  getLayerTransformAtFrame,
  useActiveComposition,
  useProjectStore,
} from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore, type TimelineController } from '../state/timelineStore';
import { clearEditorLoopSamples, recordEditorLoopSample } from '../state/editorLoopSample';
import { synchronizeTimelineKeySelection } from '../panels/timelineFrameNavigation';
import {
  getTotalFrames,
  getCompositionOutputRect,
  clipPathForParentBounds,
  compositionBackgroundLayer,
  normalizeAuthoredTransformPatch,
  applyLayerRuleGeometry,
  layerRuleModifiers,
  layerTransformBindingChannel,
  type Layer,
  type LayerTransform,
  type TextElement,
  type FieldDefinition,
} from '@ograf-editor/scene-model';
import { ContextMenu } from '../components/ContextMenu';
import { CanvasCropOverlay } from './CanvasCropOverlay';
import { useCropToolStore } from '../state/cropToolStore';
import { resetLayerCrops, useLayerCropStore } from '../state/layerCropStore';
import { useLayerClipboardStore } from '../state/layerClipboardStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { newTemplate } from '../state/templateCommands';
import { buildMasterTimeline, editorRuntimeData } from './masterTimeline';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  applyCompiledClipPaths,
  applyCompiledMasks,
  applyCompiledLayerVisualState,
  applyCompiledAutoLayout,
  hasAutoSizedTextClip,
  applyCompiledMotionPaths,
  applyCompiledModifiers,
  MediaCueRuntime,
  sampleCompiledLayerVisualState,
  compositionHasBackdropBlur,
} from '@ograf-editor/ograf-runtime';
import { LayerNode } from './LayerNode';
import { PathEditor } from './PathEditor';
import { PenTool } from './PenTool';
import { usePenToolStore } from '../state/penToolStore';
import { usePathEditStore } from '../state/pathEditStore';
import { pathConversionError } from '@ograf-editor/scene-model';
import { AddElementToolbar } from './AddElementToolbar';
import { CanvasZoomControls } from './CanvasZoomControls';
import { useImagePlacement } from '../state/useImagePlacement';
import { useFitZoom } from './useFitZoom';
import { parseCssTransform } from './transformGeometry';
import {
  layerSelectionCrop,
  syncCropSelectionTarget,
  cropSelectionTransform,
  translateSelectionTarget,
} from './cropSelectionGeometry';
import { constrainedTranslation, dominantDragAxis, type DragAxis } from './axisConstrainedDrag';
import {
  getCenteredStageScroll,
  getStagePasteboardLayout,
  recenterStageCamera,
  type StageCameraOrigin,
} from './stagePasteboard';
import { transparencyCheckerboardStyle } from './compositionBackground';
import { viewportScrollForPointer, type ViewportPanOrigin } from './viewportPan';
import { snapLayerPosition } from './layoutGeometry';
import { CanvasLayoutOverlay } from './CanvasLayoutOverlay';
import { CanvasRulers } from './CanvasRulers';
import { CanvasOutsideDimmer } from './CanvasOutsideDimmer';
import { CanvasPresentationBackground } from './CanvasPresentationBackground';
import {
  isPersistentGroupSelection,
  selectionForPointer,
  selectionIdsForLayer,
} from './groupSelection';
import {
  captureStageZoomAnchor,
  nextStageZoom,
  scrollForStageZoom,
  stageZoomDirectionForWheel,
  type StageZoomAnchor,
} from './stageZoom';
import { nextOgrafStepFrame } from './ografStepPlayback';
import { ShaderPreviewClock } from './shaderPreviewClock';
import { StageLoopPreviewClock } from './stageLoopPreviewClock';
import { isInteractiveShortcutTarget } from '../state/keyboardShortcuts';
import { stageDeleteTarget } from './stageDeleteTarget';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { duplicateLayerSelection } from '../state/editorShortcuts';
import { inlineTextEditTarget } from './inlineTextEditing';
import { measureAutoSizedText } from '../panels/textAutoSize';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import {
  hasShaderCanvasDrag,
  shaderCanvasDragData,
  type ShaderCanvasDragData,
} from '../state/shaderCanvasDrag';
import {
  applyShaderCanvasDrop,
  shaderCanvasDropChoices,
  type ShaderCanvasDropContext,
} from '../state/shaderCanvasDrop';
import { shaderDropTargetIds } from './shaderDropTargets';
import {
  applyCanvasBrandColor,
  canvasDropKind,
  placeCanvasNonImage,
} from '../state/canvasFileDrop';
import './Stage.css';

function inlineDesignerText(layer: Layer, fields: FieldDefinition[]): TextElement | null {
  if (layer.element.type !== 'text') return null;
  try {
    const element = resolveDesignerElement(layer, useTestDataStore.getState().values, fields);
    return element.type === 'text' ? element : layer.element;
  } catch {
    return layer.element;
  }
}

export function Stage({ style }: { style?: CSSProperties }) {
  const backdrop = useCanvasBackdropStore((state) => state.mode);
  const backdropColor = useCanvasBackdropStore((state) => state.color);
  const showPresentationBackground = useCanvasBackdropStore((state) => state.showPresentation);
  const pathLayerId = usePathEditStore((s) => s.layerId);
  const penActive = usePenToolStore((s) => s.active);
  const placingReview = useReviewPlacementStore((s) => s.placing);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const playheadPathFrame = useTimelineStore((s) => (pathLayerId ? s.currentFrame : 0));
  const viewMode = useCanvasViewStore((s) => s.mode);
  const imagePlacement = useImagePlacement();
  const [draggingImages, setDraggingImages] = useState(false);
  const [fileDropBusy, setFileDropBusy] = useState(false);
  const [draggingShader, setDraggingShader] = useState(false);
  const [shaderDropError, setShaderDropError] = useState('');
  const [shaderDrop, setShaderDrop] = useState<{
    x: number;
    y: number;
    source: ShaderCanvasDragData;
    context: ShaderCanvasDropContext;
  } | null>(null);
  const closeShaderDrop = useCallback(() => setShaderDrop(null), []);
  const project = useProjectStore((state) => state.project);
  const reviewFrame = useTimelineStore((state) =>
    project.review?.comments?.length ? Math.round(state.currentFrame) : 0,
  );
  const templateSetEmpty = useProjectSetStore(
    (state) => !!state.projectSet && !state.projectSet.templates.length,
  );
  // Re-render open choices when a pack is disabled, removed, updated or reviewed.
  useRendererPluginSettingsStore((state) => state.installed);
  const [inlineTextEditingLayerId, setInlineTextEditingLayerId] = useState<string | null>(null);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const selectionBeforeDoubleClick = useRef<string[]>([]);
  const [inlineTextCaretPoint, setInlineTextCaretPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [inlineTextPreview, setInlineTextPreview] = useState<{
    layerId: string;
    transform: Partial<LayerTransform>;
  } | null>(null);
  const authoredComposition = useActiveComposition();
  const cropRequestId = useCropToolStore((state) => state.request?.id);
  const activeCrop = useCropToolStore.getState().request;
  const cropping = Boolean(
    activeCrop &&
    activeCrop.projectId === project.id &&
    activeCrop.compositionId === authoredComposition.id,
  );
  const composition = useMemo(() => {
    const request = cropRequestId ? useCropToolStore.getState().request : null;
    if (
      !request ||
      request.projectId !== project.id ||
      request.compositionId !== authoredComposition.id
    )
      return authoredComposition;
    // Reveal the full authored content while adjusting the editor-only crop draft.
    // The project and its undo history remain untouched until Apply.
    return {
      ...authoredComposition,
      crop: undefined,
      layers:
        request.kind === 'layers'
          ? authoredComposition.layers.map((layer) =>
              request.layerIds.includes(layer.id) ? { ...layer, crop: undefined } : layer,
            )
          : authoredComposition.layers,
    };
  }, [authoredComposition, cropRequestId, project.id]);
  const compositionRef = useRef(composition);
  compositionRef.current = composition;
  const pathFrame = pathLayerId ? canvasFrame(composition, playheadPathFrame, viewMode) : 0;
  const visibleReviewFrame = Math.round(canvasFrame(composition, reviewFrame, viewMode));
  const reviewPins = (project.review?.comments ?? []).filter(
    (comment) =>
      !comment.resolved &&
      comment.compositionId === composition.id &&
      comment.frame === visibleReviewFrame,
  );
  useEffect(() => {
    if (!placingReview) return;
    const owner = viewportRef.current?.ownerDocument ?? document;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        useReviewPlacementStore.getState().cancelPlacement();
      }
    };
    owner.addEventListener('keydown', cancel, true);
    return () => owner.removeEventListener('keydown', cancel, true);
  }, [placingReview]);
  useEffect(() => setEnteredGroupId(null), [project.id, composition.id]);
  const backgroundLayer = useMemo(() => compositionBackgroundLayer(composition), [composition]);
  // Test data never changes the authored descriptor. Masks, loops and transport share its
  // immutable structure while sampling current bindings and Rules on every requested render.
  const compiledDescriptor = useMemo(
    () => compileDescriptor(composition, { includeGuides: true }),
    [composition],
  );
  const outputSourceRef = useRef<HTMLDivElement>(null);
  const synchronizedPreview = useWorkspaceStore(
    (state) => state.editorPreferences.syncEditorPreview,
  );
  const [canvasRenderingActive, setCanvasRenderingActive] = useState(true);
  const canvasRenderingActiveRef = useRef(canvasRenderingActive);
  canvasRenderingActiveRef.current = canvasRenderingActive;
  useLayoutEffect(() => {
    const root = outputSourceRef.current;
    if (!root) return;
    const owner = root.ownerDocument;
    const refresh = () =>
      setCanvasRenderingActive(shouldRenderEditorCanvas(root, synchronizedPreview));
    owner.addEventListener('fullscreenchange', refresh);
    owner.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      owner.removeEventListener('fullscreenchange', refresh);
      owner.removeEventListener('visibilitychange', refresh);
    };
  }, [synchronizedPreview, project.id, composition.id]);
  useLayoutEffect(() => {
    const root = outputSourceRef.current;
    if (!root) return;
    return registerEditorPreviewSource({
      root,
      projectId: project.id,
      compositionId: composition.id,
      output: getCompositionOutputRect(composition),
    });
  }, [project.id, composition]);
  const shaderDropChoices = (() => {
    if (!shaderDrop) return null;
    try {
      return shaderCanvasDropChoices(shaderDrop.source, shaderDrop.context);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return {
        name: 'Shader',
        options: (['fill', 'outline', 'effect'] as const).map((target) => ({
          target,
          label: target === 'fill' ? 'Fill' : target === 'outline' ? 'Outline' : 'Effect',
          reason,
        })),
      };
    }
  })();
  useEffect(() => {
    if (
      shaderDrop &&
      (shaderDrop.context.projectId !== project.id ||
        shaderDrop.context.compositionId !== composition.id)
    )
      closeShaderDrop();
  }, [shaderDrop, project.id, composition.id, closeShaderDrop]);
  const shaderClockRef = useRef<{
    compositionId: string;
    frameRate: number;
    clock: ShaderPreviewClock;
    loopClock: StageLoopPreviewClock;
  } | null>(null);
  if (
    shaderClockRef.current?.compositionId !== composition.id ||
    shaderClockRef.current.frameRate !== composition.frameRate
  ) {
    shaderClockRef.current = {
      compositionId: composition.id,
      frameRate: composition.frameRate,
      clock: new ShaderPreviewClock((canvasFrame(composition) / composition.frameRate) * 1000),
      loopClock: new StageLoopPreviewClock(),
    };
  }
  const shaderPreviewClock = shaderClockRef.current.clock;
  const loopPreviewClock = shaderClockRef.current.loopClock;
  const previewLoopLayerId = useTimelineStore((state) => state.previewLoopLayerId);
  const loopPreviewEpoch = useRef<{ compositionId: string; layerId: string; time: number } | null>(
    null,
  );
  const writeLayerTransform = useProjectStore((s) => s.updateLayerTransform);
  const updateLayerTransform = useCallback(
    (...args: Parameters<typeof writeLayerTransform>) => {
      try {
        writeLayerTransform(...args);
        setShaderDropError('');
      } catch (cause) {
        setShaderDropError(cause instanceof Error ? cause.message : String(cause));
        timelineRef.current?.render();
      }
    },
    [writeLayerTransform],
  );
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const removeLayerKeyframe = useProjectStore((s) => s.removeLayerKeyframe);
  const removeLayerPropertyKeyframe = useProjectStore((s) => s.removeLayerPropertyKeyframe);
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectedLayerKeyframeId = useSelectionStore((s) => s.selectedLayerKeyframeId);
  const select = useSelectionStore((s) => s.select);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const deselectAll = useSelectionStore((s) => s.deselectAll);
  const toggleManyLayerSelection = useSelectionStore((s) => s.toggleManyLayerSelection);
  const clearLayerKeyframe = useSelectionStore((s) => s.clearLayerKeyframe);
  const setLiveTransform = useSelectionStore((s) => s.setLiveTransform);
  const clearLiveTransform = useSelectionStore((s) => s.clearLiveTransform);
  const clipboardLayers = useLayerClipboardStore((s) => s.layers);

  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const setPlaying = useTimelineStore((s) => s.setPlaying);
  const setDurationFrames = useTimelineStore((s) => s.setDurationFrames);
  const setController = useTimelineStore((s) => s.setController);

  const commitInlineText = useCallback(
    (layer: Layer, value: string) => {
      const target = inlineTextEditTarget(layer, composition.dataFields);
      if (!target) return;
      if (layer.element.type !== 'text') return;
      const element: TextElement = {
        ...inlineDesignerText(layer, composition.dataFields)!,
        content: value,
        runs: [],
      };
      updateLayerElement(layer.id, { content: value, runs: [] });
      if (element.autoFit === 'auto-size')
        updateLayerTransform(
          layer.id,
          Math.round(canvasFrame(compositionRef.current)),
          measureAutoSizedText(element),
        );
    },
    [composition.dataFields, updateLayerElement, updateLayerTransform],
  );
  const handleInlineTextEditingChange = useCallback(
    (layerId: string, editing: boolean, caretPoint?: { x: number; y: number }) => {
      setInlineTextEditingLayerId(editing ? layerId : null);
      setInlineTextCaretPoint(editing ? (caretPoint ?? null) : null);
      if (!editing) setInlineTextPreview(null);
    },
    [],
  );
  const previewInlineText = useCallback(
    (layer: Layer, value: string) => {
      if (layer.element.type !== 'text' || layer.element.autoFit !== 'auto-size') return;
      const displayed = inlineDesignerText(layer, composition.dataFields)!;
      setInlineTextPreview({
        layerId: layer.id,
        transform: measureAutoSizedText({ ...displayed, content: value, runs: [] }),
      });
    },
    [composition.dataFields],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const fitZoom = useFitZoom(viewportRef, composition.width, composition.height);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const zoom = manualZoom ?? fitZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pendingZoomAnchorRef = useRef<StageZoomAnchor | null>(null);
  const pasteboard = useMemo(
    () => getStagePasteboardLayout(composition.width, composition.height, zoom),
    [composition.height, composition.width, zoom],
  );
  const pasteboardRef = useRef<HTMLDivElement>(null);
  const stageOriginRef = useRef<StageCameraOrigin>({
    x: pasteboard.frameLeft,
    y: pasteboard.frameTop,
  });
  const recenteringRef = useRef(false);

  const applyStageOrigin = useCallback((origin: StageCameraOrigin) => {
    stageOriginRef.current = origin;
    const element = pasteboardRef.current;
    if (element) {
      element.style.left = `${origin.x}px`;
      element.style.top = `${origin.y}px`;
    }
  }, []);

  const syncStageCameraCss = useCallback((viewport: HTMLDivElement) => {
    const target = workspaceRef.current ?? viewport;
    target.style.setProperty('--stage-scroll-left', `${viewport.scrollLeft}px`);
    target.style.setProperty('--stage-scroll-top', `${viewport.scrollTop}px`);
    target.style.setProperty('--stage-origin-x', `${stageOriginRef.current.x}px`);
    target.style.setProperty('--stage-origin-y', `${stageOriginRef.current.y}px`);
  }, []);

  const recenterStageViewport = useCallback(
    (viewport: HTMLDivElement) => {
      if (recenteringRef.current) return;
      const next = recenterStageCamera(
        pasteboard,
        viewport.clientWidth,
        viewport.clientHeight,
        { left: viewport.scrollLeft, top: viewport.scrollTop },
        stageOriginRef.current,
      );
      if (
        Math.abs(next.scroll.left - viewport.scrollLeft) < 0.5 &&
        Math.abs(next.scroll.top - viewport.scrollTop) < 0.5
      )
        return;
      recenteringRef.current = true;
      applyStageOrigin(next.origin);
      viewport.scrollLeft = next.scroll.left;
      viewport.scrollTop = next.scroll.top;
      syncStageCameraCss(viewport);
      requestAnimationFrame(() => {
        recenteringRef.current = false;
      });
    },
    [applyStageOrigin, pasteboard, syncStageCameraCss],
  );

  const setStageZoom = useCallback((nextZoom: number, client?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const currentZoom = zoomRef.current;
    if (nextZoom === currentZoom) {
      // Typing the current value still selects a fixed magnification rather than Fit.
      setManualZoom(nextZoom);
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const viewportX = client ? client.x - rect.left : viewport.clientWidth / 2;
    const viewportY = client ? client.y - rect.top : viewport.clientHeight / 2;
    pendingZoomAnchorRef.current = captureStageZoomAnchor(
      currentZoom,
      viewport.scrollLeft,
      viewport.scrollTop,
      viewportX,
      viewportY,
      stageOriginRef.current.x,
      stageOriginRef.current.y,
    );
    setManualZoom(nextZoom);
  }, []);

  const requestStageZoom = useCallback(
    (direction: 'in' | 'out', client?: { x: number; y: number }) => {
      setStageZoom(nextStageZoom(zoomRef.current, direction), client);
    },
    [setStageZoom],
  );

  const fitStage = useCallback(() => {
    pendingZoomAnchorRef.current = null;
    // When already at the fit magnification, React has no zoom change to center for us.
    if (Math.abs(zoomRef.current - fitZoom) < 1e-8 && viewportRef.current) {
      const viewport = viewportRef.current;
      applyStageOrigin({ x: pasteboard.frameLeft, y: pasteboard.frameTop });
      const scroll = getCenteredStageScroll(
        pasteboard,
        viewport.clientWidth,
        viewport.clientHeight,
      );
      viewport.scrollLeft = scroll.left;
      viewport.scrollTop = scroll.top;
      syncStageCameraCss(viewport);
    }
    setManualZoom(null);
  }, [applyStageOrigin, fitZoom, pasteboard, syncStageCameraCss]);

  useEffect(() => {
    setManualZoom(null);
  }, [composition.height, composition.id, composition.width]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const handleWheel = (event: WheelEvent) => {
      if (
        isInteractiveShortcutTarget(event.target) ||
        (event.target as Element | null)?.closest?.('.canvas-zoom-controls')
      )
        return;
      const direction = stageZoomDirectionForWheel(event.deltaY);
      if (!direction) return;
      event.preventDefault();
      requestStageZoom(direction, { x: event.clientX, y: event.clientY });
    };
    workspace.addEventListener('wheel', handleWheel, { passive: false });
    return () => workspace.removeEventListener('wheel', handleWheel);
  }, [requestStageZoom]);

  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const selectionRefs = useRef(new Map<string, HTMLDivElement>());
  const selectionRefCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const refCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const moveableRef = useRef<Moveable>(null);
  const shiftPressedRef = useRef(false);
  const panGestureRef = useRef<(ViewportPanOrigin & { pointerId: number }) | null>(null);
  const [targetVersion, bumpTargetVersion] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [objectMenu, setObjectMenu] = useState<{
    x: number;
    y: number;
    layerIds: string[];
  } | null>(null);
  useEffect(() => {
    if (!cropRequestId) return;
    setObjectMenu(null);
    setInlineTextEditingLayerId(null);
    const initialSelection = useSelectionStore.getState().selectedLayerIds.join('\0');
    const cancelAfterContextChange = () => {
      const crop = useCropToolStore.getState();
      const request = crop.request;
      if (!request || request.id !== cropRequestId) return;
      const scene = useProjectStore.getState();
      const timeline = useTimelineStore.getState();
      if (
        scene.project.id !== request.projectId ||
        scene.activeCompositionId !== request.compositionId ||
        canvasFrame(compositionRef.current, timeline.currentFrame) !== request.frame ||
        timeline.isPlaying ||
        useSelectionStore.getState().selectedLayerIds.join('\0') !== initialSelection
      )
        crop.close();
    };
    const stops = [
      useProjectStore.subscribe(cancelAfterContextChange),
      useTimelineStore.subscribe(cancelAfterContextChange),
      useCanvasViewStore.subscribe(cancelAfterContextChange),
      useSelectionStore.subscribe(cancelAfterContextChange),
    ];
    return () => stops.forEach((stop) => stop());
  }, [cropRequestId]);
  const dragConstraintRef = useRef<{
    shiftActive: boolean;
    axis: DragAxis | null;
    distance: number;
    anchors: Map<HTMLElement | SVGElement, { x: number; y: number; rotation: number }>;
    lastTransforms: Map<HTMLElement | SVGElement, { x: number; y: number; rotation: number }>;
  }>({
    shiftActive: false,
    axis: null,
    distance: 0,
    anchors: new Map(),
    lastTransforms: new Map(),
  });

  // Ref callbacks must have a stable identity across renders — an inline arrow function
  // would get a new identity every render, causing React to re-invoke it (null, then element)
  // on every render, which retriggers the setState below and loops forever.
  const getLayerRefCallback = useCallback((id: string) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (el) => {
        if (el) layerRefs.current.set(id, el);
        else layerRefs.current.delete(id);
        bumpTargetVersion((n) => n + 1);
      };
      refCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);
  const getSelectionRefCallback = useCallback((id: string) => {
    let callback = selectionRefCallbacks.current.get(id);
    if (!callback) {
      callback = (element) => {
        if (element) selectionRefs.current.set(id, element);
        else selectionRefs.current.delete(id);
        bumpTargetVersion((version) => version + 1);
      };
      selectionRefCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  const syncSelectionTargets = useCallback(() => {
    for (const layer of composition.layers) {
      const crop = layerSelectionCrop(layer);
      const root = layerRefs.current.get(layer.id);
      const target = selectionRefs.current.get(layer.id);
      if (crop && root && target) syncCropSelectionTarget(root, target, crop);
    }
  }, [composition]);

  // The version is intentionally read to make ref attachment/removal trigger fresh target lookup.
  void targetVersion;
  // A complete group is selected explicitly. A deep-selected child must not
  // move, crop or expose properties for its siblings.
  const interactionLayerIds = selectedLayerIds;
  const isPersistentGroup = isPersistentGroupSelection(composition, interactionLayerIds);
  const targetEls = interactionLayerIds
    .filter(
      (layerId) => !composition.layers.find((candidate) => candidate.id === layerId)?.isLocked,
    )
    .filter((layerId) => {
      const layer = composition.layers.find((candidate) => candidate.id === layerId)!;
      const crop = layerSelectionCrop(layer);
      return !crop || (crop.width > 0 && crop.height > 0);
    })
    .map((layerId) => {
      const layer = composition.layers.find((candidate) => candidate.id === layerId)!;
      return layer.crop ? selectionRefs.current.get(layerId) : layerRefs.current.get(layerId);
    })
    .filter((element): element is HTMLDivElement => element !== undefined);
  const targetEl = targetEls.length === 1 ? targetEls[0]! : null;
  const moveableTarget = targetEls.length > 1 ? targetEls : targetEl;
  const isGroupSelection = targetEls.length > 1;
  const selectedLayer = composition.layers.find((layer) => layer.id === selectedLayerId);
  const editingPath =
    !cropping &&
    selectedLayer?.id === pathLayerId &&
    selectedLayer.element.type === 'path' &&
    !selectedLayer.isLocked &&
    selectedLayerIds.length === 1 &&
    !isPlaying;
  useEffect(() => {
    if (pathLayerId && !editingPath) usePathEditStore.getState().stop();
  }, [pathLayerId, editingPath]);
  const selectedPose = selectedLayer
    ? getLayerTransformAtFrame(selectedLayer, canvasFrame(composition))
    : null;
  const selectedCrop = selectedLayer ? layerSelectionCrop(selectedLayer) : null;
  const moveableTransformOrigin = selectedPose
    ? ([
        `${(selectedCrop ? (selectedPose.transformOriginX - selectedCrop.x) / Math.max(0.000001, selectedCrop.width) : selectedPose.transformOriginX) * 100}%`,
        `${(selectedCrop ? (selectedPose.transformOriginY - selectedCrop.y) / Math.max(0.000001, selectedCrop.height) : selectedPose.transformOriginY) * 100}%`,
      ] as [string, string])
    : undefined;

  const inlineTextLayerAtPoint = (x: number, y: number) =>
    [...composition.layers].reverse().find((candidate) => {
      if (!inlineTextEditTarget(candidate, composition.dataFields)) return false;
      const element = layerRefs.current.get(candidate.id);
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });

  // A text box can cover a large transparent portion of a panel. During
  // group drill-down prefer the visible glyphs, then the layer beneath them.
  const layerAtPoint = (x: number, y: number): Layer | undefined => {
    const owner = viewportRef.current?.ownerDocument;
    if (!owner) return undefined;
    const seen = new Set<string>();
    for (const element of owner.elementsFromPoint(x, y)) {
      const id = element.closest<HTMLElement>('.layer-node[data-layer-id]')?.dataset.layerId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const layer = composition.layers.find((candidate) => candidate.id === id);
      if (!layer) continue;
      const root = layerRefs.current.get(id);
      // Decorative low-opacity textures should not intercept a click on the
      // opaque panel below. They remain selectable directly in Layers.
      if (root && Number(owner.defaultView?.getComputedStyle(root).opacity ?? 1) < 0.1) continue;
      if (layer.element.type === 'text') {
        if (root) {
          const walker = owner.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
          let hasRects = false;
          let hit = false;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            const range = owner.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              hasRects = true;
              if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
                hit = true;
            }
          }
          if (hasRects && !hit) continue;
        }
      }
      return layer;
    }
    return undefined;
  };

  const copyLayerIds = (layerIds: string[]) => {
    copyLayerSelection(layerIds);
  };

  const deleteLayerIds = (layerIds: string[]) => {
    deleteLayerSelection(layerIds);
  };

  const pasteClipboardLayers = () => {
    pasteLayerClipboard();
  };

  const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (cropping) {
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement;
    const layerId = target.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;
    const isSelectionControl = Boolean(target.closest('.moveable-control-box'));
    let layerIds: string[] = [];

    if (layerId) {
      const clickedIds = selectionIdsForLayer(composition, layerId);
      layerIds = selectedLayerIds.includes(layerId) ? interactionLayerIds : clickedIds;
      if (!selectedLayerIds.includes(layerId)) selectMany(clickedIds);
    } else if (isSelectionControl && selectedLayerIds.length > 0) {
      layerIds = interactionLayerIds;
    } else if (clipboardLayers.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setObjectMenu({ x: event.clientX, y: event.clientY, layerIds });
  };

  const beginViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element | null)?.closest?.('.canvas-zoom-controls')) return;
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panGestureRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
  };

  const updateViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const scroll = viewportScrollForPointer(gesture, event.clientX, event.clientY);
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = scroll.left;
      viewportRef.current.scrollTop = scroll.top;
    }
  };

  const endViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    panGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    if (viewportRef.current) recenterStageViewport(viewportRef.current);
  };

  const readTransformPatch = (
    target: HTMLElement | SVGElement,
    extra?: { width?: number; height?: number },
  ): Partial<LayerTransform> => {
    if ((target as HTMLElement).dataset.cropSelectionTarget) {
      const layer = composition.layers.find(
        (candidate) => candidate.id === (target as HTMLElement).dataset.layerId,
      );
      const crop = layer ? layerSelectionCrop(layer) : null;
      if (crop && crop.width > 0 && crop.height > 0) {
        const patch = cropSelectionTransform(target as HTMLElement, crop);
        return normalizeAuthoredTransformPatch({
          x: patch.x,
          y: patch.y,
          rotation: patch.rotation,
          ...(extra?.width !== undefined ? { width: patch.width } : {}),
          ...(extra?.height !== undefined ? { height: patch.height } : {}),
        });
      }
    }
    const { x, y, rotation } = parseCssTransform((target as HTMLElement).style.transform);
    return normalizeAuthoredTransformPatch({ x, y, rotation, ...extra });
  };

  const currentTranslate = (target: HTMLElement | SVGElement): [number, number] => {
    const { x, y } = parseCssTransform((target as HTMLElement).style.transform);
    return [x, y];
  };

  const applySelectionTransform = (target: HTMLElement | SVGElement, resize = false) => {
    const element = target as HTMLElement;
    if (!element.dataset.cropSelectionTarget) return;
    const layer = composition.layers.find((candidate) => candidate.id === element.dataset.layerId);
    const crop = layer ? layerSelectionCrop(layer) : null;
    const root = layer ? layerRefs.current.get(layer.id) : undefined;
    if (!layer || !crop || !root || !crop.width || !crop.height) return;
    const patch = cropSelectionTransform(element, crop);
    root.style.transform = patch.transform;
    if (resize) {
      root.style.width = `${patch.width}px`;
      root.style.height = `${patch.height}px`;
      const pose = getLayerTransformAtFrame(layer, canvasFrame(composition));
      root.style.transformOrigin = `${pose.transformOriginX * 100}% ${pose.transformOriginY * 100}%`;
    }
  };

  const applySnapping = (target: HTMLElement | SVGElement) => {
    const layerId = layerIdForTarget(target);
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    const parsed = parseCssTransform((target as HTMLElement).style.transform);
    const pose = getLayerTransformAtFrame(layer, canvasFrame(composition));
    const verticalGuides = [0, composition.width / 2, composition.width];
    const horizontalGuides = [0, composition.height / 2, composition.height];
    if (composition.layout.snapToGuides) {
      for (const guide of composition.layout.guides) {
        (guide.axis === 'vertical' ? verticalGuides : horizontalGuides).push(guide.position);
      }
    }
    if (composition.layout.snapToLayers) {
      for (const candidate of composition.layers) {
        if (candidate.id === layer.id || !candidate.isVisible || candidate.isGuide) continue;
        const other = getLayerTransformAtFrame(candidate, canvasFrame(composition));
        verticalGuides.push(other.x, other.x + other.width / 2, other.x + other.width);
        horizontalGuides.push(other.y, other.y + other.height / 2, other.y + other.height);
      }
    }
    const snapped = snapLayerPosition(
      {
        x: parsed.x,
        y: parsed.y,
        width: (target as HTMLElement).dataset.cropSelectionTarget
          ? Number.parseFloat((target as HTMLElement).style.width)
          : pose.width,
        height: (target as HTMLElement).dataset.cropSelectionTarget
          ? Number.parseFloat((target as HTMLElement).style.height)
          : pose.height,
      },
      {
        threshold: composition.layout.snappingEnabled ? composition.layout.snapThreshold : 0,
        gridSize:
          composition.layout.snappingEnabled && composition.layout.snapToGrid
            ? composition.layout.gridSize
            : undefined,
        verticalGuides: composition.layout.snappingEnabled ? verticalGuides : [],
        horizontalGuides: composition.layout.snappingEnabled ? horizontalGuides : [],
        bounds:
          composition.layout.boundsMode === 'contain'
            ? { width: composition.width, height: composition.height }
            : undefined,
      },
    );
    translateSelectionTarget(target as HTMLElement, snapped.x, snapped.y);
  };

  const beginConstrainedDrag = (targets: Array<HTMLElement | SVGElement>) => {
    const lastTransforms = new Map(
      targets.map((target) => [target, parseCssTransform((target as HTMLElement).style.transform)]),
    );
    dragConstraintRef.current = {
      shiftActive: false,
      axis: null,
      distance: 0,
      anchors: new Map(),
      lastTransforms,
    };
  };

  const applyConstrainedDrag = (
    events: Array<{
      target: HTMLElement | SVGElement;
      transform: string;
    }>,
    delta: readonly number[],
    shiftKey: boolean,
  ) => {
    const constraint = dragConstraintRef.current;
    if (!shiftKey) {
      constraint.shiftActive = false;
      constraint.axis = null;
      constraint.distance = 0;
      constraint.anchors.clear();
      for (const event of events) {
        (event.target as HTMLElement).style.transform = event.transform;
        constraint.lastTransforms.set(
          event.target,
          parseCssTransform((event.target as HTMLElement).style.transform),
        );
      }
      return;
    }

    if (!constraint.shiftActive) {
      constraint.shiftActive = true;
      constraint.axis = dominantDragAxis(delta);
      constraint.distance = 0;
      constraint.anchors = new Map(constraint.lastTransforms);
    } else if (!constraint.axis) {
      constraint.axis = dominantDragAxis(delta);
    }

    if (!constraint.axis) return;
    constraint.distance += delta[constraint.axis === 'x' ? 0 : 1] ?? 0;
    for (const event of events) {
      const anchor = constraint.anchors.get(event.target);
      if (!anchor) continue;
      const next = constrainedTranslation(anchor, constraint.axis, constraint.distance);
      translateSelectionTarget(event.target as HTMLElement, next.x, next.y);
      constraint.lastTransforms.set(event.target, { ...next, rotation: anchor.rotation });
    }
  };

  const previewTransform = (
    target: HTMLElement | SVGElement,
    extra?: { width?: number; height?: number },
  ) => {
    applySelectionTransform(target, extra?.width !== undefined || extra?.height !== undefined);
    const layerId = (target as HTMLElement).dataset.layerId;
    if (layerId) setLiveTransform(layerId, readTransformPatch(target, extra));
  };

  const layerIdForTarget = (target: HTMLElement | SVGElement): string | undefined =>
    (target as HTMLElement).dataset.layerId;

  const commitTransform = (
    target: HTMLElement | SVGElement,
    extra?: { width?: number; height?: number },
  ) => {
    const layerId = layerIdForTarget(target);
    if (!layerId) return;
    applySelectionTransform(target, extra?.width !== undefined || extra?.height !== undefined);
    updateLayerTransform(layerId, canvasFrame(composition), readTransformPatch(target, extra));
    clearLiveTransform();
  };

  const commitGroupTransforms = (
    events: { target: HTMLElement | SVGElement }[],
    options: { includeSize?: boolean; skipParentedDescendants?: boolean } = {},
  ) => {
    const eventLayerIds = new Set(
      events
        .map((event) => layerIdForTarget(event.target))
        .filter((layerId): layerId is string => Boolean(layerId)),
    );
    for (const event of events) {
      const layerId = layerIdForTarget(event.target);
      if (layerId) {
        let parentId = composition.layers.find((layer) => layer.id === layerId)?.parentId ?? null;
        let ancestorMovesWithGroup = false;
        while (parentId) {
          if (eventLayerIds.has(parentId)) {
            ancestorMovesWithGroup = true;
            break;
          }
          parentId = composition.layers.find((layer) => layer.id === parentId)?.parentId ?? null;
        }
        if (ancestorMovesWithGroup && options.skipParentedDescendants !== false) continue;
        const target = event.target as HTMLElement;
        const width = options.includeSize ? Number.parseFloat(target.style.width) : undefined;
        const height = options.includeSize ? Number.parseFloat(target.style.height) : undefined;
        updateLayerTransform(
          layerId,
          canvasFrame(composition),
          readTransformPatch(event.target, {
            ...(Number.isFinite(width) ? { width } : {}),
            ...(Number.isFinite(height) ? { height } : {}),
          }),
        );
      }
    }
    clearLiveTransform();
  };

  useLayoutEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && usePathEditStore.getState().layerId) {
        usePathEditStore.getState().stop();
        e.preventDefault();
        return;
      }
      if (e.key === 'Shift') shiftPressedRef.current = true;
      if (isInteractiveShortcutTarget(e.target)) return;
      if (e.key === 'Escape' && selectedLayerIds.length) {
        const layer = composition.layers.find((candidate) => candidate.id === selectedLayerId);
        const group = layer?.groupId ? selectionIdsForLayer(composition, layer.id) : [];
        if (group.length > 1 && !isPersistentGroupSelection(composition, selectedLayerIds))
          selectMany(group);
        else deselectAll();
        setEnteredGroupId(null);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && selectedLayerIds.length === 1 && selectedLayerId) {
        const layer = composition.layers.find((candidate) => candidate.id === selectedLayerId);
        if (
          layer &&
          inlineTextEditTarget(layer, composition.dataFields) &&
          !isPlaying &&
          !cropping
        ) {
          setInlineTextEditingLayerId(layer.id);
          setInlineTextCaretPoint(null);
          e.preventDefault();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_'].includes(e.key)) {
        e.preventDefault();
        requestStageZoom(e.key === '+' || e.key === '=' ? 'in' : 'out');
        return;
      }
      if (useCropToolStore.getState().request) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId) {
        e.preventDefault();
        const target = stageDeleteTarget(composition, useSelectionStore.getState());
        if (target.kind === 'layer-key' || target.kind === 'property-key') {
          runDiscreteHistoryStep(() => {
            if (target.kind === 'property-key')
              removeLayerPropertyKeyframe(target.layerId, target.property, target.keyframeId);
            else removeLayerKeyframe(target.layerId, target.keyframeId);
          }, 'Delete keyframe');
          clearLayerKeyframe();
        } else if (target.kind === 'layers') {
          for (const layerId of target.layerIds) removeLayer(layerId);
          select(null);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressedRef.current = false;
    };
    const handleBlur = () => {
      shiftPressedRef.current = false;
      panGestureRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    clearLayerKeyframe,
    composition,
    cropping,
    deselectAll,
    isPlaying,
    removeLayer,
    removeLayerKeyframe,
    removeLayerPropertyKeyframe,
    requestStageZoom,
    select,
    selectMany,
    selectedLayerId,
    selectedLayerIds,
    selectedLayerKeyframeId,
  ]);

  // Rebuild the shared frame player after composition edits and register the transport controller.
  // Playback and seeking use composition frames; media and content clocks use milliseconds.
  const timelineRef = useRef<ReturnType<typeof buildMasterTimeline> | null>(null);
  const clockDisplays = useRef({
    projectId: project.id,
    compositionId: composition.id,
    values: new Map<string, TextElement>(),
  });
  if (
    clockDisplays.current.projectId !== project.id ||
    clockDisplays.current.compositionId !== composition.id
  )
    clockDisplays.current = {
      projectId: project.id,
      compositionId: composition.id,
      values: new Map(),
    };
  const publishClockDisplay = useCallback(
    (layerId: string, display: TextElement | null) => {
      if (display) clockDisplays.current.values.set(layerId, display);
      else clockDisplays.current.values.delete(layerId);
      if (!canvasRenderingActiveRef.current) return;
      // Clock callbacks replace glyph DOM independently of React. Reapply the shared complete pose
      // once, without ticking any clock or authoring a document change.
      timelineRef.current?.render();
      syncSelectionTargets();
    },
    [syncSelectionTargets],
  );
  useEffect(
    () =>
      useTimelineStore.subscribe((state, previous) => {
        // Direct agent/project frame changes are also seeks. Automatic Step arrival publishes its
        // final frame while playing, so it deliberately leaves the content clock running.
        if (!state.isPlaying && state.currentFrame !== previous.currentFrame) {
          const frame = canvasFrame(composition, state.currentFrame, viewMode);
          if (viewMode === 'design') timelineRef.current?.seek(frame, true);
          shaderPreviewClock.seek((frame / composition.frameRate) * 1000);
        }
      }),
    [composition, shaderPreviewClock, viewMode],
  );
  const maskTestValues = useTestDataStore((state) => state.values);
  const maskRuleOverrides = useTestDataStore((state) => state.visualRuleStateOverrides);
  const refreshLoopData = useRef<(() => void) | null>(null);
  const lastLoopData = useRef({ values: maskTestValues, overrides: maskRuleOverrides });
  useEffect(() => {
    if (!canvasRenderingActive) return;
    const descriptor = compiledDescriptor;
    if (!descriptor.layers.some((layer) => layer.mask)) {
      // Still clear retired masks/source-only visibility; no sampled geometry is read here.
      applyCompiledMasks(descriptor, layerRefs.current, new Map());
      return;
    }
    const frame = canvasFrame(composition);
    const data = editorRuntimeData(composition, descriptor.layers);
    applyCompiledMasks(
      descriptor,
      layerRefs.current,
      new Map(
        descriptor.layers.map((layer) => [
          layer.id,
          sampleCompiledLayerVisualState(layer, frame, undefined, data),
        ]),
      ),
    );
  }, [composition, compiledDescriptor, maskTestValues, maskRuleOverrides, canvasRenderingActive]);
  useEffect(() => {
    const frameRate = composition.frameRate;
    const durationFrames = getTotalFrames(composition);
    const wasPlaying = useTimelineStore.getState().isPlaying;
    const descriptor = compiledDescriptor;
    const mediaCueHost = document.createElement('div');
    mediaCueHost.dataset.ografStudioMediaCues = 'true';
    mediaCueHost.style.display = 'none';
    document.body.appendChild(mediaCueHost);
    const mediaCueRuntime = new MediaCueRuntime(mediaCueHost, descriptor);

    timelineRef.current?.dispose();
    const tl = buildMasterTimeline(
      composition,
      layerRefs.current,
      () => clockDisplays.current.values,
      descriptor,
    );
    timelineRef.current = tl;

    setDurationFrames(durationFrames);

    // Resync to wherever the playhead currently is, so an unrelated edit (e.g. renaming a
    // layer) doesn't visually snap the canvas back to Keyframe 0.
    const currentFrame = useTimelineStore.getState().currentFrame;
    tl.seek(canvasFrame(composition, currentFrame, viewMode), true);
    shaderPreviewClock.seek((tl.frame() / frameRate) * 1000);

    const publishFrame = (frame: number) => {
      setCurrentFrame(frame);
      if (useCanvasViewStore.getState().mode === 'animate') {
        // A graph edit can move a key before React replaces this controller's old render closure.
        const latest = useProjectStore.getState();
        const active = latest.project.compositions.find(
          (candidate) => candidate.id === latest.activeCompositionId,
        );
        if (active?.id === composition.id) synchronizeTimelineKeySelection(active, frame);
      }
    };
    tl.on('update', () => {
      const timelineTimeMs = (tl.frame() / frameRate) * 1000;
      publishFrame(tl.frame());
      if (useTimelineStore.getState().isPlaying) mediaCueRuntime.renderAtTime(timelineTimeMs);
    });
    tl.on('complete', () => {
      shaderPreviewClock.pause(performance.now());
      setPlaying(false);
    });

    let segmentTransition: ReturnType<typeof tl.animateTo> | null = null;
    const controller: TimelineController = {
      seek: (frame) => {
        segmentTransition?.cancel();
        segmentTransition = null;
        tl.pause();
        setPlaying(false);
        mediaCueRuntime.reset();
        const nextFrame = Math.max(0, Math.min(durationFrames, frame));
        tl.seek(canvasFrame(composition, nextFrame, viewMode), true);
        publishFrame(nextFrame);
        shaderPreviewClock.seek((tl.frame() / frameRate) * 1000);
      },
      play: () => {
        if (useCanvasViewStore.getState().mode === 'design') {
          useCanvasViewStore.getState().setMode('animate');
          tl.seek(useTimelineStore.getState().currentFrame, true);
        }
        // Restart a completed template when the user presses Play.
        if (tl.frame() >= tl.durationFrames()) {
          mediaCueRuntime.reset();
          tl.seek(0, true);
          publishFrame(0);
          shaderPreviewClock.seek(0);
        }
        mediaCueRuntime.resumeBlocked();
        mediaCueRuntime.renderAtTime((tl.frame() / frameRate) * 1000);
        shaderPreviewClock.play(performance.now());
        setPlaying(true);
        const current = tl.frame();
        const nextStep = useTimelineStore.getState().pauseAtOgrafSteps
          ? nextOgrafStepFrame(composition, current)
          : undefined;
        if (nextStep === undefined) {
          tl.play();
          return;
        }
        segmentTransition?.cancel();
        let settled = false;
        const transition = tl.animateTo(nextStep, {
          onComplete: () => {
            settled = true;
            segmentTransition = null;
            tl.pause();
            tl.seek(nextStep, true);
            publishFrame(nextStep);
            setPlaying(false);
          },
        });
        if (!settled) segmentTransition = transition;
      },
      pause: () => {
        segmentTransition?.cancel();
        segmentTransition = null;
        tl.pause();
        mediaCueRuntime.reset();
        shaderPreviewClock.pause(performance.now());
        setPlaying(false);
      },
      stop: () => {
        segmentTransition?.cancel();
        segmentTransition = null;
        tl.pause();
        mediaCueRuntime.reset();
        tl.seek(canvasFrame(composition, 0, viewMode), true);
        publishFrame(0);
        shaderPreviewClock.seek((tl.frame() / frameRate) * 1000);
        setPlaying(false);
      },
    };
    setController(controller);

    if (wasPlaying) {
      controller.play();
    }

    return () => {
      segmentTransition?.cancel();
      tl.dispose();
      mediaCueRuntime.dispose();
      if (useTimelineStore.getState().controller === controller) setController(null);
    };
  }, [
    composition,
    compiledDescriptor,
    setController,
    setCurrentFrame,
    setDurationFrames,
    setPlaying,
    shaderPreviewClock,
    viewMode,
  ]);

  // Normal Timeline playback uses the compiled runtime sampler for every active local loop, not
  // only the manually previewed layer. This keeps ticker crawls, pulses, and other ambient motion
  // aligned with exported playout while preserving the editable Stage DOM and visible Timeline.
  useEffect(() => {
    const descriptor = compiledDescriptor;
    const loopLayers = descriptor.layers.filter(
      (layer) =>
        layer.bindings.some((binding) => layerTransformBindingChannel(binding.targetProperty)) ||
        layer.loop ||
        layer.lighting ||
        layer.visualRules?.length ||
        layer.element.type === 'pattern' ||
        layer.layoutParentId ||
        layer.autoLayout?.direction !== 'none' ||
        hasAutoSizedTextClip(layer) ||
        layer.modifiers?.length ||
        layer.motionPath,
    );
    if (loopLayers.length === 0) return;
    const previewTimeline = timelineRef.current;
    const previewMoveable = moveableRef.current;
    const previewLightingPattern = descriptor.layers.find(
      (layer) => layer.id === previewLoopLayerId,
    )?.lighting?.patternId;
    // Source/selection edits must not restart the other channels of the same preview loop.
    if (previewLoopLayerId) {
      if (
        loopPreviewEpoch.current?.compositionId !== composition.id ||
        loopPreviewEpoch.current.layerId !== previewLoopLayerId
      )
        loopPreviewEpoch.current = {
          compositionId: composition.id,
          layerId: previewLoopLayerId,
          time: performance.now(),
        };
    } else loopPreviewEpoch.current = null;
    const epoch = loopPreviewEpoch.current?.time ?? performance.now();
    let animationFrame = 0;
    const render = (now: number) => {
      animationFrame = 0;
      if (!canvasRenderingActiveRef.current) return;
      const baseFrame = previewTimeline?.frame() ?? 0;
      const timelineIsPlaying = useTimelineStore.getState().isPlaying;
      const contentTimeMs = shaderPreviewClock.sample(now);
      const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
      const data = editorRuntimeData(composition, descriptor.layers);
      for (const layer of descriptor.layers) {
        const activeElapsed = loopPreviewClock.sample(descriptor, layer, baseFrame, contentTimeMs);
        const elapsed =
          (layer.id === previewLoopLayerId ||
            (previewLightingPattern &&
              (layer.lighting?.patternId === previewLightingPattern ||
                (layer.element.type === 'pattern' &&
                  layer.element.patternId === previewLightingPattern)))) &&
          !timelineIsPlaying
            ? ((now - epoch) / 1000) * descriptor.frameRate
            : activeElapsed;
        if (layer.loop) recordEditorLoopSample(composition, layer.id, baseFrame, elapsed);
        const state = sampleCompiledLayerVisualState(layer, baseFrame, elapsed, data);
        states.set(layer.id, state);
      }
      applyCompiledAutoLayout(descriptor, states, data, layerRefs.current, {
        timestampMs: contentTimeMs,
        clockText: clockDisplays.current.values,
      });
      applyCompiledMotionPaths(descriptor, states);
      applyCompiledModifiers(descriptor, states, data, layerRefs.current, {
        timestampMs: contentTimeMs,
        clockText: clockDisplays.current.values,
      });
      for (const layer of descriptor.layers) {
        const state = states.get(layer.id);
        const element = layerRefs.current.get(layer.id);
        if (element && state) applyCompiledLayerVisualState(element, state, contentTimeMs);
      }
      applyCompiledClipPaths(descriptor, layerRefs.current, states);
      applyCompiledMasks(descriptor, layerRefs.current, states);
      syncSelectionTargets();
      if (selectedLayerIds.length > 0) previewMoveable?.updateTarget();
      animationFrame =
        timelineIsPlaying || shaderPreviewClock.running || previewLoopLayerId
          ? requestAnimationFrame(render)
          : 0;
    };
    const sync = () => {
      cancelAnimationFrame(animationFrame);
      render(performance.now());
    };
    refreshLoopData.current = sync;
    const unsubscribeClock = shaderPreviewClock.subscribe(sync);
    const fontSet = viewportRef.current?.ownerDocument.fonts;
    fontSet?.addEventListener('loadingdone', sync);
    fontSet?.addEventListener('loadingerror', sync);
    sync();
    return () => {
      clearEditorLoopSamples(composition);
      if (refreshLoopData.current === sync) refreshLoopData.current = null;
      unsubscribeClock();
      fontSet?.removeEventListener('loadingdone', sync);
      fontSet?.removeEventListener('loadingerror', sync);
      cancelAnimationFrame(animationFrame);
      // Reassert the base pose without cancelling transport started by the next React effect.
      if (canvasRenderingActiveRef.current) {
        previewTimeline?.render();
        previewMoveable?.updateTarget();
      }
    };
  }, [
    composition,
    compiledDescriptor,
    isPlaying,
    previewLoopLayerId,
    selectedLayerIds,
    shaderPreviewClock,
    loopPreviewClock,
    syncSelectionTargets,
  ]);
  // Data changes resample after React commits new/hidden layer hosts; they do not rebuild the
  // descriptor or reset the manually previewed loop's epoch and clock subscriptions.
  useEffect(() => {
    if (
      lastLoopData.current.values === maskTestValues &&
      lastLoopData.current.overrides === maskRuleOverrides
    )
      return;
    lastLoopData.current = { values: maskTestValues, overrides: maskRuleOverrides };
    refreshLoopData.current?.();
  }, [maskTestValues, maskRuleOverrides]);
  useEffect(() => {
    refreshLoopData.current?.();
  }, [canvasRenderingActive]);

  // Apply the pose before Moveable measures the committed target, particularly after north/west
  // resizes where both size and translation change. The hook order intentionally enforces that.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const anchor = pendingZoomAnchorRef.current;
    if (!anchor) {
      applyStageOrigin({ x: pasteboard.frameLeft, y: pasteboard.frameTop });
    }
    const scroll = anchor
      ? scrollForStageZoom(anchor, zoom, stageOriginRef.current.x, stageOriginRef.current.y)
      : getCenteredStageScroll(pasteboard, viewport.clientWidth, viewport.clientHeight);
    pendingZoomAnchorRef.current = null;
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
    syncStageCameraCss(viewport);
    recenterStageViewport(viewport);
  }, [applyStageOrigin, pasteboard, recenterStageViewport, syncStageCameraCss, zoom]);

  useLayoutEffect(() => {
    // updateTarget (rather than updateRect) refreshes transform-origin as well as the outer bounds.
    syncSelectionTargets();
    if (moveableTarget) moveableRef.current?.updateTarget();
  }, [composition, moveableTarget, zoom, syncSelectionTargets]);

  useEffect(() => {
    if (!moveableTarget) return;

    // The frame player writes evaluated poses directly to layer DOM nodes, so Stage does not
    // React-render every layer on every playback tick. Keep Moveable on that same imperative path:
    // a seek/step/scrub has already updated the target before setCurrentFrame publishes the new
    // playhead value, and updateTarget remeasures both its bounds and transform origin before paint.
    let previousFrame = canvasFrame(composition);
    return useTimelineStore.subscribe((state) => {
      if (state.currentFrame === previousFrame) return;
      previousFrame = state.currentFrame;
      syncSelectionTargets();
      moveableRef.current?.updateTarget();
    });
  }, [moveableTarget, composition, syncSelectionTargets]);

  if (templateSetEmpty)
    return (
      <section className="canvas-stage canvas-empty-template-set" style={style}>
        <p>This template set has no templates.</p>
        <button type="button" onClick={() => newTemplate()}>
          New Template
        </button>
        <p>Or insert an .ogs template from the Templates pane.</p>
      </section>
    );
  return (
    <section className="canvas-stage" style={style}>
      <AddElementToolbar />
      {editingPath && selectedLayer && (
        <PathEditor
          key={selectedLayer.id}
          layer={selectedLayer}
          pose={getLayerTransformAtFrame(selectedLayer, pathFrame)}
          zoom={zoom}
          container={pasteboardRef.current}
          onPreview={setPathDraft}
        />
      )}
      <div
        className="canvas-stage-workspace"
        ref={workspaceRef}
        onPointerDownCapture={beginViewportPan}
        onPointerMoveCapture={updateViewportPan}
        onPointerUpCapture={endViewportPan}
        onPointerCancelCapture={endViewportPan}
        onLostPointerCapture={(event) => {
          if (panGestureRef.current?.pointerId === event.pointerId) {
            panGestureRef.current = null;
            setIsPanning(false);
            if (viewportRef.current) recenterStageViewport(viewportRef.current);
          }
        }}
      >
        {draggingShader && (
          <div className="image-placement-banner" role="status">
            Drop shader to choose Fill, Outline or Effect
          </div>
        )}
        {shaderDropError && (
          <div className="image-placement-banner image-placement-error" role="alert">
            {shaderDropError}
            <button type="button" onClick={() => setShaderDropError('')}>
              Dismiss
            </button>
          </div>
        )}
        {(draggingImages || imagePlacement.busy || fileDropBusy) && (
          <div className="image-placement-banner" role="status">
            {imagePlacement.busy || fileDropBusy ? 'Opening file…' : 'Drop a file to add it here'}
          </div>
        )}
        {imagePlacement.error && (
          <div className="image-placement-banner image-placement-error" role="alert">
            {imagePlacement.error}
            <button type="button" onClick={imagePlacement.clearError}>
              Dismiss
            </button>
          </div>
        )}
        <div
          className={`canvas-stage-viewport${isPanning ? ' is-panning' : ''}`}
          ref={viewportRef}
          data-ograf-zoom={zoom}
          aria-label={`Canvas viewport, ${Math.round(zoom * 100)}% zoom`}
          title="Mouse wheel or Ctrl/Command+plus/minus to zoom; middle-drag to pan"
          tabIndex={0}
          style={transparencyCheckerboardStyle(1, backdrop, backdropColor)}
          onDragEnterCapture={(event) => {
            if (event.dataTransfer.types.includes('application/x-ograf-brand-color')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              return;
            }
            if (!hasShaderCanvasDrag(event.dataTransfer.types)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragOverCapture={(event) => {
            if (event.dataTransfer.types.includes('application/x-ograf-brand-color')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              return;
            }
            if (hasShaderCanvasDrag(event.dataTransfer.types)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDraggingShader(true);
              return;
            }
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = imagePlacement.busy || fileDropBusy ? 'none' : 'copy';
              setDraggingImages(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDraggingImages(false);
              setDraggingShader(false);
            }
          }}
          onDropCapture={(event) => {
            if (event.dataTransfer.types.includes('application/x-ograf-brand-color')) {
              event.preventDefault();
              event.stopPropagation();
              try {
                const reference = JSON.parse(
                  event.dataTransfer.getData('application/x-ograf-brand-color'),
                ) as { tokenId: string; projectId: string; compositionId: string };
                const target = layerAtPoint(event.clientX, event.clientY);
                if (!target) throw new Error('Drop the Brand Kit color on an object.');
                applyCanvasBrandColor(reference, target.id);
                setShaderDropError('');
              } catch (cause) {
                setShaderDropError(cause instanceof Error ? cause.message : String(cause));
              }
              return;
            }
            if (hasShaderCanvasDrag(event.dataTransfer.types)) {
              event.preventDefault();
              event.stopPropagation();
              setDraggingShader(false);
              setShaderDropError('');
              try {
                const source = shaderCanvasDragData(event.dataTransfer);
                if (!source) throw new Error('No shader drag reference was provided.');
                const current = useProjectStore.getState();
                const currentComposition = current.project.compositions.find(
                  (item) => item.id === current.activeCompositionId,
                );
                if (!currentComposition)
                  throw new Error('The active composition no longer exists.');
                const hit = event.currentTarget.ownerDocument
                  .elementsFromPoint(event.clientX, event.clientY)
                  .map((element) => element.closest<HTMLElement>('.layer-node[data-layer-id]'))
                  .find((element) => element && event.currentTarget.contains(element));
                const layerIds = shaderDropTargetIds(
                  currentComposition,
                  useSelectionStore.getState().selectedLayerIds,
                  hit?.dataset.layerId,
                );
                if (layerIds.length) selectMany(layerIds);
                setShaderDrop({
                  x: event.clientX,
                  y: event.clientY,
                  source,
                  context: {
                    projectId: current.project.id,
                    compositionId: currentComposition.id,
                    layerIds,
                  },
                });
              } catch (cause) {
                setShaderDropError(cause instanceof Error ? cause.message : String(cause));
              }
              return;
            }
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            setDraggingImages(false);
            const files = [...event.dataTransfer.files];
            const bounds = pasteboardRef.current?.getBoundingClientRect();
            if (!files.length || !bounds || imagePlacement.busy || fileDropBusy) return;
            const position = {
              x: (event.clientX - bounds.left) / zoom,
              y: (event.clientY - bounds.top) / zoom,
            };
            const kind = canvasDropKind(files[0]!);
            // Fonts can be dropped anywhere in a text box, including whitespace outside its glyphs.
            const textTarget =
              kind === 'font'
                ? event.currentTarget.ownerDocument
                    .elementsFromPoint(event.clientX, event.clientY)
                    .map(
                      (node) =>
                        node.closest<HTMLElement>('.layer-node[data-layer-id]')?.dataset.layerId,
                    )
                    .map((id) =>
                      composition.layers.find(
                        (layer) => layer.id === id && layer.element.type === 'text',
                      ),
                    )
                    .find(Boolean)
                : undefined;
            const target = textTarget ?? layerAtPoint(event.clientX, event.clientY);
            setShaderDropError('');
            if (files.every((file) => canvasDropKind(file) === 'image')) {
              if (event.altKey && !target) {
                setShaderDropError('Alt-drop an image onto an unlocked image object.');
                return;
              }
              void imagePlacement.place(files, {
                position,
                ...(event.altKey ? { replaceLayerId: target!.id } : {}),
              });
            } else if (files.length !== 1) {
              setShaderDropError(
                'Drop one video, font or Lottie file at a time, or drop a group of images.',
              );
            } else {
              setFileDropBusy(true);
              void placeCanvasNonImage(files[0]!, position, target?.id, event.altKey)
                .catch((cause: unknown) =>
                  setShaderDropError(cause instanceof Error ? cause.message : String(cause)),
                )
                .finally(() => setFileDropBusy(false));
            }
          }}
          onMouseDownCapture={(event) => {
            if (
              event.button !== 0 ||
              isPlaying ||
              editingPath ||
              cropping ||
              penActive ||
              placingReview
            )
              return;
            if (
              (event.target as HTMLElement).closest(
                '.canvas-review-pin, [data-inline-text-editor="true"]',
              )
            )
              return;
            if (event.detail === 1) {
              selectionBeforeDoubleClick.current = [
                ...useSelectionStore.getState().selectedLayerIds,
              ];
              return;
            }
            if (
              (event.target as HTMLElement).closest('[data-layer-id]') ||
              inlineTextLayerAtPoint(event.clientX, event.clientY)
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onDoubleClickCapture={(event) => {
            if (isPlaying || editingPath || cropping || penActive || placingReview) return;
            if (
              (event.target as HTMLElement).closest(
                '.canvas-review-pin, [data-inline-text-editor="true"]',
              )
            )
              return;
            const layer =
              layerAtPoint(event.clientX, event.clientY) ??
              inlineTextLayerAtPoint(event.clientX, event.clientY);
            if (!layer) return;
            event.preventDefault();
            event.stopPropagation();
            const wasSelectedText =
              selectionBeforeDoubleClick.current.length === 1 &&
              selectionBeforeDoubleClick.current[0] === layer.id &&
              inlineTextEditTarget(layer, composition.dataFields);
            if (wasSelectedText) {
              selectMany([layer.id]);
              setInlineTextEditingLayerId(layer.id);
              setInlineTextCaretPoint({ x: event.clientX, y: event.clientY });
            } else {
              setEnteredGroupId(layer.groupId ?? null);
              selectMany([layer.id]);
            }
          }}
          onAuxClick={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          onMouseDown={(event) => {
            if (event.button !== 0 || editingPath || cropping || penActive || placingReview) return;
            const target = event.target as HTMLElement;
            if (target.closest?.('.canvas-review-pin')) return;
            if (
              target.closest?.('.canvas-stage-frame') ||
              target.closest?.('.moveable-control-box')
            )
              return;
            deselectAll();
          }}
          onContextMenu={handleCanvasContextMenu}
          onScroll={(event) => {
            syncStageCameraCss(event.currentTarget);
            moveableRef.current?.updateRect();
            if (!panGestureRef.current) recenterStageViewport(event.currentTarget);
          }}
        >
          <div
            className="canvas-stage-measure"
            style={{ width: pasteboard.measureWidth, height: pasteboard.measureHeight }}
          >
            <div
              ref={pasteboardRef}
              className="canvas-stage-pasteboard"
              style={{
                left: stageOriginRef.current.x,
                top: stageOriginRef.current.y,
                width: composition.width,
                height: composition.height,
                transform: `scale(${zoom})`,
              }}
            >
              <div
                ref={outputSourceRef}
                className="editor-output-source"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: composition.width,
                  height: composition.height,
                }}
              >
                {showPresentationBackground && <CanvasPresentationBackground />}
                <div
                  className="canvas-stage-frame"
                  data-ograf-backdrop-root={
                    compositionHasBackdropBlur(composition.layers) ? 'true' : undefined
                  }
                  style={{
                    left: 0,
                    top: 0,
                    width: composition.width,
                    height: composition.height,
                    backgroundColor:
                      composition.backgroundPaint === undefined
                        ? composition.backgroundColor
                        : 'transparent',
                    isolation: 'isolate',
                    filter: compositionHasBackdropBlur(composition.layers)
                      ? 'opacity(1)'
                      : undefined,
                    overflow: composition.layout.overflowPreview,
                  }}
                  onMouseDown={(e) => {
                    if (cropping) return;
                    if (e.target !== e.currentTarget) return;
                    if (editingPath) {
                      e.preventDefault();
                      pasteboardRef.current
                        ?.querySelector<SVGSVGElement>('.path-editor-overlay')
                        ?.focus();
                      return;
                    }
                    select(null);
                  }}
                >
                  {backgroundLayer ? (
                    <div
                      data-composition-background="true"
                      inert
                      aria-hidden="true"
                      style={{ display: 'contents', pointerEvents: 'none' }}
                    >
                      <LayerNode
                        renderActive={canvasRenderingActive}
                        layer={backgroundLayer}
                        pose={getLayerTransformAtFrame(backgroundLayer, canvasFrame(composition))}
                        isSelected={false}
                        onSelect={() => {}}
                        registerRef={getLayerRefCallback(backgroundLayer.id)}
                        assets={composition.assets}
                        dataFields={composition.dataFields}
                        compositionFrameRate={composition.frameRate}
                        shaderPreviewClock={shaderPreviewClock}
                        patterns={composition.patterns}
                        allowInlineTextEditing={false}
                        editingInlineText={false}
                        onCommitInlineText={commitInlineText}
                        onPreviewInlineText={previewInlineText}
                        onInlineTextEditingChange={handleInlineTextEditingChange}
                        onClockDisplay={publishClockDisplay}
                      />
                    </div>
                  ) : null}
                  {composition.layers.map((layer) => {
                    const frame = canvasFrame(composition);
                    const ruleEffects = editorVisualRuleEffects(
                      composition.layers,
                      composition.dataFields,
                      useTestDataStore.getState().values,
                      useTestDataStore.getState().visualRuleStateOverrides,
                    );
                    const rulePose = (candidate: Layer) =>
                      applyLayerRuleGeometry(
                        resolveDesignerTransform(
                          candidate,
                          getLayerTransformAtFrame(candidate, frame),
                          maskTestValues,
                          composition.dataFields,
                        ),
                        layerRuleModifiers(ruleEffects.get(candidate.id)?.properties),
                      );
                    const authoredPose = rulePose(layer);
                    const pose =
                      inlineTextPreview?.layerId === layer.id
                        ? { ...authoredPose, ...inlineTextPreview.transform }
                        : authoredPose;
                    const parent = layer.parentId
                      ? composition.layers.find(
                          (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
                        )
                      : undefined;
                    const clipPath = parent
                      ? clipPathForParentBounds(
                          pose,
                          rulePose(parent),
                          parent.element.type === 'rectangle' ? parent.element.borderRadius : 0,
                        )
                      : undefined;
                    return (
                      <LayerNode
                        renderActive={canvasRenderingActive}
                        key={layer.id}
                        layer={
                          editingPath &&
                          layer.id === pathLayerId &&
                          pathDraft &&
                          layer.element.type === 'path'
                            ? {
                                ...layer,
                                element: { ...layer.element, d: pathDraft, overflow: 'visible' },
                              }
                            : layer
                        }
                        pose={pose}
                        isSelected={
                          !cropping &&
                          !isPlaying &&
                          interactionLayerIds.includes(layer.id) &&
                          !isPersistentGroup
                        }
                        onSelect={({ additive, deep, clientX, clientY }) => {
                          if (cropping) return;
                          const target =
                            deep || (layer.groupId && layer.groupId === enteredGroupId)
                              ? (layerAtPoint(clientX, clientY) ?? layer)
                              : layer;
                          const selectionIds = selectionForPointer(composition, target.id, {
                            enteredGroupId,
                            deep,
                          });
                          if (deep) setEnteredGroupId(target.groupId ?? null);
                          else if (target.groupId !== enteredGroupId) setEnteredGroupId(null);
                          if (additive) {
                            toggleManyLayerSelection(selectionIds);
                          } else if (
                            selectionIds.length !== selectedLayerIds.length ||
                            selectionIds.some((id) => !selectedLayerIds.includes(id))
                          ) {
                            selectMany(selectionIds);
                          }
                        }}
                        registerRef={getLayerRefCallback(layer.id)}
                        assets={composition.assets}
                        dataFields={composition.dataFields}
                        clipPath={clipPath}
                        compositionFrameRate={composition.frameRate}
                        shaderPreviewClock={shaderPreviewClock}
                        patterns={composition.patterns}
                        onClockDisplay={publishClockDisplay}
                        allowInlineTextEditing={!isPlaying && !editingPath && !cropping}
                        editingInlineText={!cropping && inlineTextEditingLayerId === layer.id}
                        inlineTextCaretPoint={
                          inlineTextEditingLayerId === layer.id
                            ? (inlineTextCaretPoint ?? undefined)
                            : undefined
                        }
                        onCommitInlineText={commitInlineText}
                        onPreviewInlineText={previewInlineText}
                        onInlineTextEditingChange={handleInlineTextEditingChange}
                      />
                    );
                  })}
                  {composition.layers
                    .filter((layer) => layer.crop)
                    .map((layer) => (
                      <div
                        key={`selection-${layer.id}`}
                        ref={getSelectionRefCallback(layer.id)}
                        data-layer-id={layer.id}
                        data-crop-selection-target="true"
                        className="layer-crop-selection-target"
                        aria-hidden="true"
                      />
                    ))}
                  {!cropping && <CanvasLayoutOverlay composition={composition} zoom={zoom} />}
                  {composition.crop ? (
                    <div className="canvas-output-crop" aria-hidden="true">
                      <div
                        style={{
                          left: composition.crop.x,
                          top: composition.crop.y,
                          width: composition.crop.width,
                          height: composition.crop.height,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              {viewMode === 'animate' && selectedLayerIds.length > 0 && (
                <CanvasPoseGhosts
                  composition={composition}
                  selectedLayerIds={selectedLayerIds}
                  zoom={zoom}
                />
              )}
              {reviewPins.map((comment) => (
                <button
                  key={comment.id}
                  type="button"
                  className="canvas-review-pin"
                  aria-label={`Review comment by ${comment.author}: ${comment.text}`}
                  title={`${comment.author}: ${comment.text}`}
                  style={{
                    left: comment.x,
                    top: comment.y,
                    pointerEvents: penActive || cropping || editingPath ? 'none' : 'auto',
                    transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    useReviewPlacementStore.getState().selectComment(comment.id);
                  }}
                >
                  ●
                </button>
              ))}
              {placingReview && (
                <div
                  className="canvas-review-placement"
                  role="button"
                  tabIndex={0}
                  aria-label="Place review comment on the canvas; Escape cancels"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const bounds = pasteboardRef.current?.getBoundingClientRect();
                    if (!bounds) return;
                    useReviewPlacementStore.getState().completePlacement({
                      projectId: project.id,
                      compositionId: composition.id,
                      layerId: layerAtPoint(event.clientX, event.clientY)?.id ?? null,
                      frame: Math.round(canvasFrame(composition)),
                      x: (event.clientX - bounds.left) / zoom,
                      y: (event.clientY - bounds.top) / zoom,
                    });
                  }}
                >
                  <span>Click to place a review comment · Esc cancels</span>
                </div>
              )}
              {penActive && (
                <PenTool width={composition.width} height={composition.height} zoom={zoom} />
              )}
            </div>
            <div
              className="canvas-stage-border"
              aria-hidden="true"
              style={{ width: composition.width * zoom, height: composition.height * zoom }}
            />
          </div>
          {moveableTarget &&
            !isPlaying &&
            !editingPath &&
            !penActive &&
            !inlineTextEditingLayerId &&
            !cropping && (
              <Moveable
                key={isGroupSelection ? 'group-selection' : 'single-selection'}
                ref={moveableRef}
                target={moveableTarget}
                dragTarget={
                  targetEl?.dataset.cropSelectionTarget
                    ? layerRefs.current.get(targetEl.dataset.layerId!)
                    : undefined
                }
                className={[
                  isGroupSelection && 'stage-moveable-group',
                  isPersistentGroup && 'stage-moveable-persistent-group',
                ]
                  .filter(Boolean)
                  .join(' ')}
                rootContainer={viewportRef}
                useAccuratePosition
                flushSync={flushSync}
                transformOrigin={moveableTransformOrigin}
                draggable
                resizable={!isGroupSelection || isPersistentGroup}
                rotatable={!isGroupSelection || isPersistentGroup}
                rotateAroundControls={!isGroupSelection || isPersistentGroup}
                scrollable
                scrollContainer={viewportRef}
                scrollThreshold={32}
                scrollThrottleTime={16}
                onScroll={({ scrollContainer, direction }) => {
                  scrollContainer.scrollLeft += (direction[0] ?? 0) * 16;
                  scrollContainer.scrollTop += (direction[1] ?? 0) * 16;
                }}
                controlPadding={16}
                throttleDrag={0}
                throttleResize={0}
                throttleRotate={0}
                keepRatio={false}
                onDragStart={({ target, set }) => {
                  beginConstrainedDrag([target]);
                  set(currentTranslate(target));
                }}
                onDrag={({ target, transform, delta, inputEvent }) => {
                  const constrainAxis = shiftPressedRef.current || Boolean(inputEvent?.shiftKey);
                  applyConstrainedDrag([{ target, transform }], delta, constrainAxis);
                  if (!constrainAxis) applySnapping(target);
                  previewTransform(target);
                }}
                onDragEnd={({ target }) => commitTransform(target)}
                onDragGroupStart={({ events }) => {
                  beginConstrainedDrag(events.map((event) => event.target));
                  for (const event of events) event.set(currentTranslate(event.target));
                }}
                onDragGroup={({ events, delta, inputEvent }) => {
                  applyConstrainedDrag(
                    events,
                    delta,
                    shiftPressedRef.current || Boolean(inputEvent?.shiftKey),
                  );
                  for (const event of events) applySelectionTransform(event.target);
                  const primaryEvent = events.find(
                    (event) => layerIdForTarget(event.target) === selectedLayerId,
                  );
                  if (primaryEvent) previewTransform(primaryEvent.target);
                }}
                onDragGroupEnd={({ events }) => commitGroupTransforms(events)}
                onResizeGroup={({ events }) => {
                  for (const event of events) {
                    const target = event.target as HTMLElement;
                    target.style.width = `${event.width}px`;
                    target.style.height = `${event.height}px`;
                    target.style.transform = event.drag.transform;
                    applySelectionTransform(event.target, true);
                  }
                  const primary = events.find(
                    (event) => layerIdForTarget(event.target) === selectedLayerId,
                  );
                  if (primary) {
                    previewTransform(primary.target, {
                      width: primary.width,
                      height: primary.height,
                    });
                  }
                }}
                onResizeGroupEnd={({ events }) =>
                  commitGroupTransforms(events, {
                    includeSize: true,
                    skipParentedDescendants: false,
                  })
                }
                onResizeStart={({ target, dragStart, setOrigin }) => {
                  if (dragStart) dragStart.set(currentTranslate(target));
                  if (moveableTransformOrigin) setOrigin(moveableTransformOrigin);
                }}
                onResize={({ target, width, height, drag }) => {
                  target.style.width = `${width}px`;
                  target.style.height = `${height}px`;
                  // Keep authored relative origins relative while the box changes size.
                  if (moveableTransformOrigin) {
                    target.style.transformOrigin = moveableTransformOrigin.join(' ');
                  }
                  target.style.transform = drag.transform;
                  previewTransform(target, { width, height });
                }}
                onResizeEnd={({ target }) => {
                  const width = parseFloat((target as HTMLElement).style.width);
                  const height = parseFloat((target as HTMLElement).style.height);
                  commitTransform(target, { width, height });
                }}
                onRotateStart={({ target, set, dragStart }) => {
                  const { rotation } = parseCssTransform((target as HTMLElement).style.transform);
                  set(rotation);
                  if (dragStart) dragStart.set(currentTranslate(target));
                }}
                onRotate={({ target, drag }) => {
                  target.style.transform = drag.transform;
                  previewTransform(target);
                }}
                onRotateEnd={({ target }) => commitTransform(target)}
                onRotateGroup={({ events }) => {
                  for (const event of events) {
                    (event.target as HTMLElement).style.transform = event.drag.transform;
                    applySelectionTransform(event.target);
                  }
                  const primary = events.find(
                    (event) => layerIdForTarget(event.target) === selectedLayerId,
                  );
                  if (primary) previewTransform(primary.target);
                }}
                onRotateGroupEnd={({ events }) =>
                  commitGroupTransforms(events, { skipParentedDescendants: false })
                }
              />
            )}
        </div>
        <CanvasOutsideDimmer composition={composition} zoom={zoom} />
        <CanvasRulers
          composition={composition}
          zoom={zoom}
          viewportRef={viewportRef}
          stageOriginRef={stageOriginRef}
        />
        <CanvasCropOverlay
          viewportRef={viewportRef}
          pasteboardRef={pasteboardRef}
          layerRefs={layerRefs}
          zoom={zoom}
        />
        <CanvasZoomControls
          zoom={zoom}
          onZoomIn={() => requestStageZoom('in')}
          onZoomOut={() => requestStageZoom('out')}
          onZoomChange={setStageZoom}
          onFit={fitStage}
        />
      </div>
      {shaderDrop && shaderDropChoices && (
        <ContextMenu
          x={shaderDrop.x}
          y={shaderDrop.y}
          ariaLabel={`Use ${shaderDropChoices.name} as Fill, Outline or Effect`}
          onClose={closeShaderDrop}
          items={[
            { id: 'shader-use-as', label: 'Use shader as', disabled: true, onSelect: () => {} },
            ...shaderDropChoices.options.map((option) => ({
              id: option.target,
              label: option.label,
              disabled: Boolean(option.reason),
              title:
                option.reason ||
                (option.target === 'effect'
                  ? 'Add to Effects Stack with Normal blending at 100%, and save in Resources.'
                  : `Apply as ${option.label} and save in Resources.`),
              onSelect: () => {
                try {
                  applyShaderCanvasDrop(shaderDrop.source, shaderDrop.context, option.target);
                  setShaderDropError('');
                } catch (cause) {
                  setShaderDropError(cause instanceof Error ? cause.message : String(cause));
                }
              },
            })),
            {
              id: 'shader-cancel',
              label: 'Cancel',
              separatorBefore: true,
              onSelect: closeShaderDrop,
            },
          ]}
        />
      )}
      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          ariaLabel="Object actions"
          onClose={() => setObjectMenu(null)}
          items={[
            {
              id: 'crop',
              label: 'Crop',
              disabled:
                !objectMenu.layerIds.length ||
                composition.layers.some(
                  (layer) =>
                    objectMenu.layerIds.includes(layer.id) &&
                    (layer.isLocked || layer.element.type === 'audio'),
                ),
              onSelect: () => useLayerCropStore.getState().open(objectMenu.layerIds),
            },
            {
              id: 'reset-crop',
              label: 'Reset Crop',
              disabled:
                !composition.layers.some(
                  (layer) => objectMenu.layerIds.includes(layer.id) && layer.crop,
                ) ||
                composition.layers.some(
                  (layer) => objectMenu.layerIds.includes(layer.id) && layer.isLocked,
                ),
              onSelect: () => resetLayerCrops(objectMenu.layerIds),
            },
            {
              id: 'edit-path',
              label: 'Edit as path',
              disabled:
                objectMenu.layerIds.length !== 1 ||
                Boolean(
                  pathConversionError(
                    composition.layers.find((l) => l.id === objectMenu.layerIds[0])!,
                  ),
                ),
              onSelect: () => usePathEditStore.getState().start(objectMenu.layerIds[0]!),
            },
            {
              id: 'cut',
              label: 'Cut',
              disabled: objectMenu.layerIds.length === 0,
              onSelect: () => {
                copyLayerIds(objectMenu.layerIds);
                deleteLayerIds(objectMenu.layerIds);
              },
            },
            {
              id: 'copy',
              label: 'Copy',
              disabled: objectMenu.layerIds.length === 0,
              onSelect: () => copyLayerIds(objectMenu.layerIds),
            },
            {
              id: 'paste',
              label: 'Paste',
              disabled: clipboardLayers.length === 0,
              onSelect: pasteClipboardLayers,
            },
            {
              id: 'duplicate',
              label: 'Duplicate',
              disabled: objectMenu.layerIds.length === 0,
              separatorBefore: true,
              onSelect: () => duplicateLayerSelection(objectMenu.layerIds),
            },
            ...(isPersistentGroupSelection(composition, objectMenu.layerIds)
              ? [
                  {
                    id: 'ungroup',
                    label: 'Ungroup',
                    separatorBefore: true,
                    onSelect: () => ungroupLayerSelection(objectMenu.layerIds),
                  },
                ]
              : [
                  {
                    id: 'group',
                    label: 'Group',
                    separatorBefore: true,
                    disabled: objectMenu.layerIds.length < 2,
                    onSelect: () => groupLayerSelection(objectMenu.layerIds),
                  },
                ]),
            {
              id: 'delete',
              label: 'Delete',
              disabled: objectMenu.layerIds.length === 0,
              separatorBefore: true,
              onSelect: () => deleteLayerIds(objectMenu.layerIds),
            },
          ]}
        />
      )}
    </section>
  );
}
