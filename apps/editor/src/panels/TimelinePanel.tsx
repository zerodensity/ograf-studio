import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  animatablePropertyLabel,
  computeKeyframeFrames,
  createLayerPropertyKeyframe,
  findLayerKeyframeAtFrame,
  getLayerAnimatableProperties,
  getResolvedLayerAnimationTracks,
  getLayerPropertyValueAtFrame,
  getTrackValueAtFrame,
  type AnimatableLayerProperty,
  type EasingPreset,
} from '@ograf-editor/scene-model';
import { ContextMenu } from '../components/ContextMenu';
import { selectionIdsForLayer } from '../canvas/groupSelection';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTimelineStore } from '../state/timelineStore';
import { useSelectionStore } from '../state/selectionStore';
import { lifecycleRetimeBounds, MIN_LIFECYCLE_TRANSITION_FRAMES } from '../state/lifecycleRetime';
import { Panel } from './Panel';
import { formatFrameDuration } from './timelineFormatting';
import { FrameDurationControl } from './FrameDurationControl';
import { EASING_OPTION_GROUPS, easingLabel } from './easingOptions';
import { EasingCurveEditor } from './EasingCurveEditor';
import { buildTimelineEntries } from './timelineFolders';
import { buildTimelineLoopBadges } from './timelineLoopBadges';
import { isTimelineKeyDrag } from './timelinePointerIntent';
import './TimelinePanel.css';

const DEFAULT_PX_PER_FRAME = 12;
const MIN_PX_PER_FRAME = 4;
const MAX_PX_PER_FRAME = 32;
const PX_PER_FRAME_STEP = 2;
const MIN_CONTENT_FRAMES = 60;
const CONTENT_PADDING_PX = 80;
const MIN_TRANSITION_FRAMES = MIN_LIFECYCLE_TRANSITION_FRAMES;

type LayerColorStyle = CSSProperties & { '--layer-color': string };

type TransportIconName = 'previous' | 'play' | 'pause' | 'stop' | 'next';

function TransportIcon({ name }: { name: TransportIconName }) {
  return (
    <svg className="timeline-transport-icon" viewBox="0 0 16 16" aria-hidden="true">
      {name === 'previous' && (
        <>
          <path d="M3 2.5v11" />
          <path d="m12.5 3-7 5 7 5z" className="filled" />
        </>
      )}
      {name === 'play' && <path d="m4 2.5 9 5.5-9 5.5z" className="filled" />}
      {name === 'pause' && (
        <>
          <rect x="3" y="2.5" width="3.5" height="11" rx="0.7" className="filled" />
          <rect x="9.5" y="2.5" width="3.5" height="11" rx="0.7" className="filled" />
        </>
      )}
      {name === 'stop' && <rect x="3" y="3" width="10" height="10" rx="0.8" className="filled" />}
      {name === 'next' && (
        <>
          <path d="M13 2.5v11" />
          <path d="m3.5 3 7 5-7 5z" className="filled" />
        </>
      )}
    </svg>
  );
}

function timelineColorForLayer(layerId: string): string {
  let hash = 0;
  for (const character of layerId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 78% 62%)`;
}

export function TimelinePanel({ style }: { style?: CSSProperties }) {
  const composition = useActiveComposition();
  const activeKeyframeId = useProjectStore((s) => s.activeKeyframeId);
  const setActiveKeyframe = useProjectStore((s) => s.setActiveKeyframe);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const removeKeyframe = useProjectStore((s) => s.removeKeyframe);
  const renameKeyframe = useProjectStore((s) => s.renameKeyframe);
  const updateTransition = useProjectStore((s) => s.updateTransition);
  const moveLifecycleKeyframe = useProjectStore((s) => s.moveLifecycleKeyframe);
  const addLayerKeyframe = useProjectStore((s) => s.addLayerKeyframe);
  const addLayerHoldFrame = useProjectStore((s) => s.addLayerHoldFrame);
  const moveLayerKeyframe = useProjectStore((s) => s.moveLayerKeyframe);
  const removeLayerKeyframe = useProjectStore((s) => s.removeLayerKeyframe);
  const updateLayerKeyframeEasing = useProjectStore((s) => s.updateLayerKeyframeEasing);
  const addLayerPropertyKeyframe = useProjectStore((s) => s.addLayerPropertyKeyframe);
  const moveLayerPropertyKeyframe = useProjectStore((s) => s.moveLayerPropertyKeyframe);
  const removeLayerPropertyKeyframe = useProjectStore((s) => s.removeLayerPropertyKeyframe);
  const updateLayerPropertyKeyframeEasing = useProjectStore(
    (s) => s.updateLayerPropertyKeyframeEasing,
  );
  const updateLayerPropertyKeyframeCurve = useProjectStore(
    (s) => s.updateLayerPropertyKeyframeCurve,
  );
  const offsetLayerPropertyTrack = useProjectStore((s) => s.offsetLayerPropertyTrack);
  const scaleLayerPropertyTrack = useProjectStore((s) => s.scaleLayerPropertyTrack);
  const reverseLayerPropertyTrack = useProjectStore((s) => s.reverseLayerPropertyTrack);
  const distributeLayerPropertyTrack = useProjectStore((s) => s.distributeLayerPropertyTrack);
  const createTimelineFolder = useProjectStore((s) => s.createTimelineFolder);
  const renameTimelineFolder = useProjectStore((s) => s.renameTimelineFolder);
  const setTimelineFolderColor = useProjectStore((s) => s.setTimelineFolderColor);
  const removeTimelineFolder = useProjectStore((s) => s.removeTimelineFolder);
  const setLayerLoop = useProjectStore((s) => s.setLayerLoop);
  const setLayerLoopPropertyTrack = useProjectStore((s) => s.setLayerLoopPropertyTrack);
  const removeLayerLoop = useProjectStore((s) => s.removeLayerLoop);

  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectedLayerKeyframeId = useSelectionStore((s) => s.selectedLayerKeyframeId);
  const selectedLayerProperty = useSelectionStore((s) => s.selectedLayerProperty);
  const selectLayer = useSelectionStore((s) => s.select);
  const selectManyLayers = useSelectionStore((s) => s.selectMany);
  const toggleManyLayerSelection = useSelectionStore((s) => s.toggleManyLayerSelection);
  const selectLayerKeyframe = useSelectionStore((s) => s.selectLayerKeyframe);
  const clearLayerKeyframe = useSelectionStore((s) => s.clearLayerKeyframe);

  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const pauseAtOgrafSteps = useTimelineStore((s) => s.pauseAtOgrafSteps);
  const setPauseAtOgrafSteps = useTimelineStore((s) => s.setPauseAtOgrafSteps);
  const durationFrames = useTimelineStore((s) => s.durationFrames);
  const controller = useTimelineStore((s) => s.controller);
  const previewLoopLayerId = useTimelineStore((s) => s.previewLoopLayerId);
  const setPreviewLoopLayerId = useTimelineStore((s) => s.setPreviewLoopLayerId);
  const displayedFrame = Math.max(0, Math.min(durationFrames, Math.round(currentFrame)));
  const duration = formatFrameDuration(durationFrames, composition.frameRate);

  const [pixelsPerFrame, setPixelsPerFrame] = useState(DEFAULT_PX_PER_FRAME);
  const [trackScalePercent, setTrackScalePercent] = useState(100);
  const [expandedLayerIds, setExpandedLayerIds] = useState<Set<string>>(() => new Set());
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [lifecycleDragPreview, setLifecycleDragPreview] = useState<{
    keyframeId: string;
    frame: number;
  } | null>(null);
  const [lifecycleRetimeNotice, setLifecycleRetimeNotice] = useState<{
    message: string;
    warnings: string[];
  } | null>(null);
  const rulerLabelInterval = pixelsPerFrame >= 10 ? 5 : pixelsPerFrame >= 6 ? 10 : 20;

  const keyframeFrames = computeKeyframeFrames(composition);
  const loopBadges = buildTimelineLoopBadges(composition);
  const loopBadgeByLayerId = new Map(loopBadges.map((badge) => [badge.layerId, badge]));
  const displayedKeyframeFrames = keyframeFrames.map((item) =>
    item.keyframeId === lifecycleDragPreview?.keyframeId
      ? { ...item, frame: lifecycleDragPreview.frame }
      : item,
  );
  const previewDurationFrames = Math.max(
    durationFrames,
    displayedKeyframeFrames.at(-1)?.frame ?? 0,
  );
  const contentWidth =
    Math.max(previewDurationFrames, MIN_CONTENT_FRAMES) * pixelsPerFrame + CONTENT_PADDING_PX;
  const rulerFrames = Math.max(previewDurationFrames, MIN_CONTENT_FRAMES);
  const rulerTicks = Array.from(
    { length: Math.floor(rulerFrames / rulerLabelInterval) + 1 },
    (_, index) => index * rulerLabelInterval,
  );

  // Displayed top-to-bottom, matching the Layers panel's z-order convention (topmost first).
  const layers = [...composition.layers].reverse();
  const timelineEntries = buildTimelineEntries(
    layers,
    composition.layout.timelineFolders,
    collapsedFolderIds,
  );
  const folderLayerIds = new Set(
    composition.layout.timelineFolders.flatMap((folder) => folder.layerIds),
  );

  const [editingKeyframeId, setEditingKeyframeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [frameMenu, setFrameMenu] = useState<{
    x: number;
    y: number;
    layerId: string;
    frame: number;
    property?: AnimatableLayerProperty;
  } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folderId: string } | null>(
    null,
  );
  const [layerMenu, setLayerMenu] = useState<{
    x: number;
    y: number;
    layerIds: string[];
  } | null>(null);

  const gutterRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const activeKeyframeIndex = composition.keyframes.findIndex((k) => k.id === activeKeyframeId);
  const activeKeyframe = composition.keyframes[activeKeyframeIndex];
  const incomingTransition =
    activeKeyframeIndex > 0
      ? composition.transitions.find(
          (t) =>
            t.fromKeyframeId === composition.keyframes[activeKeyframeIndex - 1]!.id &&
            t.toKeyframeId === activeKeyframeId,
        )
      : undefined;
  const selectedLayer = composition.layers.find((layer) => layer.id === selectedLayerId);
  const selectedLayerKeyframe = selectedLayer?.keyframes.find(
    (keyframe) => keyframe.id === selectedLayerKeyframeId,
  );
  const selectedPropertyKeyframe =
    selectedLayer && selectedLayerProperty
      ? getResolvedLayerAnimationTracks(selectedLayer)[selectedLayerProperty]?.find(
          (keyframe) => keyframe.id === selectedLayerKeyframeId,
        )
      : undefined;
  const selectedLoopTrack =
    selectedLayer && selectedLayerProperty
      ? (selectedLayer.loop?.tracks[selectedLayerProperty] ?? [])
      : [];
  const showKeyEditor = Boolean(
    selectedLayer && (selectedPropertyKeyframe || selectedLayerKeyframe || selectedLayerProperty),
  );

  useEffect(() => {
    if (
      previewLoopLayerId &&
      !composition.layers.some((layer) => layer.id === previewLoopLayerId)
    ) {
      setPreviewLoopLayerId(null);
    }
  }, [composition.layers, previewLoopLayerId, setPreviewLoopLayerId]);

  useEffect(() => {
    if (!lifecycleRetimeNotice) return;
    const timeout = window.setTimeout(
      () => setLifecycleRetimeNotice(null),
      lifecycleRetimeNotice.warnings.length > 0 ? 6000 : 3500,
    );
    return () => window.clearTimeout(timeout);
  }, [lifecycleRetimeNotice]);

  const createLoopForSelectedProperty = () => {
    if (!selectedLayer || !selectedLayerProperty) return;
    const duration = Math.max(2, Math.round(composition.frameRate));
    const stepFrame =
      keyframeFrames.find((item) => item.keyframeId === activeKeyframeId)?.frame ?? displayedFrame;
    const value = getLayerPropertyValueAtFrame(selectedLayer, selectedLayerProperty, stepFrame);
    setLayerLoop(selectedLayer.id, { durationFrames: duration, activation: { type: 'lifecycle' } });
    setLayerLoopPropertyTrack(selectedLayer.id, selectedLayerProperty, [
      createLayerPropertyKeyframe(0, value, { easing: 'linear' }),
      createLayerPropertyKeyframe(Math.round(duration / 2), value, { easing: 'sine-in-out' }),
      createLayerPropertyKeyframe(duration, value, { easing: 'sine-in-out' }),
    ]);
    setPreviewLoopLayerId(selectedLayer.id);
  };

  const updateSelectedLoopTrack = (keys: typeof selectedLoopTrack) => {
    if (selectedLayer && selectedLayerProperty) {
      setLayerLoopPropertyTrack(selectedLayer.id, selectedLayerProperty, keys);
    }
  };

  const toggleLayerExpanded = (layerId: string) => {
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const beginFolderRename = (folderId: string, name: string) => {
    setEditingFolderId(folderId);
    setEditingFolderName(name);
  };

  const commitFolderRename = () => {
    if (editingFolderId && editingFolderName.trim()) {
      renameTimelineFolder(editingFolderId, editingFolderName);
    }
    setEditingFolderId(null);
  };

  const createSelectedTimelineGroup = (layerIds: string[]) => {
    const folderId = createTimelineFolder(layerIds);
    const folder = useProjectStore
      .getState()
      .project.compositions.find((candidate) => candidate.id === composition.id)
      ?.layout.timelineFolders.find((candidate) => candidate.id === folderId);
    if (folder) beginFolderRename(folder.id, folder.name);
  };

  const ungroupSelectedTimelineGroups = (layerIds: string[]) => {
    const groupIds = composition.layout.timelineFolders
      .filter((group) => group.layerIds.some((layerId) => layerIds.includes(layerId)))
      .map((group) => group.id);
    for (const groupId of groupIds) removeTimelineFolder(groupId);
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      for (const groupId of groupIds) next.delete(groupId);
      return next;
    });
  };

  const handleLayerContextMenu = (event: ReactMouseEvent<HTMLDivElement>, layerId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const layerIds = selectedLayerIds.includes(layerId) ? selectedLayerIds : [layerId];
    if (!selectedLayerIds.includes(layerId)) selectManyLayers([layerId]);
    setLayerMenu({ x: event.clientX, y: event.clientY, layerIds });
  };

  const frameFromClientX = (clientX: number): number => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(
      0,
      Math.min(durationFrames, Math.round((clientX - rect.left) / pixelsPerFrame)),
    );
  };

  const handleScrubPointerDown = (e: ReactPointerEvent, clearKeySelection = true) => {
    if (e.button !== 0 || !controller) return;
    e.preventDefault();
    e.stopPropagation();
    if (clearKeySelection) clearLayerKeyframe();
    setIsScrubbing(true);
    controller.seek(frameFromClientX(e.clientX));

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      useTimelineStore.getState().controller?.seek(frameFromClientX(ev.clientX));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      useTimelineStore.getState().controller?.seek(frameFromClientX(ev.clientX));
      setIsScrubbing(false);
    };
    const onCancel = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setIsScrubbing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const commitLifecycleMove = (keyframeId: string, targetFrame: number) => {
    const keyframe = composition.keyframes.find((candidate) => candidate.id === keyframeId);
    const result = moveLifecycleKeyframe(keyframeId, targetFrame);
    if (!result) return;
    setActiveKeyframe(keyframeId);
    setLifecycleRetimeNotice({
      message: `${keyframe?.name ?? 'Lifecycle marker'} moved from frame ${result.currentFrame} to ${result.targetFrame}.`,
      warnings: result.warnings,
    });
    // Stage rebuilds the runtime timeline after the single committed project edit and preserves
    // this absolute playhead position, avoiding a rebuild on every pointer movement.
    useTimelineStore.getState().controller?.seek(result.targetFrame);
  };

  const handleKeyframeMarkerPointerDown = (e: ReactPointerEvent, keyframeIndex: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const keyframe = composition.keyframes[keyframeIndex]!;
    setActiveKeyframe(keyframe.id);
    if (keyframeIndex === 0) return;

    const bounds = lifecycleRetimeBounds(composition, keyframe.id);
    if (!bounds) return;
    const startX = e.clientX;
    const playheadBeforeDrag = useTimelineStore.getState().currentFrame;
    let isDragging = false;
    let previewFrame = bounds.currentFrame;
    const pointerTarget = e.currentTarget as HTMLElement;
    pointerTarget.setPointerCapture?.(e.pointerId);

    const previewAtClientX = (clientX: number) => {
      const requestedFrame = bounds.currentFrame + Math.round((clientX - startX) / pixelsPerFrame);
      previewFrame = Math.max(
        bounds.minFrame,
        bounds.maxFrame === null ? requestedFrame : Math.min(bounds.maxFrame, requestedFrame),
      );
      setLifecycleDragPreview({ keyframeId: keyframe.id, frame: previewFrame });
      useTimelineStore.getState().controller?.seek(previewFrame);
    };
    const beginDrag = () => {
      if (isDragging) return;
      isDragging = true;
      setLifecycleRetimeNotice(null);
      setLifecycleDragPreview({ keyframeId: keyframe.id, frame: previewFrame });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      if (pointerTarget.hasPointerCapture?.(e.pointerId)) {
        pointerTarget.releasePointerCapture(e.pointerId);
      }
      setLifecycleDragPreview(null);
    };
    const onMove = (event: PointerEvent) => {
      if (!isDragging && !isTimelineKeyDrag(startX, event.clientX)) return;
      event.preventDefault();
      beginDrag();
      previewAtClientX(event.clientX);
    };
    const onUp = (event: PointerEvent) => {
      if (!isDragging) {
        cleanup();
        return;
      }
      previewAtClientX(event.clientX);
      cleanup();
      commitLifecycleMove(keyframe.id, previewFrame);
    };
    const onCancel = () => {
      cleanup();
      if (isDragging) useTimelineStore.getState().controller?.seek(playheadBeforeDrag);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
  };

  const commitRename = () => {
    if (editingKeyframeId && editingName.trim()) {
      renameKeyframe(editingKeyframeId, editingName.trim());
    }
    setEditingKeyframeId(null);
  };

  const handleAddKeyframe = () => {
    // addKeyframe() already sets activeKeyframeId to the new keyframe internally, which is what
    // drives the effect above — no direct seek here (see its comment for why that would race).
    addKeyframe();
  };

  const handleAddLayerKeyframe = () => {
    if (!selectedLayerId || selectedLayer?.isLocked) return;
    const frame = Math.round(currentFrame);
    const keyframeId = addLayerKeyframe(selectedLayerId, frame);
    selectLayerKeyframe(selectedLayerId, keyframeId);
    controller?.seek(frame);
  };

  const seekByFrame = (delta: -1 | 1) => {
    controller?.seek(Math.max(0, Math.min(durationFrames, displayedFrame + delta)));
  };

  const handleLayerKeyframePointerDown = (
    e: ReactPointerEvent,
    layerId: string,
    keyframeId: string,
    startFrame: number,
    property: AnimatableLayerProperty | null = null,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectLayerKeyframe(layerId, keyframeId, property);
    if (composition.layers.find((layer) => layer.id === layerId)?.isLocked) return;
    const startX = e.clientX;
    let isDragging = false;
    const onMove = (event: PointerEvent) => {
      if (!isDragging && !isTimelineKeyDrag(startX, event.clientX)) return;
      isDragging = true;
      const frame = Math.max(
        0,
        Math.min(
          durationFrames,
          startFrame + Math.round((event.clientX - startX) / pixelsPerFrame),
        ),
      );
      if (property) moveLayerPropertyKeyframe(layerId, property, keyframeId, frame);
      else moveLayerKeyframe(layerId, keyframeId, frame);
      useTimelineStore.getState().controller?.seek(frame);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleTrackContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    layerId: string,
    property?: AnimatableLayerProperty,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const frame = Math.min(durationFrames, frameFromClientX(event.clientX));
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    const keyframe = layer
      ? property
        ? getResolvedLayerAnimationTracks(layer)[property]?.find(
            (candidate) => candidate.frame === frame,
          )
        : findLayerKeyframeAtFrame(layer, frame)
      : undefined;
    if (keyframe) selectLayerKeyframe(layerId, keyframe.id, property ?? null);
    else if (!selectedLayerIds.includes(layerId)) selectLayer(layerId);
    controller?.seek(frame);
    setFrameMenu({ x: event.clientX, y: event.clientY, layerId, frame, property });
  };

  const frameMenuLayer = frameMenu
    ? composition.layers.find((layer) => layer.id === frameMenu.layerId)
    : undefined;
  const frameMenuKeyframe =
    frameMenu && frameMenuLayer && !frameMenu.property
      ? findLayerKeyframeAtFrame(frameMenuLayer, frameMenu.frame)
      : undefined;
  const frameMenuPropertyKeyframe =
    frameMenu?.property && frameMenuLayer
      ? getResolvedLayerAnimationTracks(frameMenuLayer)[frameMenu.property]?.find(
          (candidate) => candidate.frame === frameMenu.frame,
        )
      : undefined;
  const folderMenuFolder = folderMenu
    ? composition.layout.timelineFolders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;

  return (
    <Panel title="Timeline" style={style}>
      <div className={`timeline-panel${showKeyEditor ? ' has-key-editor' : ''}`}>
        <div className="timeline-toolbar">
          <div className="timeline-transport" role="group" aria-label="Timeline playback">
            <button
              type="button"
              className="timeline-transport-button"
              aria-label="Previous frame"
              title="Previous frame"
              onClick={() => seekByFrame(-1)}
              disabled={!controller || displayedFrame <= 0}
            >
              <TransportIcon name="previous" />
            </button>
            <button
              type="button"
              className={`timeline-transport-button primary${isPlaying ? ' active' : ''}`}
              aria-label={isPlaying ? 'Pause playback' : 'Play timeline'}
              aria-keyshortcuts="Space"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              onClick={() => (isPlaying ? controller?.pause() : controller?.play())}
              disabled={!controller || durationFrames <= 0}
            >
              <TransportIcon name={isPlaying ? 'pause' : 'play'} />
            </button>
            <button
              type="button"
              className="timeline-transport-button"
              aria-label="Stop playback and return to frame zero"
              title="Stop and return to frame 0"
              onClick={() => controller?.stop()}
              disabled={!controller || (!isPlaying && displayedFrame === 0)}
            >
              <TransportIcon name="stop" />
            </button>
            <button
              type="button"
              className="timeline-transport-button"
              aria-label="Next frame"
              title="Next frame"
              onClick={() => seekByFrame(1)}
              disabled={!controller || displayedFrame >= durationFrames}
            >
              <TransportIcon name="next" />
            </button>
          </div>

          <label
            className="timeline-step-playback-toggle"
            title="Pause playback at each pausable OGraf Step; press Play again to continue"
          >
            <input
              type="checkbox"
              checked={pauseAtOgrafSteps}
              onChange={(event) => setPauseAtOgrafSteps(event.target.checked)}
            />
            <span>Pause at Steps</span>
          </label>

          <div className="timeline-readout" aria-label="Timeline position and duration">
            <strong>{displayedFrame}</strong>
            <span className="timeline-readout-divider">/</span>
            <strong>{durationFrames} f</strong>
            <span className="timeline-readout-separator">·</span>
            <strong className="timeline-readout-duration">{duration}</strong>
          </div>

          <div className="timeline-edit-controls">
            <button type="button" onClick={handleAddKeyframe}>
              {'+ Step'}
            </button>
            <button type="button" onClick={handleAddLayerKeyframe} disabled={!selectedLayerId}>
              {'◆ Add Keyframe'}
            </button>
          </div>
          <div className="timeline-zoom-controls" role="group" aria-label="Timeline zoom">
            <input
              type="range"
              min={MIN_PX_PER_FRAME}
              max={MAX_PX_PER_FRAME}
              step={PX_PER_FRAME_STEP}
              value={pixelsPerFrame}
              aria-label="Timeline horizontal zoom"
              onChange={(event) => setPixelsPerFrame(Number(event.target.value))}
            />
            <output>{Math.round((pixelsPerFrame / DEFAULT_PX_PER_FRAME) * 100)}%</output>
          </div>
          {incomingTransition && (
            <div className="timeline-transition-controls">
              <FrameDurationControl
                label="Incoming lifecycle transition"
                frames={incomingTransition.durationFrames}
                frameRate={composition.frameRate}
                minFrames={MIN_TRANSITION_FRAMES}
                onChange={(durationFrames) =>
                  updateTransition(incomingTransition.id, { durationFrames })
                }
              />
              <label>
                Lifecycle easing
                <select
                  aria-label="Lifecycle transition easing"
                  value={incomingTransition.easing}
                  onChange={(e) =>
                    updateTransition(incomingTransition.id, {
                      easing: e.target.value as EasingPreset,
                    })
                  }
                >
                  {EASING_OPTION_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
          )}
          {activeKeyframe && (
            <span className={`timeline-state-role ${activeKeyframe.role}`}>
              {activeKeyframe.name} · {activeKeyframe.role}
            </span>
          )}
        </div>

        {lifecycleRetimeNotice && (
          <div
            className={`timeline-lifecycle-toast${lifecycleRetimeNotice.warnings.length > 0 ? ' warning' : ''}`}
            role="status"
            title={[lifecycleRetimeNotice.message, ...lifecycleRetimeNotice.warnings].join(' ')}
          >
            {lifecycleRetimeNotice.warnings.length > 0 ? '⚠' : '✓'}{' '}
            {lifecycleRetimeNotice.warnings[0] ?? lifecycleRetimeNotice.message}
          </div>
        )}

        <div className="timeline-body">
          <div className="timeline-gutter" ref={gutterRef}>
            <div className="timeline-gutter-spacer" />
            {layers.length === 0 ? (
              <div className="timeline-gutter-empty">No layers</div>
            ) : (
              timelineEntries.flatMap((entry) => {
                if (entry.kind === 'folder') {
                  const { folder } = entry;
                  const collapsed = collapsedFolderIds.has(folder.id);
                  const allSelected = folder.layerIds.every((layerId) =>
                    selectedLayerIds.includes(layerId),
                  );
                  return [
                    <div
                      className={`timeline-folder-row${allSelected ? ' selected' : ''}`}
                      key={`folder:${folder.id}`}
                      style={{ '--folder-color': folder.color } as CSSProperties}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setFolderMenu({ x: event.clientX, y: event.clientY, folderId: folder.id });
                      }}
                    >
                      <button
                        type="button"
                        className="timeline-folder-toggle"
                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                        aria-expanded={!collapsed}
                        onClick={() => toggleFolderCollapsed(folder.id)}
                      >
                        {collapsed ? '▸' : '▾'}
                      </button>
                      {editingFolderId === folder.id ? (
                        <input
                          autoFocus
                          className="timeline-folder-rename"
                          value={editingFolderName}
                          onChange={(event) => setEditingFolderName(event.target.value)}
                          onBlur={commitFolderRename}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitFolderRename();
                            if (event.key === 'Escape') setEditingFolderId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="timeline-folder-select"
                          aria-pressed={allSelected}
                          title={`Select ${folder.name} layers`}
                          onClick={(event) => {
                            if (event.ctrlKey || event.metaKey) {
                              toggleManyLayerSelection(folder.layerIds);
                            } else {
                              selectManyLayers(folder.layerIds);
                            }
                          }}
                          onDoubleClick={() => beginFolderRename(folder.id, folder.name)}
                        >
                          <span className="timeline-folder-name">{folder.name}</span>
                          <span className="timeline-folder-count">{folder.layerIds.length}</span>
                        </button>
                      )}
                    </div>,
                  ];
                }
                const { layer } = entry;
                const expanded = expandedLayerIds.has(layer.id);
                const style = {
                  '--layer-color': timelineColorForLayer(layer.id),
                } as LayerColorStyle;
                return [
                  <div
                    className={`timeline-gutter-row${selectedLayerIds.includes(layer.id) ? ' selected' : ''}${folderLayerIds.has(layer.id) ? ' in-folder' : ''}`}
                    key={layer.id}
                    style={style}
                    onContextMenu={(event) => handleLayerContextMenu(event, layer.id)}
                  >
                    <button
                      type="button"
                      className="timeline-property-toggle"
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${layer.name} properties`}
                      aria-expanded={expanded}
                      onClick={() => toggleLayerExpanded(layer.id)}
                    >
                      {expanded ? '▾' : '▸'}
                    </button>
                    <button
                      type="button"
                      className="timeline-layer-select"
                      title={`Select ${layer.name}`}
                      aria-pressed={selectedLayerIds.includes(layer.id)}
                      onClick={(event) => {
                        const selectionIds = selectionIdsForLayer(composition, layer.id);
                        if (event.ctrlKey || event.metaKey) toggleManyLayerSelection(selectionIds);
                        else selectManyLayers(selectionIds);
                      }}
                    >
                      <span className="timeline-layer-color" />
                      <span className="timeline-layer-name">{layer.name}</span>
                    </button>
                  </div>,
                  ...(expanded
                    ? getLayerAnimatableProperties(layer).map((property) => (
                        <button
                          type="button"
                          className={`timeline-property-gutter-row${selectedLayerId === layer.id && selectedLayerProperty === property ? ' selected' : ''}`}
                          key={`${layer.id}:${property}`}
                          style={style}
                          onClick={() => {
                            const keys = getResolvedLayerAnimationTracks(layer)[property] ?? [];
                            const nearest = [...keys].sort(
                              (a, b) =>
                                Math.abs(a.frame - displayedFrame) -
                                Math.abs(b.frame - displayedFrame),
                            )[0];
                            if (nearest) selectLayerKeyframe(layer.id, nearest.id, property);
                            else selectLayer(layer.id);
                          }}
                          title={`${layer.name} ${animatablePropertyLabel(property)}`}
                        >
                          <span>{animatablePropertyLabel(property)}</span>
                        </button>
                      ))
                    : []),
                ];
              })
            )}
          </div>

          <div
            className="timeline-tracks"
            ref={tracksRef}
            onScroll={() => {
              if (gutterRef.current && tracksRef.current) {
                gutterRef.current.scrollTop = tracksRef.current.scrollTop;
              }
            }}
          >
            <div
              className="timeline-content"
              style={{
                width: contentWidth,
                backgroundImage: `repeating-linear-gradient(to right, #2b2c33 0, #2b2c33 1px, transparent 1px, transparent ${pixelsPerFrame}px)`,
              }}
            >
              <div className="timeline-gridlines">
                {displayedKeyframeFrames.map(({ keyframeId, frame }) => (
                  <div
                    key={keyframeId}
                    className="timeline-gridline"
                    style={{ left: frame * pixelsPerFrame }}
                  />
                ))}
              </div>

              <div
                className={`timeline-ruler${isScrubbing ? ' scrubbing' : ''}`}
                ref={rulerRef}
                onPointerDown={handleScrubPointerDown}
              >
                {rulerTicks.map((frame) => (
                  <span
                    key={frame}
                    className="timeline-ruler-tick"
                    style={{ left: frame * pixelsPerFrame }}
                  >
                    {frame}
                  </span>
                ))}
                {composition.keyframes.map((keyframe, i) => {
                  const frame = displayedKeyframeFrames[i]?.frame ?? 0;
                  const keyframeLoopBadges = loopBadges.filter(
                    (badge) => badge.lifecycleKeyframeId === keyframe.id,
                  );
                  const loopLayerNames = keyframeLoopBadges
                    .map(
                      (badge) =>
                        composition.layers.find((layer) => layer.id === badge.layerId)?.name,
                    )
                    .filter((name): name is string => Boolean(name));
                  const loopDescription =
                    loopLayerNames.length > 0
                      ? ` · Loop enabled: ${loopLayerNames.join(', ')}`
                      : '';
                  return (
                    <div
                      key={keyframe.id}
                      className={[
                        'timeline-keyframe-marker',
                        keyframe.id === activeKeyframeId && 'active',
                        keyframe.role,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ left: frame * pixelsPerFrame }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${keyframe.name} at frame ${frame}${loopDescription}`}
                      title={`${keyframe.name} · frame ${frame} · Click selects · Double-click seeks${keyframe.role === 'start' ? ' · Start is fixed' : ' · Drag to move · Shift+double-click renames'}${loopDescription}`}
                      onPointerDown={(e) => handleKeyframeMarkerPointerDown(e, i)}
                      onKeyDown={(event) => {
                        if ((event.target as HTMLElement).tagName === 'INPUT') return;
                        if (
                          (event.key === 'Delete' || event.key === 'Backspace') &&
                          keyframe.role === 'step'
                        ) {
                          event.preventDefault();
                          removeKeyframe(keyframe.id);
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setActiveKeyframe(keyframe.id);
                          return;
                        }
                        if (i > 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                          event.preventDefault();
                          commitLifecycleMove(
                            keyframe.id,
                            frame + (event.key === 'ArrowLeft' ? -1 : 1),
                          );
                        }
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey && keyframe.role !== 'start') {
                          setEditingKeyframeId(keyframe.id);
                          setEditingName(keyframe.name);
                        } else {
                          controller?.seek(frame);
                        }
                      }}
                    >
                      <span className="timeline-keyframe-marker-flag">
                        {keyframeLoopBadges.length > 0 && (
                          <span
                            className="timeline-keyframe-loop-badge"
                            aria-hidden="true"
                            title={loopDescription.slice(3)}
                          >
                            ∞
                          </span>
                        )}
                      </span>
                      {editingKeyframeId === keyframe.id ? (
                        <input
                          autoFocus
                          className="timeline-keyframe-marker-rename"
                          value={editingName}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditingKeyframeId(null);
                          }}
                        />
                      ) : (
                        <span className="timeline-keyframe-marker-name">{keyframe.name}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {timelineEntries.flatMap((entry) => {
                if (entry.kind === 'folder') {
                  return [
                    <div
                      className="timeline-folder-track"
                      key={`folder-track:${entry.folder.id}`}
                      style={{ '--folder-color': entry.folder.color } as CSSProperties}
                      aria-hidden="true"
                    />,
                  ];
                }
                const { layer } = entry;
                const layerColorStyle = {
                  '--layer-color': timelineColorForLayer(layer.id),
                } as LayerColorStyle;
                const layerLoopBadge = loopBadgeByLayerId.get(layer.id);
                const orderedKeys = [...layer.keyframes].sort((a, b) => a.frame - b.frame);
                const layerRow = (
                  <div
                    className={`timeline-track${selectedLayerIds.includes(layer.id) ? ' selected' : ''}`}
                    key={layer.id}
                    style={layerColorStyle}
                    onPointerDown={() => {
                      selectLayer(layer.id);
                    }}
                    onDoubleClick={(event) => {
                      if (layer.isLocked) return;
                      const frame = Math.min(durationFrames, frameFromClientX(event.clientX));
                      const keyframeId = addLayerKeyframe(layer.id, frame);
                      selectLayerKeyframe(layer.id, keyframeId);
                      controller?.seek(frame);
                    }}
                    onContextMenu={(event) => handleTrackContextMenu(event, layer.id)}
                  >
                    {orderedKeys.slice(1).map((toKeyframe, index) => {
                      const fromKeyframe = orderedKeys[index]!;
                      const spanFrames = toKeyframe.frame - fromKeyframe.frame;
                      return (
                        <div
                          key={`${fromKeyframe.id}:${toKeyframe.id}`}
                          className={`timeline-layer-span${toKeyframe.easing === 'linear' ? '' : ' eased'}`}
                          style={{
                            left: fromKeyframe.frame * pixelsPerFrame,
                            width: spanFrames * pixelsPerFrame,
                          }}
                          title={`${layer.name} · ${fromKeyframe.frame}–${toKeyframe.frame} · ${spanFrames} frames · ${easingLabel(toKeyframe.easing)}`}
                        >
                          {spanFrames >= 4 && (
                            <span className="timeline-layer-span-label">{spanFrames}f</span>
                          )}
                          {toKeyframe.easing !== 'linear' && spanFrames * pixelsPerFrame >= 42 && (
                            <span className="timeline-layer-span-easing">
                              ∿
                              {spanFrames * pixelsPerFrame >= 105
                                ? ` ${easingLabel(toKeyframe.easing)}`
                                : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {orderedKeys.map((keyframe) => {
                      const hasLoopBadge = layerLoopBadge?.frame === keyframe.frame;
                      const loopTitle = hasLoopBadge
                        ? layerLoopBadge.activation === 'lifecycle'
                          ? ' · Loop begins here and remains active while on-air'
                          : ' · Loop active at this Step'
                        : '';
                      return (
                        <div
                          key={keyframe.id}
                          className={`timeline-keyframe-dot${keyframe.id === selectedLayerKeyframeId ? ' active' : ''}${hasLoopBadge ? ' has-loop' : ''}`}
                          style={{ left: keyframe.frame * pixelsPerFrame }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${layer.name} key at frame ${keyframe.frame}${loopTitle}`}
                          title={`${layer.name} · frame ${keyframe.frame} · Click selects · Double-click seeks · Drag moves${loopTitle}`}
                          onFocus={() => selectLayerKeyframe(layer.id, keyframe.id)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            controller?.seek(keyframe.frame);
                          }}
                          onKeyDown={(event) => {
                            if (layer.isLocked) return;
                            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                              event.preventDefault();
                              moveLayerKeyframe(
                                layer.id,
                                keyframe.id,
                                keyframe.frame + (event.key === 'ArrowLeft' ? -1 : 1),
                              );
                            } else if (
                              (event.key === 'Delete' || event.key === 'Backspace') &&
                              orderedKeys.length > 1
                            ) {
                              event.preventDefault();
                              removeLayerKeyframe(layer.id, keyframe.id);
                              clearLayerKeyframe();
                            }
                          }}
                          onPointerDown={(event) =>
                            handleLayerKeyframePointerDown(
                              event,
                              layer.id,
                              keyframe.id,
                              keyframe.frame,
                            )
                          }
                        >
                          {hasLoopBadge && (
                            <span className="timeline-layer-loop-badge" aria-hidden="true">
                              ∞
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
                if (!expandedLayerIds.has(layer.id)) return [layerRow];
                const tracks = getResolvedLayerAnimationTracks(layer);
                const propertyRows = getLayerAnimatableProperties(layer).map((property) => {
                  const propertyKeys = [...(tracks[property] ?? [])].sort(
                    (a, b) => a.frame - b.frame,
                  );
                  const propertyLoopBadgeFrame = layerLoopBadge?.properties.includes(property)
                    ? layerLoopBadge.frame
                    : undefined;
                  const propertyLoopTitle =
                    propertyLoopBadgeFrame === undefined
                      ? ''
                      : `${animatablePropertyLabel(property)} loop activates at frame ${propertyLoopBadgeFrame}`;
                  return (
                    <div
                      className={`timeline-track timeline-property-track${selectedLayerId === layer.id && selectedLayerProperty === property ? ' selected' : ''}`}
                      key={`${layer.id}:${property}`}
                      style={layerColorStyle}
                      onPointerDown={() => {
                        selectLayer(layer.id);
                      }}
                      onDoubleClick={(event) => {
                        if (layer.isLocked) return;
                        const frame = Math.min(durationFrames, frameFromClientX(event.clientX));
                        const keyframeId = addLayerPropertyKeyframe(layer.id, property, frame);
                        selectLayerKeyframe(layer.id, keyframeId, property);
                        controller?.seek(frame);
                      }}
                      onContextMenu={(event) => handleTrackContextMenu(event, layer.id, property)}
                    >
                      {propertyKeys.slice(1).map((toKeyframe, index) => {
                        const fromKeyframe = propertyKeys[index]!;
                        const spanFrames = toKeyframe.frame - fromKeyframe.frame;
                        return (
                          <div
                            key={`${fromKeyframe.id}:${toKeyframe.id}`}
                            className={`timeline-layer-span property${toKeyframe.easing === 'linear' ? '' : ' eased'}`}
                            style={{
                              left: fromKeyframe.frame * pixelsPerFrame,
                              width: spanFrames * pixelsPerFrame,
                            }}
                            title={`${animatablePropertyLabel(property)} · ${fromKeyframe.frame}–${toKeyframe.frame} · ${easingLabel(toKeyframe.easing)}`}
                          >
                            {toKeyframe.easing !== 'linear' &&
                              spanFrames * pixelsPerFrame >= 42 && (
                                <span className="timeline-layer-span-easing">∿</span>
                              )}
                          </div>
                        );
                      })}
                      {propertyKeys.map((keyframe) => {
                        const hasLoopBadge = propertyLoopBadgeFrame === keyframe.frame;
                        return (
                          <div
                            key={keyframe.id}
                            className={`timeline-keyframe-dot property${keyframe.id === selectedLayerKeyframeId && selectedLayerProperty === property ? ' active' : ''}${hasLoopBadge ? ' has-loop' : ''}`}
                            style={{ left: keyframe.frame * pixelsPerFrame }}
                            role="button"
                            tabIndex={0}
                            aria-label={`${animatablePropertyLabel(property)} key at frame ${keyframe.frame}${hasLoopBadge ? ' · Loop activates here' : ''}`}
                            title={`${animatablePropertyLabel(property)} · frame ${keyframe.frame} · value ${keyframe.value.toFixed(3)} · Click selects · Double-click seeks · Drag moves${hasLoopBadge ? ' · Loop activates here' : ''}`}
                            onFocus={() => selectLayerKeyframe(layer.id, keyframe.id, property)}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              controller?.seek(keyframe.frame);
                            }}
                            onKeyDown={(event) => {
                              if (layer.isLocked) return;
                              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                event.preventDefault();
                                moveLayerPropertyKeyframe(
                                  layer.id,
                                  property,
                                  keyframe.id,
                                  keyframe.frame + (event.key === 'ArrowLeft' ? -1 : 1),
                                );
                              } else if (
                                (event.key === 'Delete' || event.key === 'Backspace') &&
                                propertyKeys.length > 1
                              ) {
                                event.preventDefault();
                                removeLayerPropertyKeyframe(layer.id, property, keyframe.id);
                                clearLayerKeyframe();
                              }
                            }}
                            onPointerDown={(event) =>
                              handleLayerKeyframePointerDown(
                                event,
                                layer.id,
                                keyframe.id,
                                keyframe.frame,
                                property,
                              )
                            }
                          >
                            {hasLoopBadge && (
                              <span className="timeline-layer-loop-badge" aria-hidden="true">
                                ∞
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {propertyLoopBadgeFrame !== undefined &&
                        !propertyKeys.some(
                          (keyframe) => keyframe.frame === propertyLoopBadgeFrame,
                        ) && (
                          <div
                            className="timeline-keyframe-dot property has-loop timeline-property-loop-activation"
                            style={{ left: propertyLoopBadgeFrame * pixelsPerFrame }}
                            role="img"
                            aria-label={propertyLoopTitle}
                            title={propertyLoopTitle}
                          >
                            <span className="timeline-layer-loop-badge" aria-hidden="true">
                              ∞
                            </span>
                          </div>
                        )}
                    </div>
                  );
                });
                return [layerRow, ...propertyRows];
              })}

              {displayedKeyframeFrames.slice(1).map(({ keyframeId, frame }, offset) => {
                const keyframeIndex = offset + 1;
                const keyframe = composition.keyframes[keyframeIndex]!;
                const committedFrame = keyframeFrames[keyframeIndex]?.frame ?? frame;
                return (
                  <button
                    type="button"
                    key={`lifecycle-line:${keyframeId}`}
                    className={`timeline-lifecycle-dragline ${keyframe.role}${keyframe.id === activeKeyframeId ? ' active' : ''}`}
                    style={{ left: frame * pixelsPerFrame }}
                    aria-label={`${keyframe.name} at frame ${frame}. Drag or use arrow keys to move.`}
                    title={`${keyframe.name} · frame ${frame} · Click selects · Double-click seeks · Drag moves`}
                    onPointerDown={(event) => handleKeyframeMarkerPointerDown(event, keyframeIndex)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      controller?.seek(frame);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      commitLifecycleMove(
                        keyframe.id,
                        committedFrame + (event.key === 'ArrowLeft' ? -1 : 1),
                      );
                    }}
                  />
                );
              })}

              <div
                className={`timeline-playhead${isScrubbing ? ' scrubbing' : ''}`}
                style={{ left: currentFrame * pixelsPerFrame }}
              >
                <button
                  type="button"
                  className="timeline-playhead-handle"
                  aria-label={`Current frame ${displayedFrame}. Drag to scrub the timeline.`}
                  title={`Frame ${displayedFrame} · Drag to scrub`}
                  onPointerDown={handleScrubPointerDown}
                />
              </div>
            </div>
          </div>
        </div>
        {showKeyEditor && (
          <aside className="timeline-key-editor" aria-label="Keyframe editor">
            <h3>Keyframe editor</h3>
            {selectedLayer && (selectedPropertyKeyframe || selectedLayerKeyframe) && (
              <div className="timeline-layer-key-controls">
                <div className="timeline-key-editor-selection">
                  <strong>{selectedLayer.name}</strong>
                  <span>
                    {selectedLayerProperty
                      ? animatablePropertyLabel(selectedLayerProperty)
                      : 'Layer transform'}
                    {' · frame '}
                    {(selectedPropertyKeyframe ?? selectedLayerKeyframe)!.frame}
                  </span>
                </div>
                <label>
                  Incoming easing
                  <select
                    aria-label="Selected layer key easing"
                    value={(selectedPropertyKeyframe ?? selectedLayerKeyframe)!.easing}
                    onChange={(event) =>
                      selectedLayerProperty && selectedPropertyKeyframe
                        ? updateLayerPropertyKeyframeEasing(
                            selectedLayer.id,
                            selectedLayerProperty,
                            selectedPropertyKeyframe.id,
                            event.target.value as EasingPreset,
                          )
                        : selectedLayerKeyframe &&
                          updateLayerKeyframeEasing(
                            selectedLayer.id,
                            selectedLayerKeyframe.id,
                            event.target.value as EasingPreset,
                          )
                    }
                  >
                    {EASING_OPTION_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {selectedLayerProperty && selectedPropertyKeyframe && (
                  <>
                    <details className="timeline-advanced-section">
                      <summary>Advanced curve</summary>
                      <EasingCurveEditor
                        easing={selectedPropertyKeyframe.easing}
                        curve={selectedPropertyKeyframe.curve}
                        onChange={(curve) =>
                          updateLayerPropertyKeyframeCurve(
                            selectedLayer.id,
                            selectedLayerProperty,
                            selectedPropertyKeyframe.id,
                            curve,
                          )
                        }
                      />
                    </details>
                    <details className="timeline-advanced-section">
                      <summary>Track Actions…</summary>
                      <div className="timeline-track-actions">
                        <button
                          type="button"
                          title="Shift this complete property track one frame earlier"
                          onClick={() =>
                            offsetLayerPropertyTrack(selectedLayer.id, selectedLayerProperty, -1)
                          }
                        >
                          Shift −1 frame
                        </button>
                        <button
                          type="button"
                          title="Shift this complete property track one frame later"
                          onClick={() =>
                            offsetLayerPropertyTrack(selectedLayer.id, selectedLayerProperty, 1)
                          }
                        >
                          Shift +1 frame
                        </button>
                        <label className="timeline-track-scale">
                          Scale
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={trackScalePercent}
                            onChange={(event) => setTrackScalePercent(Number(event.target.value))}
                          />
                          <span>%</span>
                          <button
                            type="button"
                            onClick={() =>
                              scaleLayerPropertyTrack(
                                selectedLayer.id,
                                selectedLayerProperty,
                                Math.max(1, trackScalePercent) / 100,
                              )
                            }
                          >
                            Apply
                          </button>
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            reverseLayerPropertyTrack(selectedLayer.id, selectedLayerProperty)
                          }
                        >
                          Reverse track
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            distributeLayerPropertyTrack(selectedLayer.id, selectedLayerProperty)
                          }
                        >
                          Distribute keys
                        </button>
                      </div>
                    </details>
                  </>
                )}
              </div>
            )}
            {selectedLayer && selectedLayerProperty && (
              <details className="timeline-loop-editor" aria-label="Layer loop editor">
                <summary>Local property loop</summary>
                <div className="timeline-loop-editor-content">
                  {selectedLayer.loop && (
                    <div className="timeline-loop-editor-heading">
                      <span>{animatablePropertyLabel(selectedLayerProperty)}</span>
                      <button
                        type="button"
                        className={previewLoopLayerId === selectedLayer.id ? 'active' : ''}
                        onClick={() =>
                          setPreviewLoopLayerId(
                            previewLoopLayerId === selectedLayer.id ? null : selectedLayer.id,
                          )
                        }
                      >
                        {previewLoopLayerId === selectedLayer.id ? 'Stop preview' : 'Preview'}
                      </button>
                    </div>
                  )}
                  {!selectedLayer.loop ? (
                    <button type="button" onClick={createLoopForSelectedProperty}>
                      Add Loop…
                    </button>
                  ) : (
                    <>
                      <div className="timeline-loop-grid">
                        <label>
                          Duration
                          <input
                            type="number"
                            min={1}
                            value={selectedLayer.loop.durationFrames}
                            onChange={(event) =>
                              setLayerLoop(selectedLayer.id, {
                                durationFrames: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Repeats
                          <input
                            type="number"
                            min={1}
                            placeholder="∞"
                            value={selectedLayer.loop.repeatCount ?? ''}
                            onChange={(event) =>
                              setLayerLoop(selectedLayer.id, {
                                repeatCount:
                                  event.target.value === '' ? null : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Active while
                          <select
                            value={
                              selectedLayer.loop.activation.type === 'lifecycle'
                                ? 'lifecycle'
                                : `step:${selectedLayer.loop.activation.stepKeyframeId}`
                            }
                            onChange={(event) => {
                              const value = event.target.value;
                              setLayerLoop(selectedLayer.id, {
                                activation:
                                  value === 'lifecycle'
                                    ? { type: 'lifecycle' }
                                    : { type: 'step', stepKeyframeId: value.slice(5) },
                              });
                            }}
                          >
                            <option value="lifecycle">Graphic is on-air</option>
                            {composition.keyframes
                              .filter((keyframe) => keyframe.role === 'step')
                              .map((keyframe) => (
                                <option key={keyframe.id} value={`step:${keyframe.id}`}>
                                  {keyframe.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <details className="timeline-loop-advanced">
                        <summary>Advanced loop settings</summary>
                        <label>
                          Phase offset frames
                          <input
                            type="number"
                            value={selectedLayer.loop.phaseOffsetFrames}
                            onChange={(event) =>
                              setLayerLoop(selectedLayer.id, {
                                phaseOffsetFrames: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      </details>
                      {selectedLoopTrack.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const value = getLayerPropertyValueAtFrame(
                              selectedLayer,
                              selectedLayerProperty,
                              displayedFrame,
                            );
                            updateSelectedLoopTrack([
                              createLayerPropertyKeyframe(0, value, { easing: 'linear' }),
                              createLayerPropertyKeyframe(
                                selectedLayer.loop!.durationFrames,
                                value,
                                {
                                  easing: 'sine-in-out',
                                },
                              ),
                            ]);
                          }}
                        >
                          Add {animatablePropertyLabel(selectedLayerProperty)} to loop
                        </button>
                      ) : (
                        <div className="timeline-loop-keys">
                          <div className="timeline-loop-key header">
                            <span>Frame</span>
                            <span>Value</span>
                            <span>Incoming easing</span>
                            <span />
                          </div>
                          {selectedLoopTrack.map((key) => (
                            <div className="timeline-loop-key" key={key.id}>
                              <input
                                aria-label="Loop key frame"
                                type="number"
                                min={0}
                                max={selectedLayer.loop!.durationFrames}
                                value={key.frame}
                                onChange={(event) =>
                                  updateSelectedLoopTrack(
                                    selectedLoopTrack.map((candidate) =>
                                      candidate.id === key.id
                                        ? { ...candidate, frame: Number(event.target.value) }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <input
                                aria-label="Loop key value"
                                type="number"
                                step="any"
                                value={key.value}
                                onChange={(event) =>
                                  updateSelectedLoopTrack(
                                    selectedLoopTrack.map((candidate) =>
                                      candidate.id === key.id
                                        ? { ...candidate, value: Number(event.target.value) }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <select
                                aria-label="Loop key incoming easing"
                                value={key.easing}
                                onChange={(event) =>
                                  updateSelectedLoopTrack(
                                    selectedLoopTrack.map((candidate) =>
                                      candidate.id === key.id
                                        ? {
                                            ...candidate,
                                            easing: event.target.value as EasingPreset,
                                            curve: undefined,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              >
                                {EASING_OPTION_GROUPS.flatMap((group) => group.options).map(
                                  (option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ),
                                )}
                              </select>
                              <button
                                type="button"
                                aria-label="Delete loop key"
                                disabled={selectedLoopTrack.length <= 2}
                                onClick={() =>
                                  updateSelectedLoopTrack(
                                    selectedLoopTrack.filter(
                                      (candidate) => candidate.id !== key.id,
                                    ),
                                  )
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="timeline-loop-actions">
                            <button
                              type="button"
                              onClick={() => {
                                const occupied = new Set(selectedLoopTrack.map((key) => key.frame));
                                const frame = Array.from(
                                  { length: selectedLayer.loop!.durationFrames + 1 },
                                  (_, index) => index,
                                ).find((candidate) => !occupied.has(candidate));
                                if (frame === undefined) return;
                                const fallback = selectedLoopTrack[0]?.value ?? 0;
                                updateSelectedLoopTrack([
                                  ...selectedLoopTrack,
                                  createLayerPropertyKeyframe(
                                    frame,
                                    getTrackValueAtFrame(selectedLoopTrack, frame, fallback),
                                  ),
                                ]);
                              }}
                            >
                              + Key
                            </button>
                          </div>
                        </div>
                      )}
                      <details className="timeline-loop-danger">
                        <summary>Loop actions…</summary>
                        <div className="timeline-loop-actions">
                          {selectedLoopTrack.length > 0 && (
                            <button type="button" onClick={() => updateSelectedLoopTrack([])}>
                              Remove property
                            </button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            onClick={() => {
                              removeLayerLoop(selectedLayer.id);
                              setPreviewLoopLayerId(null);
                            }}
                          >
                            Remove loop
                          </button>
                        </div>
                      </details>
                    </>
                  )}
                </div>
              </details>
            )}
          </aside>
        )}
        {frameMenu && frameMenuLayer && (
          <ContextMenu
            x={frameMenu.x}
            y={frameMenu.y}
            ariaLabel={`${frameMenuLayer.name} frame ${frameMenu.frame} actions`}
            onClose={() => setFrameMenu(null)}
            items={
              frameMenu.property
                ? [
                    {
                      id: 'insert-property-key',
                      label: `Insert ${animatablePropertyLabel(frameMenu.property)} key`,
                      disabled: frameMenuLayer.isLocked || Boolean(frameMenuPropertyKeyframe),
                      onSelect: () => {
                        const keyframeId = addLayerPropertyKeyframe(
                          frameMenu.layerId,
                          frameMenu.property!,
                          frameMenu.frame,
                        );
                        selectLayerKeyframe(frameMenu.layerId, keyframeId, frameMenu.property!);
                        controller?.seek(frameMenu.frame);
                      },
                    },
                    {
                      id: 'delete-property-key',
                      label: 'Delete property key',
                      disabled:
                        !frameMenuPropertyKeyframe ||
                        frameMenuLayer.isLocked ||
                        (getResolvedLayerAnimationTracks(frameMenuLayer)[frameMenu.property]
                          ?.length ?? 0) <= 1,
                      separatorBefore: true,
                      onSelect: () => {
                        if (!frameMenuPropertyKeyframe) return;
                        removeLayerPropertyKeyframe(
                          frameMenu.layerId,
                          frameMenu.property!,
                          frameMenuPropertyKeyframe.id,
                        );
                        clearLayerKeyframe();
                      },
                    },
                  ]
                : [
                    {
                      id: 'insert-frame',
                      label: 'Insert Hold Key',
                      disabled: frameMenuLayer.isLocked || Boolean(frameMenuKeyframe),
                      title: 'Hold the preceding authored pose through this frame',
                      onSelect: () => {
                        const keyframeId = addLayerHoldFrame(frameMenu.layerId, frameMenu.frame);
                        selectLayerKeyframe(frameMenu.layerId, keyframeId);
                        controller?.seek(frameMenu.frame);
                      },
                    },
                    {
                      id: 'insert-keyframe',
                      label: 'Insert Keyframe',
                      disabled: frameMenuLayer.isLocked || Boolean(frameMenuKeyframe),
                      title: 'Capture the evaluated pose at this frame',
                      onSelect: () => {
                        const keyframeId = addLayerKeyframe(frameMenu.layerId, frameMenu.frame);
                        selectLayerKeyframe(frameMenu.layerId, keyframeId);
                        controller?.seek(frameMenu.frame);
                      },
                    },
                    {
                      id: 'delete-keyframe',
                      label: 'Delete Keyframe',
                      disabled:
                        frameMenuLayer.isLocked ||
                        !frameMenuKeyframe ||
                        frameMenuLayer.keyframes.length <= 1,
                      separatorBefore: true,
                      onSelect: () => {
                        if (!frameMenuKeyframe) return;
                        removeLayerKeyframe(frameMenu.layerId, frameMenuKeyframe.id);
                        clearLayerKeyframe();
                      },
                    },
                  ]
            }
          />
        )}
        {folderMenu && folderMenuFolder && (
          <ContextMenu
            x={folderMenu.x}
            y={folderMenu.y}
            ariaLabel={`${folderMenuFolder.name} timeline group actions`}
            onClose={() => setFolderMenu(null)}
            items={[
              {
                id: 'rename-timeline-group',
                label: 'Rename Group',
                onSelect: () => beginFolderRename(folderMenuFolder.id, folderMenuFolder.name),
              },
              {
                id: 'change-timeline-group-color',
                label: 'Group Color',
                onSelect: () => undefined,
                colorValue: folderMenuFolder.color,
                onColorChange: (color) => setTimelineFolderColor(folderMenuFolder.id, color),
              },
              {
                id: 'ungroup-timeline-group',
                label: 'Ungroup',
                separatorBefore: true,
                title: 'Remove timeline organization without deleting any layers',
                onSelect: () => {
                  removeTimelineFolder(folderMenuFolder.id);
                  setCollapsedFolderIds((current) => {
                    const next = new Set(current);
                    next.delete(folderMenuFolder.id);
                    return next;
                  });
                },
              },
            ]}
          />
        )}
        {layerMenu && (
          <ContextMenu
            x={layerMenu.x}
            y={layerMenu.y}
            ariaLabel="Selected timeline layer actions"
            onClose={() => setLayerMenu(null)}
            items={[
              {
                id: 'create-timeline-group',
                label: 'Create Group',
                disabled: layerMenu.layerIds.length < 2,
                title:
                  'Organize the selected timeline rows without changing canvas transforms or OGraf output',
                onSelect: () => createSelectedTimelineGroup(layerMenu.layerIds),
              },
              {
                id: 'ungroup-selected-timeline-groups',
                label: 'Ungroup',
                disabled: !composition.layout.timelineFolders.some((group) =>
                  group.layerIds.some((layerId) => layerMenu.layerIds.includes(layerId)),
                ),
                onSelect: () => ungroupSelectedTimelineGroups(layerMenu.layerIds),
              },
            ]}
          />
        )}
      </div>
    </Panel>
  );
}
