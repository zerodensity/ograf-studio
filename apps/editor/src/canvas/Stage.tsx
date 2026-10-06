import { previewBindingData, resolveDesignerElement } from '../state/dataBinding';
import {
  copyLayers as copyLayerSelection,
  deleteLayers as deleteLayerSelection,
  groupLayers as groupLayerSelection,
  pasteLayers as pasteLayerClipboard,
  ungroupLayers as ungroupLayerSelection,
} from '../state/layerCommands';
import { useTestDataStore } from '../state/testDataStore';
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
import {
  getTotalFrames,
  clipPathForParentBounds,
  normalizeAuthoredTransformPatch,
  type Layer,
  type LayerTransform,
  type TextElement,
  type FieldDefinition,
} from '@ograf-editor/scene-model';
import { ContextMenu } from '../components/ContextMenu';
import { useLayerClipboardStore } from '../state/layerClipboardStore';
import { buildMasterTimeline } from './masterTimeline';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  applyCompiledClipPaths,
  applyCompiledMasks,
  applyCompiledLayerVisualState,
  applyCompiledAutoLayout,
  applyCompiledMotionPaths,
  MediaCueRuntime,
  sampleCompiledLayerVisualState,
} from '@ograf-editor/ograf-runtime';
import { LayerNode } from './LayerNode';
import { PathEditor } from './PathEditor';
import { usePathEditStore } from '../state/pathEditStore';
import { pathConversionError } from '@ograf-editor/scene-model';
import { AddElementToolbar } from './AddElementToolbar';
import { useImagePlacement } from '../state/useImagePlacement';
import { useFitZoom } from './useFitZoom';
import { parseCssTransform } from './transformGeometry';
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
import { isPersistentGroupSelection, selectionIdsForLayer } from './groupSelection';
import {
  captureStageZoomAnchor,
  clampStageZoom,
  nextStageZoom,
  scrollForStageZoom,
  stageViewShortcut,
  stageZoomDirectionForWheel,
  type StageZoomAnchor,
} from './stageZoom';
import { ViewportFooter } from './ViewportFooter';
import { nextOgrafStepFrame } from './ografStepPlayback';
import { ShaderPreviewClock } from './shaderPreviewClock';
import { StageLoopPreviewClock } from './stageLoopPreviewClock';
import { isInteractiveShortcutTarget } from '../state/keyboardShortcuts';
import { duplicateLayerSelection } from '../state/editorShortcuts';
import { inlineTextEditTarget } from './inlineTextEditing';
import { measureAutoSizedText } from '../panels/textAutoSize';
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
  const pathLayerId = usePathEditStore((s) => s.layerId);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const pathFrame = useTimelineStore((s) => (pathLayerId ? s.currentFrame : 0));
  const imagePlacement = useImagePlacement();
  const [draggingImages, setDraggingImages] = useState(false);
  const [inlineTextEditingLayerId, setInlineTextEditingLayerId] = useState<string | null>(null);
  const [inlineTextCaretPoint, setInlineTextCaretPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [inlineTextPreview, setInlineTextPreview] = useState<{
    layerId: string;
    transform: Partial<LayerTransform>;
  } | null>(null);
  const composition = useActiveComposition();
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
      clock: new ShaderPreviewClock(
        (useTimelineStore.getState().currentFrame / composition.frameRate) * 1000,
      ),
      loopClock: new StageLoopPreviewClock(),
    };
  }
  const shaderPreviewClock = shaderClockRef.current.clock;
  const loopPreviewClock = shaderClockRef.current.loopClock;
  const previewLoopLayerId = useTimelineStore((state) => state.previewLoopLayerId);
  const updateLayerTransform = useProjectStore((s) => s.updateLayerTransform);
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const removeLayerKeyframe = useProjectStore((s) => s.removeLayerKeyframe);
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
          Math.round(useTimelineStore.getState().currentFrame),
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
  // Bumped by Fit so the frame recentres even when the zoom level itself does not change.
  const [viewResetCount, setViewResetCount] = useState(0);
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

  const requestStageZoomTo = useCallback(
    (targetZoom: number, client?: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const currentZoom = zoomRef.current;
      const nextZoom = clampStageZoom(targetZoom);
      if (nextZoom === currentZoom) return;
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
    },
    [],
  );

  const requestStageZoom = useCallback(
    (direction: 'in' | 'out', client?: { x: number; y: number }) =>
      requestStageZoomTo(nextStageZoom(zoomRef.current, direction), client),
    [requestStageZoomTo],
  );

  const fitStageView = useCallback(() => {
    pendingZoomAnchorRef.current = null;
    setManualZoom(null);
    setViewResetCount((count) => count + 1);
  }, []);

  useEffect(() => {
    setManualZoom(null);
  }, [composition.height, composition.id, composition.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      const direction = stageZoomDirectionForWheel(event.deltaY);
      if (!direction) return;
      event.preventDefault();
      requestStageZoom(direction, { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [requestStageZoom]);

  const layerRefs = useRef(new Map<string, HTMLDivElement>());
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

  // The version is intentionally read to make ref attachment/removal trigger fresh target lookup.
  void targetVersion;
  const selectedGroups = new Set(
    composition.layers
      .filter((layer) => selectedLayerIds.includes(layer.id) && layer.groupId)
      .map((layer) => layer.groupId),
  );
  const interactionLayerIds = [
    ...new Set([
      ...selectedLayerIds,
      ...composition.layers
        .filter((layer) => layer.groupId && selectedGroups.has(layer.groupId))
        .map((layer) => layer.id),
    ]),
  ];
  const isPersistentGroup = isPersistentGroupSelection(composition, interactionLayerIds);
  const targetEls = interactionLayerIds
    .filter(
      (layerId) => !composition.layers.find((candidate) => candidate.id === layerId)?.isLocked,
    )
    .map((layerId) => layerRefs.current.get(layerId))
    .filter((element): element is HTMLDivElement => element !== undefined);
  const targetEl = targetEls.length === 1 ? targetEls[0]! : null;
  const moveableTarget = targetEls.length > 1 ? targetEls : targetEl;
  const isGroupSelection = targetEls.length > 1;
  const selectedLayer = composition.layers.find((layer) => layer.id === selectedLayerId);
  const editingPath =
    selectedLayer?.id === pathLayerId &&
    selectedLayer.element.type === 'path' &&
    !selectedLayer.isLocked &&
    selectedLayerIds.length === 1 &&
    !isPlaying;
  useEffect(() => {
    if (pathLayerId && !editingPath) usePathEditStore.getState().stop();
  }, [pathLayerId, editingPath]);
  const selectedPose = selectedLayer
    ? getLayerTransformAtFrame(selectedLayer, useTimelineStore.getState().currentFrame)
    : null;
  const moveableTransformOrigin = selectedPose
    ? ([`${selectedPose.transformOriginX * 100}%`, `${selectedPose.transformOriginY * 100}%`] as [
        string,
        string,
      ])
    : undefined;

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
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget;
    viewport.setPointerCapture(event.pointerId);
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
    event.currentTarget.scrollLeft = scroll.left;
    event.currentTarget.scrollTop = scroll.top;
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
    recenterStageViewport(event.currentTarget);
  };

  const readTransformPatch = (
    target: HTMLElement | SVGElement,
    extra?: { width?: number; height?: number },
  ): Partial<LayerTransform> => {
    const { x, y, rotation } = parseCssTransform((target as HTMLElement).style.transform);
    return normalizeAuthoredTransformPatch({ x, y, rotation, ...extra });
  };

  const currentTranslate = (target: HTMLElement | SVGElement): [number, number] => {
    const { x, y } = parseCssTransform((target as HTMLElement).style.transform);
    return [x, y];
  };

  const applySnapping = (target: HTMLElement | SVGElement) => {
    const layerId = layerIdForTarget(target);
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    const parsed = parseCssTransform((target as HTMLElement).style.transform);
    const pose = getLayerTransformAtFrame(layer, useTimelineStore.getState().currentFrame);
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
        const other = getLayerTransformAtFrame(candidate, useTimelineStore.getState().currentFrame);
        verticalGuides.push(other.x, other.x + other.width / 2, other.x + other.width);
        horizontalGuides.push(other.y, other.y + other.height / 2, other.y + other.height);
      }
    }
    const snapped = snapLayerPosition(
      { x: parsed.x, y: parsed.y, width: pose.width, height: pose.height },
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
    (target as HTMLElement).style.transform =
      `translate(${snapped.x}px, ${snapped.y}px) rotate(${parsed.rotation}deg)`;
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
      (event.target as HTMLElement).style.transform =
        `translate(${next.x}px, ${next.y}px) rotate(${anchor.rotation}deg)`;
      constraint.lastTransforms.set(event.target, { ...next, rotation: anchor.rotation });
    }
  };

  const previewTransform = (
    target: HTMLElement | SVGElement,
    extra?: { width?: number; height?: number },
  ) => {
    if (selectedLayerId) setLiveTransform(selectedLayerId, readTransformPatch(target, extra));
  };

  const layerIdForTarget = (target: HTMLElement | SVGElement): string | undefined =>
    (target as HTMLElement).dataset.layerId;

  const commitTransform = (
    target: HTMLElement | SVGElement,
    extra?: { width?: number; height?: number },
  ) => {
    if (!selectedLayerId) return;
    updateLayerTransform(
      selectedLayerId,
      useTimelineStore.getState().currentFrame,
      readTransformPatch(target, extra),
    );
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
          useTimelineStore.getState().currentFrame,
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
      const viewShortcut = stageViewShortcut(e);
      if (viewShortcut) {
        e.preventDefault();
        if (viewShortcut === 'fit') fitStageView();
        else requestStageZoomTo(1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_'].includes(e.key)) {
        e.preventDefault();
        requestStageZoom(e.key === '+' || e.key === '=' ? 'in' : 'out');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId) {
        e.preventDefault();
        if (selectedLayerKeyframeId) {
          removeLayerKeyframe(selectedLayerId, selectedLayerKeyframeId);
          clearLayerKeyframe();
        } else {
          for (const layerId of selectedLayerIds) removeLayer(layerId);
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
    fitStageView,
    removeLayer,
    removeLayerKeyframe,
    requestStageZoom,
    requestStageZoomTo,
    select,
    selectedLayerId,
    selectedLayerIds,
    selectedLayerKeyframeId,
  ]);

  // Rebuilds the persistent master GSAP timeline whenever the composition changes (edits,
  // added/removed/retimed keyframes, ...), then registers an imperative seek/play/pause
  // controller that the Timeline panel drives — the panel has no DOM access of its own.
  // GSAP itself always works in seconds; frame <-> seconds conversion happens only at this
  // boundary, via the composition's frameRate, so the rest of the app can stay frame-based.
  const timelineRef = useRef<ReturnType<typeof buildMasterTimeline> | null>(null);
  useEffect(
    () =>
      useTimelineStore.subscribe((state, previous) => {
        // Direct agent/project frame changes are also seeks. Automatic Step arrival publishes its
        // final frame while playing, so it deliberately leaves the content clock running.
        if (!state.isPlaying && state.currentFrame !== previous.currentFrame) {
          shaderPreviewClock.seek((state.currentFrame / composition.frameRate) * 1000);
        }
      }),
    [composition.frameRate, shaderPreviewClock],
  );
  const maskTestValues = useTestDataStore((state) => state.values);
  useEffect(() => {
    const descriptor = compileDescriptor(composition, { includeGuides: true });
    const frame = useTimelineStore.getState().currentFrame;
    applyCompiledMasks(
      descriptor,
      layerRefs.current,
      new Map(
        descriptor.layers.map((layer) => [
          layer.id,
          sampleCompiledLayerVisualState(
            layer,
            frame,
            undefined,
            previewBindingData(composition.dataFields, useTestDataStore.getState().values),
          ),
        ]),
      ),
    );
  }, [composition, maskTestValues]);
  useEffect(() => {
    const frameRate = composition.frameRate;
    const durationFrames = getTotalFrames(composition);
    const wasPlaying = useTimelineStore.getState().isPlaying;
    const descriptor = compileDescriptor(composition, { includeGuides: true });
    const mediaCueHost = document.createElement('div');
    mediaCueHost.dataset.ografStudioMediaCues = 'true';
    mediaCueHost.style.display = 'none';
    document.body.appendChild(mediaCueHost);
    const mediaCueRuntime = new MediaCueRuntime(mediaCueHost, descriptor);

    timelineRef.current?.kill();
    const tl = buildMasterTimeline(composition, layerRefs.current);
    timelineRef.current = tl;

    setDurationFrames(durationFrames);

    // Resync to wherever the playhead currently is, so an unrelated edit (e.g. renaming a
    // layer) doesn't visually snap the canvas back to Keyframe 0.
    const currentFrame = useTimelineStore.getState().currentFrame;
    tl.seek(currentFrame / frameRate, true);

    tl.eventCallback('onUpdate', () => {
      const timelineTimeMs = tl.time() * 1000;
      setCurrentFrame(tl.time() * frameRate);
      if (useTimelineStore.getState().isPlaying) mediaCueRuntime.renderAtTime(timelineTimeMs);
    });
    tl.eventCallback('onComplete', () => {
      shaderPreviewClock.pause(performance.now());
      setPlaying(false);
    });

    let segmentTween: ReturnType<typeof tl.tweenTo> | null = null;
    const controller: TimelineController = {
      seek: (frame) => {
        segmentTween?.kill();
        segmentTween = null;
        tl.pause();
        setPlaying(false);
        mediaCueRuntime.reset();
        tl.seek(Math.max(0, Math.min(durationFrames, frame)) / frameRate, true);
        setCurrentFrame(tl.time() * frameRate);
        shaderPreviewClock.seek(tl.time() * 1000);
      },
      play: () => {
        // GSAP remains at its completed position after reaching the end. A transport's Play
        // button is expected to start again, rather than appearing to do nothing.
        if (tl.time() >= tl.duration()) {
          mediaCueRuntime.reset();
          tl.seek(0, true);
          setCurrentFrame(0);
          shaderPreviewClock.seek(0);
        }
        mediaCueRuntime.resumeBlocked();
        mediaCueRuntime.renderAtTime(tl.time() * 1000);
        shaderPreviewClock.play(performance.now());
        setPlaying(true);
        const current = tl.time() * frameRate;
        const nextStep = useTimelineStore.getState().pauseAtOgrafSteps
          ? nextOgrafStepFrame(composition, current)
          : undefined;
        if (nextStep === undefined) {
          tl.play();
          return;
        }
        segmentTween?.kill();
        segmentTween = tl.tweenTo(nextStep / frameRate, {
          ease: 'none',
          onComplete: () => {
            segmentTween = null;
            tl.pause();
            tl.seek(nextStep / frameRate, true);
            setCurrentFrame(nextStep);
            setPlaying(false);
          },
        });
      },
      pause: () => {
        segmentTween?.kill();
        segmentTween = null;
        tl.pause();
        mediaCueRuntime.reset();
        shaderPreviewClock.pause(performance.now());
        setPlaying(false);
      },
      stop: () => {
        segmentTween?.kill();
        segmentTween = null;
        tl.pause();
        mediaCueRuntime.reset();
        tl.seek(0, true);
        setCurrentFrame(0);
        shaderPreviewClock.seek(0);
        setPlaying(false);
      },
    };
    setController(controller);

    if (wasPlaying) {
      controller.play();
    }

    return () => {
      segmentTween?.kill();
      tl.kill();
      mediaCueRuntime.dispose();
      if (useTimelineStore.getState().controller === controller) setController(null);
    };
  }, [
    composition,
    setController,
    setCurrentFrame,
    setDurationFrames,
    setPlaying,
    shaderPreviewClock,
  ]);

  // Normal Timeline playback uses the compiled runtime sampler for every active local loop, not
  // only the manually previewed layer. This keeps ticker crawls, pulses, and other ambient motion
  // aligned with exported playout while preserving the editable Stage DOM and visible Timeline.
  useEffect(() => {
    const descriptor = compileDescriptor(composition, { includeGuides: true });
    const loopLayers = descriptor.layers.filter(
      (layer) =>
        layer.loop ||
        layer.lighting ||
        layer.element.type === 'pattern' ||
        layer.layoutParentId ||
        layer.autoLayout?.direction !== 'none' ||
        layer.motionPath,
    );
    if (loopLayers.length === 0) return;
    const previewTimeline = timelineRef.current;
    const previewMoveable = moveableRef.current;
    const previewLightingPattern = descriptor.layers.find(
      (layer) => layer.id === previewLoopLayerId,
    )?.lighting?.patternId;
    const epoch = performance.now();
    let animationFrame = 0;
    const render = (now: number) => {
      const baseFrame = (previewTimeline?.time() ?? 0) * descriptor.frameRate;
      const timelineIsPlaying = useTimelineStore.getState().isPlaying;
      const contentTimeMs = shaderPreviewClock.sample(now);
      const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
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
        const state = sampleCompiledLayerVisualState(
          layer,
          baseFrame,
          elapsed,
          previewBindingData(composition.dataFields, useTestDataStore.getState().values),
        );
        states.set(layer.id, state);
      }
      applyCompiledAutoLayout(
        descriptor,
        states,
        previewBindingData(composition.dataFields, useTestDataStore.getState().values),
        layerRefs.current,
      );
      applyCompiledMotionPaths(descriptor, states);
      for (const layer of descriptor.layers) {
        const state = states.get(layer.id);
        const element = layerRefs.current.get(layer.id);
        if (element && state) applyCompiledLayerVisualState(element, state, contentTimeMs);
      }
      applyCompiledClipPaths(descriptor, layerRefs.current, states);
      applyCompiledMasks(descriptor, layerRefs.current, states);
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
    const unsubscribeClock = shaderPreviewClock.subscribe(sync);
    sync();
    return () => {
      unsubscribeClock();
      cancelAnimationFrame(animationFrame);
      const frame = useTimelineStore.getState().currentFrame;
      previewTimeline?.seek(frame / composition.frameRate, true);
      previewMoveable?.updateTarget();
    };
  }, [
    composition,
    isPlaying,
    previewLoopLayerId,
    selectedLayerIds,
    shaderPreviewClock,
    loopPreviewClock,
    maskTestValues,
  ]);

  // The timeline effect above normalizes percentage transform origins back to pixel values. Its DOM
  // work must finish before Moveable measures the committed target, particularly after north/west
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
  }, [
    applyStageOrigin,
    pasteboard,
    recenterStageViewport,
    syncStageCameraCss,
    viewResetCount,
    zoom,
  ]);

  useLayoutEffect(() => {
    // updateTarget (rather than updateRect) refreshes transform-origin as well as the outer bounds.
    if (moveableTarget) moveableRef.current?.updateTarget();
  }, [composition, moveableTarget, zoom]);

  useEffect(() => {
    if (!moveableTarget) return;

    // GSAP writes evaluated poses directly to layer DOM nodes, so Stage intentionally does not
    // React-render every layer on every playback tick. Keep Moveable on that same imperative path:
    // a seek/step/scrub has already updated the target before setCurrentFrame publishes the new
    // playhead value, and updateTarget remeasures both its bounds and transform origin before paint.
    let previousFrame = useTimelineStore.getState().currentFrame;
    return useTimelineStore.subscribe((state) => {
      if (state.currentFrame === previousFrame) return;
      previousFrame = state.currentFrame;
      moveableRef.current?.updateTarget();
    });
  }, [moveableTarget]);

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
      <div className="canvas-stage-workspace" ref={workspaceRef}>
        {(draggingImages || imagePlacement.busy) && (
          <div className="image-placement-banner" role="status">
            {imagePlacement.busy ? 'Opening images…' : 'Drop images to add them here'}
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
          title="Mouse wheel or Ctrl/Command+plus/minus to zoom; Shift+1 to fit; middle-drag to pan"
          tabIndex={0}
          style={transparencyCheckerboardStyle(1)}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = imagePlacement.busy ? 'none' : 'copy';
              setDraggingImages(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDraggingImages(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDraggingImages(false);
            const files = [...event.dataTransfer.files];
            const bounds = pasteboardRef.current?.getBoundingClientRect();
            if (files.length && bounds)
              void imagePlacement.place(files, {
                position: {
                  x: (event.clientX - bounds.left) / zoom,
                  y: (event.clientY - bounds.top) / zoom,
                },
              });
          }}
          onPointerDownCapture={beginViewportPan}
          onDoubleClickCapture={(event) => {
            if (isPlaying || editingPath) return;
            const layer = [...composition.layers].reverse().find((candidate) => {
              if (!inlineTextEditTarget(candidate, composition.dataFields)) return false;
              const element = layerRefs.current.get(candidate.id);
              if (!element) return false;
              const bounds = element.getBoundingClientRect();
              return (
                event.clientX >= bounds.left &&
                event.clientX <= bounds.right &&
                event.clientY >= bounds.top &&
                event.clientY <= bounds.bottom
              );
            });
            if (!layer) return;
            event.preventDefault();
            event.stopPropagation();
            selectMany(selectionIdsForLayer(composition, layer.id));
            setInlineTextEditingLayerId(layer.id);
            setInlineTextCaretPoint({ x: event.clientX, y: event.clientY });
          }}
          onPointerMoveCapture={updateViewportPan}
          onPointerUpCapture={endViewportPan}
          onPointerCancelCapture={endViewportPan}
          onLostPointerCapture={(event) => {
            if (panGestureRef.current?.pointerId === event.pointerId) {
              panGestureRef.current = null;
              setIsPanning(false);
              recenterStageViewport(event.currentTarget);
            }
          }}
          onAuxClick={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          onMouseDown={(event) => {
            if (event.button !== 0 || editingPath) return;
            const target = event.target as HTMLElement;
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
              <CanvasPresentationBackground composition={composition} />
              <div
                className="canvas-stage-frame"
                style={{
                  left: 0,
                  top: 0,
                  width: composition.width,
                  height: composition.height,
                  backgroundColor: composition.backgroundColor,
                  isolation: 'isolate',
                  overflow: composition.layout.overflowPreview,
                }}
                onMouseDown={(e) => {
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
                {composition.layers.map((layer) => {
                  const frame = useTimelineStore.getState().currentFrame;
                  const authoredPose = getLayerTransformAtFrame(layer, frame);
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
                        getLayerTransformAtFrame(parent, frame),
                        parent.element.type === 'rectangle' ? parent.element.borderRadius : 0,
                      )
                    : undefined;
                  return (
                    <LayerNode
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
                        !isPlaying && interactionLayerIds.includes(layer.id) && !isPersistentGroup
                      }
                      onSelect={(additive) => {
                        const selectionIds = selectionIdsForLayer(composition, layer.id);
                        if (additive) {
                          toggleManyLayerSelection(selectionIds);
                        } else if (!selectedLayerIds.includes(layer.id)) {
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
                      allowInlineTextEditing={!isPlaying && !editingPath}
                      editingInlineText={inlineTextEditingLayerId === layer.id}
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
                <CanvasLayoutOverlay composition={composition} zoom={zoom} />
              </div>
            </div>
            <div
              className="canvas-stage-border"
              aria-hidden="true"
              style={{ width: composition.width * zoom, height: composition.height * zoom }}
            />
          </div>
          {moveableTarget && !isPlaying && !editingPath && !inlineTextEditingLayerId && (
            <Moveable
              key={isGroupSelection ? 'group-selection' : 'single-selection'}
              ref={moveableRef}
              target={moveableTarget}
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
                // Keep authored relative origins relative while the box changes size. GSAP normalizes
                // them to pixels for playback, which would otherwise freeze the visible center.
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
      </div>
      <ViewportFooter
        zoom={zoom}
        onZoomIn={() => requestStageZoom('in')}
        onZoomOut={() => requestStageZoom('out')}
        onZoomTo={requestStageZoomTo}
        onFit={fitStageView}
      />
      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          ariaLabel="Object actions"
          onClose={() => setObjectMenu(null)}
          items={[
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
