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
} from '@ograf-editor/scene-model';
import { ContextMenu } from '../components/ContextMenu';
import { useLayerClipboardStore } from '../state/layerClipboardStore';
import { buildMasterTimeline } from './masterTimeline';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  applyCompiledClipPaths,
  applyCompiledLayerVisualState,
  sampleCompiledLayerVisualState,
} from '@ograf-editor/ograf-runtime';
import { LayerNode } from './LayerNode';
import { AddElementToolbar } from './AddElementToolbar';
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
  nextStageZoom,
  scrollForStageZoom,
  stageZoomDirectionForWheel,
  type StageZoomAnchor,
} from './stageZoom';
import { nextOgrafStepFrame } from './ografStepPlayback';
import { isInteractiveShortcutTarget } from '../state/keyboardShortcuts';
import './Stage.css';

export function Stage({
  style,
  onEnterOgrafPreview,
}: {
  style?: CSSProperties;
  onEnterOgrafPreview?: () => void;
}) {
  const composition = useActiveComposition();
  const previewLoopLayerId = useTimelineStore((state) => state.previewLoopLayerId);
  const updateLayerTransform = useProjectStore((s) => s.updateLayerTransform);
  const pasteLayers = useProjectStore((s) => s.pasteLayers);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const removeLayerKeyframe = useProjectStore((s) => s.removeLayerKeyframe);
  const groupLayers = useProjectStore((s) => s.groupLayers);
  const ungroupLayers = useProjectStore((s) => s.ungroupLayers);
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectedLayerKeyframeId = useSelectionStore((s) => s.selectedLayerKeyframeId);
  const select = useSelectionStore((s) => s.select);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const toggleManyLayerSelection = useSelectionStore((s) => s.toggleManyLayerSelection);
  const clearLayerKeyframe = useSelectionStore((s) => s.clearLayerKeyframe);
  const setLiveTransform = useSelectionStore((s) => s.setLiveTransform);
  const clearLiveTransform = useSelectionStore((s) => s.clearLiveTransform);
  const clipboardLayers = useLayerClipboardStore((s) => s.layers);
  const copyLayers = useLayerClipboardStore((s) => s.copy);

  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const setPlaying = useTimelineStore((s) => s.setPlaying);
  const setDurationFrames = useTimelineStore((s) => s.setDurationFrames);
  const setController = useTimelineStore((s) => s.setController);

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

  const requestStageZoom = useCallback(
    (direction: 'in' | 'out', client?: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const currentZoom = zoomRef.current;
      const nextZoom = nextStageZoom(currentZoom, direction);
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
  const selectedPose = selectedLayer
    ? getLayerTransformAtFrame(selectedLayer, useTimelineStore.getState().currentFrame)
    : null;
  const moveableTransformOrigin = selectedPose
    ? ([`${selectedPose.transformOriginX * 100}%`, `${selectedPose.transformOriginY * 100}%`] as [
        string,
        string,
      ])
    : undefined;

  const snapshotLayers = (layerIds: string[]): Layer[] => {
    const wanted = new Set(layerIds);
    return composition.layers
      .filter((layer) => wanted.has(layer.id))
      .map((layer) => structuredClone(layer));
  };

  const copyLayerIds = (layerIds: string[]) => {
    copyLayers(snapshotLayers(layerIds));
  };

  const deleteLayerIds = (layerIds: string[]) => {
    for (const layerId of layerIds) removeLayer(layerId);
    select(null);
  };

  const pasteClipboardLayers = () => {
    if (clipboardLayers.length === 0) return;
    selectMany(pasteLayers(clipboardLayers));
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
      if (e.key === 'Shift') shiftPressedRef.current = true;
      if (isInteractiveShortcutTarget(e.target)) return;
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
    removeLayer,
    removeLayerKeyframe,
    requestStageZoom,
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
  useEffect(() => {
    const frameRate = composition.frameRate;
    const durationFrames = getTotalFrames(composition);
    const wasPlaying = useTimelineStore.getState().isPlaying;

    timelineRef.current?.kill();
    const tl = buildMasterTimeline(composition, layerRefs.current);
    timelineRef.current = tl;

    setDurationFrames(durationFrames);

    // Resync to wherever the playhead currently is, so an unrelated edit (e.g. renaming a
    // layer) doesn't visually snap the canvas back to Keyframe 0.
    const currentFrame = useTimelineStore.getState().currentFrame;
    tl.seek(currentFrame / frameRate, true);

    tl.eventCallback('onUpdate', () => setCurrentFrame(tl.time() * frameRate));
    tl.eventCallback('onComplete', () => {
      setPlaying(false);
    });

    let segmentTween: ReturnType<typeof tl.tweenTo> | null = null;
    const controller: TimelineController = {
      seek: (frame) => {
        segmentTween?.kill();
        segmentTween = null;
        tl.pause();
        setPlaying(false);
        tl.seek(Math.max(0, Math.min(durationFrames, frame)) / frameRate, true);
        setCurrentFrame(tl.time() * frameRate);
      },
      play: () => {
        // GSAP remains at its completed position after reaching the end. A transport's Play
        // button is expected to start again, rather than appearing to do nothing.
        if (tl.time() >= tl.duration()) {
          tl.seek(0, true);
          setCurrentFrame(0);
        }
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
        setPlaying(false);
      },
      stop: () => {
        segmentTween?.kill();
        segmentTween = null;
        tl.pause();
        tl.seek(0, true);
        setCurrentFrame(0);
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
    };
  }, [composition, setController, setCurrentFrame, setDurationFrames, setPlaying]);

  // Loop clips have a local clock that must never be encoded as composition/lifecycle frames.
  // This editor-only preview samples that clock absolutely while leaving the shared playhead and
  // authored project untouched. Preview/export use the same compiled sampler below.
  useEffect(() => {
    if (!previewLoopLayerId) return;
    const descriptor = compileDescriptor(composition, { includeGuides: true });
    if (!descriptor.layers.find((layer) => layer.id === previewLoopLayerId)?.loop) return;
    const previewTimeline = timelineRef.current;
    const previewMoveable = moveableRef.current;
    const epoch = performance.now();
    let animationFrame = 0;
    const render = (now: number) => {
      const baseFrame = (previewTimeline?.time() ?? 0) * descriptor.frameRate;
      const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
      for (const layer of descriptor.layers) {
        const elapsed =
          layer.id === previewLoopLayerId
            ? ((now - epoch) / 1000) * descriptor.frameRate
            : undefined;
        const state = sampleCompiledLayerVisualState(layer, baseFrame, elapsed);
        states.set(layer.id, state);
        const element = layerRefs.current.get(layer.id);
        if (element) applyCompiledLayerVisualState(element, state);
      }
      applyCompiledClipPaths(descriptor, layerRefs.current, states);
      if (selectedLayerIds.includes(previewLoopLayerId)) previewMoveable?.updateTarget();
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrame);
      const frame = useTimelineStore.getState().currentFrame;
      previewTimeline?.seek(frame / composition.frameRate, true);
      previewMoveable?.updateTarget();
    };
  }, [composition, previewLoopLayerId, selectedLayerIds]);

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
  }, [applyStageOrigin, pasteboard, recenterStageViewport, syncStageCameraCss, zoom]);

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
      <AddElementToolbar onEnterOgrafPreview={onEnterOgrafPreview} />
      <div className="canvas-stage-workspace" ref={workspaceRef}>
        <div
          className={`canvas-stage-viewport${isPanning ? ' is-panning' : ''}`}
          ref={viewportRef}
          data-ograf-zoom={zoom}
          aria-label={`Canvas viewport, ${Math.round(zoom * 100)}% zoom`}
          title="Mouse wheel or Ctrl/Command+plus/minus to zoom; middle-drag to pan"
          tabIndex={0}
          style={transparencyCheckerboardStyle(1)}
          onPointerDownCapture={beginViewportPan}
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
                  if (e.target === e.currentTarget) select(null);
                }}
              >
                {composition.layers.map((layer) => {
                  const frame = useTimelineStore.getState().currentFrame;
                  const pose = getLayerTransformAtFrame(layer, frame);
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
                      layer={layer}
                      pose={pose}
                      isSelected={interactionLayerIds.includes(layer.id) && !isPersistentGroup}
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
                    />
                  );
                })}
                <CanvasLayoutOverlay composition={composition} zoom={zoom} />
              </div>
            </div>
          </div>
          {moveableTarget && (
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
      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          ariaLabel="Object actions"
          onClose={() => setObjectMenu(null)}
          items={[
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
              onSelect: () => selectMany(pasteLayers(snapshotLayers(objectMenu.layerIds))),
            },
            ...(isPersistentGroupSelection(composition, objectMenu.layerIds)
              ? [
                  {
                    id: 'ungroup',
                    label: 'Ungroup',
                    separatorBefore: true,
                    onSelect: () => {
                      const primary = objectMenu.layerIds.at(-1) ?? null;
                      ungroupLayers(objectMenu.layerIds);
                      select(primary);
                    },
                  },
                ]
              : [
                  {
                    id: 'group',
                    label: 'Group',
                    separatorBefore: true,
                    disabled: objectMenu.layerIds.length < 2,
                    onSelect: () => {
                      if (groupLayers(objectMenu.layerIds)) selectMany(objectMenu.layerIds);
                    },
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
