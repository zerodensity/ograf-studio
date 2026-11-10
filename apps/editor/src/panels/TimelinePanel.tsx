import { useCanvasViewStore } from '../state/canvasViewStore';
import { useEditorWindow, isDomElement } from '../layout/EditorWindow';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  animationRetimePhaseRange,
  assessStaticExitHold,
  animatablePropertyLabel,
  computeKeyframeFrames,
  createLayerPropertyKeyframe,
  getLayerAnimatableProperties,
  getLayerPropertyValueAtFrame,
  getTrackValueAtFrame,
  MAX_FRAME_CUES,
  mediaCueStartFrame,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  getShaderTrackValueAtFrame,
  type AnimatableLayerProperty,
  type MediaCue,
  type FrameCue,
} from '@ograf-editor/scene-model';
import { ContextMenu } from '../components/ContextMenu';
import { selectionIdsForLayer } from '../canvas/groupSelection';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTimelineStore } from '../state/timelineStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSelectionStore, type SelectedLayerKeyframe } from '../state/selectionStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useSoundEventSelectionStore } from '../state/soundEventSelectionStore';
import { isSoundEventCue, soundEventSource } from '../state/soundEvents';
import { lifecycleRetimeBounds, MIN_LIFECYCLE_TRANSITION_FRAMES } from '../state/lifecycleRetime';
import { Panel } from './Panel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { TimelineHoverDetails } from './TimelineHoverDetails';
import { formatFrameDuration } from './timelineFormatting';
import { formatDurationInput } from './durationInput';
import { lifecycleLabel } from './lifecycleLabels';
import { FrameDurationControl } from './FrameDurationControl';
import { TimelineDisplayUnits } from './TimelineDisplayUnits';
import { AnimationGraphEditor, type TimelineGraphViewport } from './AnimationGraphEditor';
import { timelineViewAfterSelectionChange, type TimelineViewMode } from './timelineViewMode';
import { SoundEventEditor } from './SoundEventEditor';
import { FrameCueEditor } from './FrameCueEditor';
import { easingLabel } from './easingOptions';
import { EasingPicker } from './EasingPicker';
import { handleMotionClipboardShortcut, type CopiedMotionKey } from './motionClipboard';
import { resetTimelineChannelAnimation } from './timelineChannelActions';
import { LoopTimingEditor } from './LoopTimingEditor';
import { buildTimelineEntries } from './timelineFolders';
import { buildTimelineLoopBadges } from './timelineLoopBadges';
import { isTimelineKeyDrag } from './timelinePointerIntent';
import {
  collectTimelineKeyframeFrames,
  jumpTimelineKeyframe,
  stepTimelineFrame,
  timelineFrameDirection,
  timelineKeyframeDirection,
  timelineTargetOwnsArrows,
  handleTimelinePlaybackKey,
  seekTimelineFrame,
  seekTimelineKeyframeOnSelect,
  seekTimelineTime,
  synchronizeTimelineKeySelection,
} from './timelineFrameNavigation';
import {
  meaningfulTimelineProperties,
  timelineAnimationTracks,
  timelineLayerKeyframes,
} from './timelinePropertyVisibility';
import { TIMELINE_LAYER_TRACK_COLOR, timelineTrackColorForProperty } from './timelineTrackColors';
import {
  clampTimelineGutterWidth,
  DEFAULT_TIMELINE_GUTTER_WIDTH,
  MAX_TIMELINE_GUTTER_WIDTH,
  MIN_TIMELINE_GUTTER_WIDTH,
} from './timelineGutterResize';
import './TimelinePanel.css';

const DEFAULT_PX_PER_FRAME = 12;
const MIN_PX_PER_FRAME = 4;
const MAX_PX_PER_FRAME = 32;
const PX_PER_FRAME_STEP = 2;
const MIN_CONTENT_FRAMES = 60;
const CONTENT_PADDING_PX = 80;
const MIN_TRANSITION_FRAMES = MIN_LIFECYCLE_TRANSITION_FRAMES;
const TIMELINE_GUTTER_STORAGE_KEY = 'ograf-studio:timeline-gutter-width';
let motionClipboard: CopiedMotionKey[] = [];

function loadTimelineGutterWidth(): number {
  try {
    const stored = Number(localStorage.getItem(TIMELINE_GUTTER_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // Local persistence is optional; the default remains fully usable.
  }
  return DEFAULT_TIMELINE_GUTTER_WIDTH;
}

type LayerColorStyle = CSSProperties & { '--layer-color': string };

type TransportIconName = 'previous' | 'play' | 'pause' | 'stop' | 'next';

const isSameKeyTrack = (left: SelectedLayerKeyframe, right: SelectedLayerKeyframe) =>
  left.layerId === right.layerId && left.property === right.property;

const isSameSelectedKey = (left: SelectedLayerKeyframe, right: SelectedLayerKeyframe) =>
  isSameKeyTrack(left, right) && left.keyframeId === right.keyframeId;

function groupedAnimationProperties(properties: AnimatableLayerProperty[]) {
  return [
    {
      label: 'Object',
      properties: properties.filter((property) => !parseShaderAnimationProperty(property)),
    },
    {
      label: 'Fill shader',
      properties: properties.filter(
        (property) => parseShaderAnimationProperty(property)?.slot === 'fill',
      ),
    },
    {
      label: 'Outline shader',
      properties: properties.filter(
        (property) => parseShaderAnimationProperty(property)?.slot === 'stroke',
      ),
    },
  ].filter((group) => group.properties.length);
}

function TransportIcon({ name }: { name: TransportIconName }) {
  return (
    <svg className="timeline-transport-icon" viewBox="0 0 16 16" aria-hidden="true">
      {name === 'previous' && <path d="m10 3-5 5 5 5" />}
      {name === 'play' && <path d="m4 2.5 9 5.5-9 5.5z" className="filled" />}
      {name === 'pause' && (
        <>
          <rect x="3" y="2.5" width="3.5" height="11" rx="0.7" className="filled" />
          <rect x="9.5" y="2.5" width="3.5" height="11" rx="0.7" className="filled" />
        </>
      )}
      {name === 'stop' && <rect x="3" y="3" width="10" height="10" rx="0.8" className="filled" />}
      {name === 'next' && <path d="m6 3 5 5-5 5" />}
    </svg>
  );
}

export function TimelinePanel({ style }: { style?: CSSProperties }) {
  const projectId = useProjectStore((state) => state.project.id);
  const { window } = useEditorWindow();
  const viewMode = useCanvasViewStore((state) => state.mode);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigationKeyframeFramesRef = useRef<number[]>([]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handleFrameKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isDomElement(event.target)) return;
      const target = event.target;
      const focusedTimelineTab = target.closest(
        '[role="tab"][data-dock-pane="timeline"][aria-selected="true"]',
      );
      if ((!panel.contains(target) && !focusedTimelineTab) || timelineTargetOwnsArrows(target))
        return;
      if (handleTimelinePlaybackKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const keyframeDirection = timelineKeyframeDirection(event);
      if (
        keyframeDirection !== null &&
        jumpTimelineKeyframe(navigationKeyframeFramesRef.current, keyframeDirection)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const direction = timelineFrameDirection(event);
      if (direction === null || !stepTimelineFrame(direction)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Capture before buttons and markers: Space toggles playback; arrows navigate frames.
    window.addEventListener('keydown', handleFrameKey, true);
    const floatingTitle = panel
      .closest('.dock-floating-pane')
      ?.querySelector('.dock-floating-title');
    const focusFloatingTimeline = (event: Event) => {
      if (isDomElement(event.target) && !event.target.closest('button, input, select, textarea'))
        panel.focus({ preventScroll: true });
    };
    floatingTitle?.addEventListener('pointerdown', focusFloatingTimeline);
    return () => {
      window.removeEventListener('keydown', handleFrameKey, true);
      floatingTitle?.removeEventListener('pointerdown', focusFloatingTimeline);
    };
  }, [window, viewMode]);
  const composition = useActiveComposition();
  const shortOutAssessment = useMemo(
    () =>
      composition.shortOutFrames === undefined
        ? undefined
        : assessStaticExitHold(composition, composition.shortOutFrames),
    [composition],
  );
  const activeKeyframeId = useProjectStore((s) => s.activeKeyframeId);
  const setActiveKeyframe = useProjectStore((s) => s.setActiveKeyframe);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const removeKeyframe = useProjectStore((s) => s.removeKeyframe);
  const renameKeyframe = useProjectStore((s) => s.renameKeyframe);
  const updateTransition = useProjectStore((s) => s.updateTransition);
  const moveLifecycleKeyframe = useProjectStore((s) => s.moveLifecycleKeyframe);
  const addSoundEventFromAsset = useProjectStore((s) => s.addSoundEventFromAsset);
  const updateMediaCue = useProjectStore((s) => s.updateMediaCue);
  const addFrameCue = useProjectStore((s) => s.addFrameCue);
  const retimeAnimationPhase = useProjectStore((s) => s.retimeAnimationPhase);
  const addLayerKeyframe = useProjectStore((s) => s.addLayerKeyframe);
  const addLayerHoldFrame = useProjectStore((s) => s.addLayerHoldFrame);
  const moveLayerKeyframe = useProjectStore((s) => s.moveLayerKeyframe);
  const moveTimelineKeyframesTogether = useProjectStore((s) => s.moveTimelineKeyframesTogether);
  const removeLayerKeyframe = useProjectStore((s) => s.removeLayerKeyframe);
  const updateLayerKeyframeEasing = useProjectStore((s) => s.updateLayerKeyframeEasing);
  const addLayerPropertyKeyframe = useProjectStore((s) => s.addLayerPropertyKeyframe);
  const updateLayerPropertyKeyframeValue = useProjectStore(
    (s) => s.updateLayerPropertyKeyframeValue,
  );
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
  const storedLayerProperty = useSelectionStore((s) => s.selectedLayerProperty);
  const selectedLayerProperty =
    storedLayerProperty &&
    composition.layers.some(
      (layer) =>
        layer.id === selectedLayerId &&
        getLayerAnimatableProperties(layer).includes(storedLayerProperty),
    )
      ? storedLayerProperty
      : null;
  const selectedLayerKeyframes = useSelectionStore((s) => s.selectedLayerKeyframes);
  const selectLayer = useSelectionStore((s) => s.select);
  const selectLayerProperty = useSelectionStore((s) => s.selectLayerProperty);
  const selectManyLayers = useSelectionStore((s) => s.selectMany);
  const toggleManyLayerSelection = useSelectionStore((s) => s.toggleManyLayerSelection);
  const selectLayerKeyframe = useSelectionStore((s) => s.selectLayerKeyframe);
  const selectLayerKeyframes = useSelectionStore((s) => s.selectLayerKeyframes);
  const clearLayerKeyframe = useSelectionStore((s) => s.clearLayerKeyframe);
  const selectedSoundEventId = useSoundEventSelectionStore((s) => s.selectedSoundEventId);
  const selectSoundEvent = useSoundEventSelectionStore((s) => s.selectSoundEvent);

  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const durationUnit = useWorkspaceStore((s) => s.editorPreferences.durationUnit ?? 'seconds');
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const pauseAtOgrafSteps = useTimelineStore((s) => s.pauseAtOgrafSteps);
  const setPauseAtOgrafSteps = useTimelineStore((s) => s.setPauseAtOgrafSteps);
  const autoKeyframe = useTimelineStore((s) => s.autoKeyframe);
  const setAutoKeyframe = useTimelineStore((s) => s.setAutoKeyframe);
  const durationFrames = useTimelineStore((s) => s.durationFrames);
  const controller = useTimelineStore((s) => s.controller);
  const previewLoopLayerId = useTimelineStore((s) => s.previewLoopLayerId);
  const setPreviewLoopLayerId = useTimelineStore((s) => s.setPreviewLoopLayerId);
  const displayedFrame = Math.max(0, Math.min(durationFrames, Math.round(currentFrame)));
  const previousPlayhead = useRef(currentFrame);
  useEffect(() => {
    if (previousPlayhead.current === currentFrame) return;
    previousPlayhead.current = currentFrame;
    synchronizeTimelineKeySelection(composition, currentFrame);
  }, [composition, currentFrame]);
  const duration = formatFrameDuration(durationFrames, composition.frameRate);
  const displayedTime = formatDurationInput(displayedFrame, composition.frameRate, durationUnit);
  const [timeDraft, setTimeDraft] = useState(displayedTime);
  const [timeError, setTimeError] = useState('');
  const cancelTimeDraft = useRef(false);
  useEffect(() => {
    setTimeDraft(displayedTime);
    setTimeError('');
  }, [displayedTime]);
  const commitTimeDraft = () => {
    if (cancelTimeDraft.current) {
      cancelTimeDraft.current = false;
      return;
    }
    if (timeDraft === displayedTime) return;
    const frame = seekTimelineTime(timeDraft, composition.frameRate, durationUnit);
    if (frame === null) {
      setTimeError('Enter a time such as 1s, 500ms, 25f or 00:00:01:00.');
      return;
    }
    setTimeDraft(formatDurationInput(frame, composition.frameRate, durationUnit));
    setTimeError('');
  };

  const [pixelsPerFrame, setPixelsPerFrame] = useState(DEFAULT_PX_PER_FRAME);
  const [gutterWidth, setGutterWidth] = useState(loadTimelineGutterWidth);
  const [graphViewport, setGraphViewport] = useState<TimelineGraphViewport>({
    left: gutterWidth + 7,
    width: 720,
    scrollLeft: 0,
    pixelsPerFrame: DEFAULT_PX_PER_FRAME,
  });
  const [isGutterResizing, setIsGutterResizing] = useState(false);
  const [trackScalePercent, setTrackScalePercent] = useState(100);
  const [retimePhase, setRetimePhase] = useState<'in' | 'on-air' | 'out' | 'entire'>('in');
  const [retimeTargetFrames, setRetimeTargetFrames] = useState(
    () => animationRetimePhaseRange(composition, 'in').durationFrames,
  );
  const retimePhaseRange = animationRetimePhaseRange(composition, retimePhase);
  const [expandedLayerIds, setExpandedLayerIds] = useState<Set<string>>(() => new Set());
  const [showAllPropertyLayerIds, setShowAllPropertyLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [revealedPropertyTracks, setRevealedPropertyTracks] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [lifecycleDragPreview, setLifecycleDragPreview] = useState<{
    keyframeId: string;
    frame: number;
  } | null>(null);
  const [frameCueSelection, setFrameCueSelection] = useState<{
    context: string;
    id: string;
  } | null>(null);
  const [lifecycleRetimeNotice, setLifecycleRetimeNotice] = useState<{
    message: string;
    warnings: string[];
  } | null>(null);
  const basicRulerInterval = pixelsPerFrame >= 10 ? 5 : pixelsPerFrame >= 6 ? 10 : 20;
  const rulerLabelInterval =
    durationUnit === 'timecode'
      ? Math.max(
          basicRulerInterval,
          Math.ceil(90 / pixelsPerFrame / basicRulerInterval) * basicRulerInterval,
        )
      : basicRulerInterval;

  const keyframeFrames = computeKeyframeFrames(composition);
  navigationKeyframeFramesRef.current = collectTimelineKeyframeFrames(composition);
  const lifecycleFrameSet = new Set(keyframeFrames.map((item) => item.frame));
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
  const soundEvents = (composition.mediaCues ?? []).filter(isSoundEventCue);
  const frameCues = Array.isArray(composition.frameCues) ? composition.frameCues : [];
  const cueEndFrame = keyframeFrames.at(-1)?.frame ?? 0;
  const cueContext = `${projectId}:${composition.id}`;
  const frameCueMarkers = new Map<number, FrameCue[]>();
  for (const cue of frameCues) {
    if (!cue || !Number.isSafeInteger(cue.frame)) continue;
    const frame = Math.min(cueEndFrame, Math.max(0, cue.frame));
    const atFrame = frameCueMarkers.get(frame) ?? [];
    atFrame.push(cue);
    frameCueMarkers.set(frame, atFrame);
  }
  const selectFrameCue = (id: string) => {
    selectLayer(null);
    selectSoundEvent(null);
    setFrameCueSelection({ context: cueContext, id });
  };
  const timelineEntries = buildTimelineEntries(
    layers,
    composition.layout.timelineFolders,
    collapsedFolderIds,
  );
  const folderLayerIds = new Set(
    composition.layout.timelineFolders.flatMap((folder) => folder.layerIds),
  );

  const propertyTrackKey = (layerId: string, property: AnimatableLayerProperty) =>
    `${layerId}:${property}`;
  const visiblePropertiesForLayer = (layer: (typeof composition.layers)[number]) => {
    const allProperties = getLayerAnimatableProperties(layer);
    if (showAllPropertyLayerIds.has(layer.id)) return allProperties;
    const meaningful = new Set(meaningfulTimelineProperties(layer, lifecycleFrameSet));
    return allProperties.filter(
      (property) =>
        meaningful.has(property) ||
        revealedPropertyTracks.has(propertyTrackKey(layer.id, property)) ||
        (selectedLayerId === layer.id && selectedLayerProperty === property),
    );
  };

  const toggleAllProperties = (layerId: string) =>
    setShowAllPropertyLayerIds((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });

  const addVisiblePropertyTrack = (layerId: string, property: AnimatableLayerProperty) => {
    setRevealedPropertyTracks((current) =>
      new Set(current).add(propertyTrackKey(layerId, property)),
    );
    const keyframeId = addLayerPropertyKeyframe(layerId, property, displayedFrame);
    selectLayerKeyframe(layerId, keyframeId, property);
  };

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
  const timelineBodyRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const keySelectionAnchorRef = useRef<SelectedLayerKeyframe | null>(null);

  const activeKeyframeIndex = composition.keyframes.findIndex((k) => k.id === activeKeyframeId);
  const incomingTransition =
    activeKeyframeIndex > 0
      ? composition.transitions.find(
          (t) =>
            t.fromKeyframeId === composition.keyframes[activeKeyframeIndex - 1]!.id &&
            t.toKeyframeId === activeKeyframeId,
        )
      : undefined;
  const selectedLayer = composition.layers.find((layer) => layer.id === selectedLayerId);
  const selectedSoundEvent = selectedLayerId
    ? null
    : (soundEvents.find((cue) => cue.id === selectedSoundEventId) ?? null);
  const selectedFrameCue =
    !selectedLayerId && frameCueSelection?.context === cueContext
      ? (frameCues.find((cue) => cue?.id === frameCueSelection.id) ?? null)
      : null;
  const selectedLayerKeyframe = selectedLayer
    ? timelineLayerKeyframes(selectedLayer).find(
        (keyframe) => keyframe.id === selectedLayerKeyframeId,
      )
    : undefined;
  const selectedPropertyTrack =
    selectedLayer && selectedLayerProperty
      ? (timelineAnimationTracks(selectedLayer)[selectedLayerProperty] ?? [])
      : [];
  const selectedPropertyKeyframe = selectedPropertyTrack.find(
    (keyframe) => keyframe.id === selectedLayerKeyframeId,
  );
  const selectedLoopTrack =
    selectedLayer && selectedLayerProperty
      ? (selectedLayer.loop?.tracks[selectedLayerProperty] ?? [])
      : [];
  const selectedChannelAnimated = selectedPropertyTrack.length > 0 || selectedLoopTrack.length > 0;
  const resetChannelAnimation = (layerId: string, property: AnimatableLayerProperty) => {
    const target = composition.layers.find((item) => item.id === layerId);
    const label = animatablePropertyLabel(property, target);
    try {
      const frame = resetTimelineChannelAnimation(layerId, property);
      setLifecycleRetimeNotice({
        message: `${label} animation reset at frame ${Math.round(frame)}.`,
        warnings: [],
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLifecycleRetimeNotice({ message, warnings: [message] });
    }
  };
  const selectedShaderSpec =
    selectedLayer && selectedLayerProperty
      ? shaderAnimationPropertySpec(selectedLayer.element, selectedLayerProperty)
      : undefined;
  const showKeyEditor = Boolean(
    selectedLayer && (selectedPropertyKeyframe || selectedLayerKeyframe || selectedLayerProperty),
  );
  const showTimelineInspector = showKeyEditor || Boolean(selectedSoundEvent || selectedFrameCue);
  const channelId =
    selectedLayer && selectedLayerProperty ? `${selectedLayer.id}:${selectedLayerProperty}` : null;
  const channelAnimated = selectedPropertyTrack.length > 0;
  const viewSelection = useMemo(
    () => ({ contextId: `${projectId}:${composition.id}`, channelId, animated: channelAnimated }),
    [projectId, composition.id, channelId, channelAnimated],
  );
  const previousViewSelection = useRef(viewSelection);
  const [timelineView, setTimelineView] = useState<TimelineViewMode>(() =>
    viewSelection.animated ? 'graph' : 'keys',
  );
  useEffect(() => {
    const previous = previousViewSelection.current;
    previousViewSelection.current = viewSelection;
    setTimelineView((current) =>
      timelineViewAfterSelectionChange(current, previous, viewSelection),
    );
  }, [viewSelection]);
  const showAnimationGraph = timelineView === 'graph';

  const synchronizeGraphViewport = () => {
    const body = timelineBodyRef.current;
    const tracks = tracksRef.current;
    if (!body || !tracks) return;
    const left =
      tracks.getBoundingClientRect().left - body.getBoundingClientRect().left - body.clientLeft;
    const width = tracks.clientWidth;
    const scrollLeft = tracks.scrollLeft;
    setGraphViewport((current) =>
      current.left === left && current.width === width && current.scrollLeft === scrollLeft
        ? current
        : { ...current, left, width, scrollLeft },
    );
  };
  useLayoutEffect(() => {
    synchronizeGraphViewport();
    const tracks = tracksRef.current;
    const body = timelineBodyRef.current;
    if (!tracks || !body || !window.ResizeObserver) return;
    const observer = new window.ResizeObserver(synchronizeGraphViewport);
    observer.observe(tracks);
    observer.observe(body);
    return () => observer.disconnect();
  }, [window]);

  useLayoutEffect(() => {
    const tracks = tracksRef.current;
    if (!tracks) return;
    tracks.scrollTop = showAnimationGraph ? 0 : (gutterRef.current?.scrollTop ?? 0);
    synchronizeGraphViewport();
  }, [showAnimationGraph]);

  useEffect(() => {
    const handleMotionClipboard = (event: globalThis.KeyboardEvent) => {
      if (!isDomElement(event.target)) return;
      motionClipboard = handleMotionClipboardShortcut(
        event,
        {
          withinTimeline: Boolean(
            panelRef.current?.contains(event.target) ||
            event.target.closest('[role="tab"][data-dock-pane="timeline"][aria-selected="true"]'),
          ),
          editable: Boolean(
            event.target.closest('input, textarea, select, [contenteditable="true"]'),
          ),
        },
        composition,
        selectedLayerKeyframes,
        selectedLayerIds,
        displayedFrame,
        durationFrames,
        motionClipboard,
      );
    };
    window.addEventListener('keydown', handleMotionClipboard, true);
    return () => window.removeEventListener('keydown', handleMotionClipboard, true);
  });

  useEffect(() => {
    if (
      previewLoopLayerId &&
      !composition.layers.some((layer) => layer.id === previewLoopLayerId)
    ) {
      setPreviewLoopLayerId(null);
    }
  }, [composition.layers, previewLoopLayerId, setPreviewLoopLayerId]);

  useEffect(() => {
    if (selectedLayerKeyframes.length === 0) keySelectionAnchorRef.current = null;
    else if (selectedLayerKeyframes.length === 1) {
      keySelectionAnchorRef.current = selectedLayerKeyframes[0]!;
    }
  }, [selectedLayerKeyframes]);

  useEffect(() => {
    try {
      localStorage.setItem(TIMELINE_GUTTER_STORAGE_KEY, String(gutterWidth));
    } catch {
      // Local persistence is optional.
    }
  }, [gutterWidth]);

  useEffect(() => {
    const body = timelineBodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const clampToBody = () =>
      setGutterWidth((current) => clampTimelineGutterWidth(current, body.clientWidth));
    clampToBody();
    const observer = new ResizeObserver(clampToBody);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!lifecycleRetimeNotice) return;
    const timeout = window.setTimeout(
      () => setLifecycleRetimeNotice(null),
      lifecycleRetimeNotice.warnings.length > 0 ? 6000 : 3500,
    );
    return () => window.clearTimeout(timeout);
  }, [lifecycleRetimeNotice, window]);

  const createLoopForSelectedProperty = () => {
    if (!selectedLayer || !selectedLayerProperty || selectedLayer.isLocked) return;
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

  const setClampedGutterWidth = (requested: number) => {
    const bodyWidth = timelineBodyRef.current?.clientWidth ?? 1_200;
    setGutterWidth(clampTimelineGutterWidth(requested, bodyWidth));
  };

  const handleGutterResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = gutterWidth;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    setIsGutterResizing(true);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (handle.hasPointerCapture?.(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
      setIsGutterResizing(false);
    };
    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      setClampedGutterWidth(startWidth + moveEvent.clientX - startX);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const handleGutterResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 10;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setClampedGutterWidth(gutterWidth + (event.key === 'ArrowLeft' ? -step : step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setClampedGutterWidth(MIN_TIMELINE_GUTTER_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setClampedGutterWidth(MAX_TIMELINE_GUTTER_WIDTH);
    }
  };

  const handleScrubPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !controller) return;
    e.preventDefault();
    e.stopPropagation();
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
    if (seekTimelineKeyframeOnSelect(keyframeFrames[keyframeIndex]!.frame, e) !== null)
      clearLayerKeyframe();
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
    const keyframeId = selectedLayerProperty
      ? addLayerPropertyKeyframe(selectedLayerId, selectedLayerProperty, frame)
      : addLayerKeyframe(selectedLayerId, frame, { includeEffects: false });
    selectLayerKeyframe(selectedLayerId, keyframeId, selectedLayerProperty);
    seekTimelineFrame(frame);
  };

  const seekByFrame = (delta: -1 | 1) => {
    stepTimelineFrame(delta);
    const state = useTimelineStore.getState();
    if (state.currentFrame <= 0 || state.currentFrame >= state.durationFrames) {
      // A newly disabled boundary button loses browser focus; keep arrows in the Timeline.
      panelRef.current?.focus({ preventScroll: true });
    }
  };

  const handleLayerKeyframePointerDown = (
    e: ReactPointerEvent,
    layerId: string,
    keyframeId: string,
    startFrame: number,
    property: AnimatableLayerProperty | null = null,
    trackKeyframes: Array<{ id: string; frame: number }> = [],
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const clicked: SelectedLayerKeyframe = { layerId, keyframeId, property };
    const currentSelection = useSelectionStore.getState().selectedLayerKeyframes;
    const alreadySelected = currentSelection.some((selection) =>
      isSameSelectedKey(selection, clicked),
    );
    const additive = e.ctrlKey || e.metaKey;
    const anchor = keySelectionAnchorRef.current;
    let nextSelection: SelectedLayerKeyframe[];

    if (e.shiftKey && anchor && isSameKeyTrack(anchor, clicked)) {
      const ordered = [...trackKeyframes].sort((left, right) => left.frame - right.frame);
      const anchorIndex = ordered.findIndex((keyframe) => keyframe.id === anchor.keyframeId);
      const clickedIndex = ordered.findIndex((keyframe) => keyframe.id === keyframeId);
      const range =
        anchorIndex >= 0 && clickedIndex >= 0
          ? ordered
              .slice(Math.min(anchorIndex, clickedIndex), Math.max(anchorIndex, clickedIndex) + 1)
              .map((keyframe) => ({ layerId, keyframeId: keyframe.id, property }))
          : [clicked];
      nextSelection = additive ? [...currentSelection, ...range] : range;
    } else if (additive) {
      nextSelection = alreadySelected
        ? currentSelection.filter((selection) => !isSameSelectedKey(selection, clicked))
        : [...currentSelection, clicked];
      keySelectionAnchorRef.current = clicked;
    } else if (!additive && alreadySelected) {
      // Preserve the complete selection on pointer-down so dragging any selected key moves all.
      nextSelection = currentSelection;
      keySelectionAnchorRef.current = clicked;
    } else {
      nextSelection = [clicked];
      keySelectionAnchorRef.current = clicked;
    }
    selectLayerKeyframes(
      nextSelection,
      nextSelection.some((key) => isSameSelectedKey(key, clicked)) ? clicked : null,
    );
    if (!nextSelection.some((selection) => isSameSelectedKey(selection, clicked))) return;
    seekTimelineKeyframeOnSelect(startFrame, e);
    if (composition.layers.find((layer) => layer.id === layerId)?.isLocked) return;
    const startX = e.clientX;
    let isDragging = false;
    let appliedDelta = 0;
    const pointerTarget = e.currentTarget as HTMLElement;
    pointerTarget.setPointerCapture?.(e.pointerId);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cleanup);
      if (pointerTarget.hasPointerCapture?.(e.pointerId)) {
        pointerTarget.releasePointerCapture(e.pointerId);
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!isDragging && !isTimelineKeyDrag(startX, event.clientX)) return;
      isDragging = true;
      event.preventDefault();
      const requestedDelta = Math.round((event.clientX - startX) / pixelsPerFrame);
      const incrementalDelta = requestedDelta - appliedDelta;
      const movedDelta = moveTimelineKeyframesTogether(nextSelection, incrementalDelta);
      appliedDelta += movedDelta;
      useTimelineStore.getState().controller?.seek(startFrame + appliedDelta);
    };
    const onUp = () => {
      cleanup();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
  };

  const handleTrackContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    layerId: string,
    property?: AnimatableLayerProperty,
    targetFrame?: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const frame = targetFrame ?? Math.min(durationFrames, frameFromClientX(event.clientX));
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    const keyframe = layer
      ? property
        ? timelineAnimationTracks(layer)[property]?.find((candidate) => candidate.frame === frame)
        : timelineLayerKeyframes(layer).find((key) => key.frame === frame)
      : undefined;
    if (property) {
      // Channel actions sample the current playhead. A context click only chooses the target
      // channel and the insertion/deletion frame; it must not silently move that playhead.
      selectLayerProperty(layerId, property);
    } else {
      if (keyframe) selectLayerKeyframe(layerId, keyframe.id);
      else if (!selectedLayerIds.includes(layerId)) selectLayer(layerId);
      controller?.seek(frame);
    }
    setFrameMenu({ x: event.clientX, y: event.clientY, layerId, frame, property });
  };

  const handleSoundEventPointerDown = (event: ReactPointerEvent<HTMLElement>, cue: MediaCue) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer(null);
    setFrameCueSelection(null);
    selectSoundEvent(cue.id);
    const startX = event.clientX;
    const initialFrame = mediaCueStartFrame(cue, composition) ?? 0;
    const pointerTarget = event.currentTarget;
    pointerTarget.setPointerCapture?.(event.pointerId);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (pointerTarget.hasPointerCapture?.(event.pointerId)) {
        pointerTarget.releasePointerCapture(event.pointerId);
      }
    };
    const onMove = (pointer: PointerEvent) => {
      const deltaFrames = Math.round((pointer.clientX - startX) / pixelsPerFrame);
      updateMediaCue(cue.id, {
        trigger: {
          type: 'timeline',
          startFrame: Math.max(0, Math.min(durationFrames, initialFrame + deltaFrames)),
        },
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const handleAudioDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('application/x-ograf-audio-asset-id'))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleAudioDrop = (event: ReactDragEvent<HTMLElement>) => {
    const assetId = event.dataTransfer.getData('application/x-ograf-audio-asset-id');
    if (!assetId) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = Math.max(0, Math.min(durationFrames, frameFromClientX(event.clientX)));
    const cueId = addSoundEventFromAsset(assetId, frame);
    selectLayer(null);
    selectSoundEvent(cueId);
    controller?.seek(frame);
  };

  const frameMenuLayer = frameMenu
    ? composition.layers.find((layer) => layer.id === frameMenu.layerId)
    : undefined;
  const frameMenuKeyframe =
    frameMenu && frameMenuLayer && !frameMenu.property
      ? timelineLayerKeyframes(frameMenuLayer).find((key) => key.frame === frameMenu.frame)
      : undefined;
  const frameMenuPropertyKeyframe =
    frameMenu?.property && frameMenuLayer
      ? timelineAnimationTracks(frameMenuLayer)[frameMenu.property]?.find(
          (candidate) => candidate.frame === frameMenu.frame,
        )
      : undefined;
  const folderMenuFolder = folderMenu
    ? composition.layout.timelineFolders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;

  if (viewMode === 'design')
    return (
      <Panel title="Timeline" style={style}>
        <div
          ref={panelRef}
          className="timeline-design-bar"
          role="region"
          aria-label="Timeline in Design view"
        >
          <span>Design · showing the first on-air Step</span>
          <button type="button" onClick={() => useCanvasViewStore.getState().setMode('animate')}>
            Open animation timeline
          </button>
        </div>
      </Panel>
    );

  return (
    <Panel title="Timeline" style={style}>
      <div
        ref={panelRef}
        className={`timeline-panel${showTimelineInspector ? ' has-key-editor' : ''}${showAnimationGraph ? ' has-animation-graph' : ''}`}
        role="region"
        aria-label="Timeline editor"
        aria-keyshortcuts="Space ArrowLeft ArrowRight Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight"
        tabIndex={0}
        onPointerDownCapture={(event) => {
          if (
            event.button !== 0 ||
            !isDomElement(event.target) ||
            timelineTargetOwnsArrows(event.target)
          )
            return;
          const focusTarget = event.target.closest<HTMLElement>('button, a[href], [tabindex]');
          // Key selection runs on pointer-down before the browser focuses the key. Do not fire
          // its onFocus selection handler early (that would discard Ctrl/Shift selections).
          if (focusTarget?.classList.contains('timeline-keyframe-dot')) {
            event.currentTarget.focus({ preventScroll: true });
            return;
          }
          if (focusTarget instanceof HTMLButtonElement && focusTarget.disabled)
            event.currentTarget.focus({ preventScroll: true });
          else (focusTarget ?? event.currentTarget).focus({ preventScroll: true });
        }}
      >
        {shortOutAssessment?.reason && (
          <div role="status" style={{ padding: '4px 8px', color: '#ffbe68', fontSize: 11 }}>
            Short Out unavailable: {shortOutAssessment.reason} The authored Out timing will be used.
          </div>
        )}
        <div className="timeline-toolbar">
          <label title="Use the short Out only if the skipped timeline interval is proven static; otherwise retain the authored duration and show a warning.">
            <input
              type="checkbox"
              checked={composition.shortOutFrames !== undefined}
              onChange={(event) =>
                runDiscreteHistoryStep(
                  () =>
                    useProjectStore.getState().updateCompositionSettings({
                      shortOutFrames: event.currentTarget.checked
                        ? Math.max(1, Math.round(composition.frameRate * 0.5))
                        : undefined,
                    }),
                  'Change short Out',
                )
              }
            />{' '}
            Short Out
          </label>
          <div className="timeline-transport" role="group" aria-label="Timeline playback">
            <button
              type="button"
              className="timeline-transport-button frame-step"
              aria-label="Previous frame"
              aria-keyshortcuts="ArrowLeft"
              title="Previous frame (←) · Previous keyframe (Ctrl/Cmd+←)"
              onClick={() => seekByFrame(-1)}
              disabled={!controller || displayedFrame <= 0}
            >
              <TransportIcon name="previous" />
              <span aria-hidden="true">−1f</span>
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
              className="timeline-transport-button frame-step"
              aria-label="Next frame"
              aria-keyshortcuts="ArrowRight"
              title="Next frame (→) · Next keyframe (Ctrl/Cmd+→)"
              onClick={() => seekByFrame(1)}
              disabled={!controller || displayedFrame >= durationFrames}
            >
              <span aria-hidden="true">+1f</span>
              <TransportIcon name="next" />
            </button>
          </div>

          <div
            className="timeline-toolbar-section timeline-playback-options"
            role="group"
            aria-label="Playback and authoring modes"
          >
            <label
              className="timeline-step-playback-toggle"
              title="Optional playout rehearsal: stop at each OGraf Step and press Play to continue. Leave off to preview animation continuously."
            >
              <input
                type="checkbox"
                checked={pauseAtOgrafSteps}
                onChange={(event) => setPauseAtOgrafSteps(event.target.checked)}
              />
              <span>Stop at Steps</span>
            </label>

            <label
              className="timeline-step-playback-toggle"
              title="Automatically start animating static properties when edited. Existing animation follows the Edit scope in Properties."
            >
              <input
                type="checkbox"
                checked={autoKeyframe}
                onChange={(event) => setAutoKeyframe(event.target.checked)}
              />
              <span>Auto-keyframe</span>
            </label>
          </div>

          <div className="timeline-readout" aria-label="Timeline position and duration">
            <input
              className="timeline-current-time"
              aria-label="Current time"
              aria-invalid={Boolean(timeError)}
              aria-describedby={timeError ? 'timeline-time-error' : undefined}
              title="Current time. Enter seconds, milliseconds, frames or timecode, then press Enter."
              type="text"
              inputMode="decimal"
              value={timeDraft}
              disabled={!controller}
              onFocus={() => controller?.pause()}
              onChange={(event) => {
                setTimeDraft(event.currentTarget.value);
                setTimeError('');
              }}
              onBlur={commitTimeDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelTimeDraft.current = true;
                  setTimeDraft(displayedTime);
                  setTimeError('');
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="timeline-readout-divider">/</span>
            <strong>{durationFrames} f</strong>
            <span className="timeline-readout-separator">·</span>
            <strong className="timeline-readout-duration">{duration}</strong>
          </div>
          <TimelineDisplayUnits />

          <div
            className="timeline-toolbar-section timeline-mode-section"
            role="group"
            aria-label="Timeline display"
          >
            <div className="timeline-view-toggle">
              <button
                type="button"
                aria-pressed={timelineView === 'keys'}
                onClick={() => setTimelineView('keys')}
                title="Show keyframe tracks"
              >
                Keys
              </button>
              <button
                type="button"
                aria-pressed={timelineView === 'graph'}
                onClick={() => setTimelineView('graph')}
                title="Show the selected property's value graph"
              >
                Graph
              </button>
            </div>
          </div>

          <div
            className="timeline-toolbar-section timeline-keying-section"
            role="group"
            aria-label="Create timeline keys"
          >
            <span className="timeline-toolbar-section-label is-titlecase">Keys</span>
            <div className="timeline-edit-controls">
              <button
                type="button"
                onClick={handleAddKeyframe}
                title="Add an OGraf playout Step before the final Out"
              >
                {'+ Step'}
              </button>
              <button
                type="button"
                aria-label="Add cue at playhead"
                title="Add a named real-time cue at the playhead"
                disabled={frameCues.length >= MAX_FRAME_CUES}
                onClick={() => {
                  try {
                    const id = runDiscreteHistoryStep(
                      () => addFrameCue(displayedFrame),
                      'Add frame cue',
                    );
                    selectFrameCue(id);
                  } catch (cause) {
                    const message = cause instanceof Error ? cause.message : String(cause);
                    setLifecycleRetimeNotice({ message, warnings: [message] });
                  }
                }}
              >
                + Cue
              </button>
              <button
                type="button"
                onClick={handleAddLayerKeyframe}
                disabled={!selectedLayerId || selectedLayer?.isLocked}
                title={
                  selectedLayerProperty
                    ? `Add a ${animatablePropertyLabel(selectedLayerProperty, selectedLayer)} key at the current time. Auto-keyframe is not required.`
                    : "Capture all of this layer's transform properties at the current time. Auto-keyframe is not required."
                }
              >
                {selectedLayerProperty
                  ? `◆ Add ${animatablePropertyLabel(selectedLayerProperty, selectedLayer)} key`
                  : '◆ Key transform'}
              </button>
            </div>
          </div>
          <div
            className="timeline-toolbar-section timeline-retime-section"
            role="group"
            aria-label="Retime animation phase"
          >
            <span className="timeline-toolbar-section-label is-titlecase">Length</span>
            <div className="timeline-retime-controls">
              <select
                aria-label="Part of the animation to set the length of"
                value={retimePhase}
                onChange={(event) => {
                  const phase = event.target.value as typeof retimePhase;
                  setRetimePhase(phase);
                  setRetimeTargetFrames(
                    animationRetimePhaseRange(composition, phase).durationFrames,
                  );
                }}
              >
                <option value="in">In</option>
                <option value="on-air">On air</option>
                <option value="out">Out</option>
                <option value="entire">Whole graphic</option>
              </select>
              <FrameDurationControl
                label="New length"
                frames={retimeTargetFrames}
                frameRate={composition.frameRate}
                minFrames={retimePhaseRange.retimable ? retimePhaseRange.transitionCount : 0}
                compact
                onChange={setRetimeTargetFrames}
              />
              <button
                type="button"
                disabled={!retimePhaseRange.retimable}
                title={
                  retimePhaseRange.retimable
                    ? `Stretch this part from ${retimePhaseRange.durationFrames} to ${retimeTargetFrames} frames`
                    : 'This part has no length to change yet'
                }
                onClick={() => {
                  try {
                    const result = retimeAnimationPhase(retimePhase, retimeTargetFrames);
                    setLifecycleRetimeNotice({
                      message: `Length set to ${retimeTargetFrames} frames · ${result.retimedKeys} keys moved`,
                      warnings: [],
                    });
                  } catch (cause) {
                    setLifecycleRetimeNotice({
                      message: cause instanceof Error ? cause.message : String(cause),
                      warnings: [cause instanceof Error ? cause.message : String(cause)],
                    });
                  }
                }}
              >
                Set length
              </button>
            </div>
          </div>
          <div
            className="timeline-toolbar-section timeline-view-section"
            role="group"
            aria-label="Timeline view"
          >
            <span className="timeline-toolbar-section-label is-titlecase">View</span>
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
          </div>
          {incomingTransition && (
            <div
              className="timeline-toolbar-section timeline-transition-section"
              role="group"
              aria-label="Incoming transition"
            >
              <span className="timeline-toolbar-section-label">Transition</span>
              <div className="timeline-transition-controls">
                <FrameDurationControl
                  compact
                  label="Incoming lifecycle transition"
                  frames={incomingTransition.durationFrames}
                  frameRate={composition.frameRate}
                  minFrames={MIN_TRANSITION_FRAMES}
                  onChange={(durationFrames) =>
                    updateTransition(incomingTransition.id, { durationFrames })
                  }
                />
                <EasingPicker
                  label="Lifecycle transition easing"
                  value={incomingTransition.easing}
                  onChange={(easing) => updateTransition(incomingTransition.id, { easing })}
                />
              </div>
            </div>
          )}
        </div>

        {timeError && (
          <div id="timeline-time-error" className="timeline-time-error" role="alert">
            {timeError}
          </div>
        )}

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

        <div
          className={`timeline-body${isGutterResizing ? ' resizing-gutter' : ''}`}
          ref={timelineBodyRef}
        >
          <div className="timeline-gutter" ref={gutterRef} style={{ width: gutterWidth }}>
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
                        {collapsed ? '+' : '-'}
                      </button>
                      {editingFolderId === folder.id ? (
                        <input
                          autoFocus
                          className="timeline-folder-rename"
                          aria-label={`Rename timeline group ${folder.name}`}
                          value={editingFolderName}
                          onFocus={(event) => event.currentTarget.select()}
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
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
                          aria-label={`Select timeline group ${folder.name}`}
                          aria-pressed={allSelected}
                          title={`${folder.name} · Click selects layers · Double-click renames`}
                          onClick={(event) => {
                            if (event.detail > 1) return;
                            if (event.ctrlKey || event.metaKey) {
                              toggleManyLayerSelection(folder.layerIds);
                            } else {
                              selectManyLayers(folder.layerIds);
                            }
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            beginFolderRename(folder.id, folder.name);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'F2') return;
                            event.preventDefault();
                            beginFolderRename(folder.id, folder.name);
                          }}
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
                const allProperties = getLayerAnimatableProperties(layer);
                const visibleProperties = visiblePropertiesForLayer(layer);
                const hiddenProperties = allProperties.filter(
                  (property) => !visibleProperties.includes(property),
                );
                const style = {
                  '--layer-color': TIMELINE_LAYER_TRACK_COLOR,
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
                      {expanded ? '-' : '+'}
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
                    {expanded && (
                      <div className="timeline-property-visibility-controls">
                        <select
                          className="timeline-property-add"
                          aria-label={`Add property track for ${layer.name}`}
                          title="Add a property key at the current time"
                          value=""
                          disabled={layer.isLocked || hiddenProperties.length === 0}
                          onChange={(event) =>
                            addVisiblePropertyTrack(
                              layer.id,
                              event.target.value as AnimatableLayerProperty,
                            )
                          }
                        >
                          <option value="" disabled>
                            +
                          </option>
                          {groupedAnimationProperties(hiddenProperties).map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.properties.map((property) => (
                                <option key={property} value={property}>
                                  {animatablePropertyLabel(property, layer)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="timeline-show-all-properties"
                          aria-label={`${showAllPropertyLayerIds.has(layer.id) ? 'Show active' : 'Show all'} properties for ${layer.name}`}
                          aria-pressed={showAllPropertyLayerIds.has(layer.id)}
                          title={
                            showAllPropertyLayerIds.has(layer.id)
                              ? 'Show meaningful and added properties only'
                              : 'Show all compatible properties'
                          }
                          onClick={() => toggleAllProperties(layer.id)}
                        >
                          {showAllPropertyLayerIds.has(layer.id) ? 'Active' : 'All'}
                        </button>
                      </div>
                    )}
                  </div>,
                  ...(expanded
                    ? visibleProperties.map((property) => (
                        <button
                          type="button"
                          className={`timeline-property-gutter-row${selectedLayerId === layer.id && selectedLayerProperty === property ? ' selected' : ''}`}
                          key={`${layer.id}:${property}`}
                          style={
                            {
                              '--layer-color': timelineTrackColorForProperty(property),
                            } as LayerColorStyle
                          }
                          onClick={() => {
                            selectLayerProperty(layer.id, property);
                            if ((timelineAnimationTracks(layer)[property]?.length ?? 0) > 0)
                              setTimelineView('graph');
                          }}
                          onContextMenu={(event) =>
                            handleTrackContextMenu(event, layer.id, property, displayedFrame)
                          }
                          title={`${layer.name} ${animatablePropertyLabel(property, layer)}`}
                        >
                          <span>{animatablePropertyLabel(property, layer)}</span>
                        </button>
                      ))
                    : []),
                ];
              })
            )}
          </div>

          <div
            className="timeline-gutter-resize-handle"
            role="separator"
            aria-label="Resize timeline layer names and keyframe tracks"
            aria-orientation="vertical"
            aria-valuemin={MIN_TIMELINE_GUTTER_WIDTH}
            aria-valuemax={MAX_TIMELINE_GUTTER_WIDTH}
            aria-valuenow={gutterWidth}
            tabIndex={0}
            title="Drag to resize layer names · Double-click to reset"
            onPointerDown={handleGutterResizePointerDown}
            onKeyDown={handleGutterResizeKeyDown}
            onDoubleClick={() => setClampedGutterWidth(DEFAULT_TIMELINE_GUTTER_WIDTH)}
          />

          <div
            className="timeline-tracks"
            ref={tracksRef}
            onScroll={() => {
              synchronizeGraphViewport();
              if (!showAnimationGraph && gutterRef.current && tracksRef.current) {
                gutterRef.current.scrollTop = tracksRef.current.scrollTop;
              }
            }}
          >
            <div
              className="timeline-content"
              style={{
                width: contentWidth,
                backgroundImage: showAnimationGraph
                  ? undefined
                  : `repeating-linear-gradient(to right, #2b2c33 0, #2b2c33 1px, transparent 1px, transparent ${pixelsPerFrame}px)`,
              }}
            >
              {!showAnimationGraph && (
                <div className="timeline-gridlines">
                  {displayedKeyframeFrames.map(({ keyframeId, frame }) => (
                    <div
                      key={keyframeId}
                      className="timeline-gridline"
                      style={{ left: frame * pixelsPerFrame }}
                    />
                  ))}
                </div>
              )}

              <div
                className={`timeline-ruler${isScrubbing ? ' scrubbing' : ''}${frameCueMarkers.size ? ' has-frame-cues' : ''}`}
                ref={rulerRef}
                onPointerDown={handleScrubPointerDown}
                onDragOver={handleAudioDragOver}
                onDrop={handleAudioDrop}
              >
                {rulerTicks.map((frame) => (
                  <span
                    key={frame}
                    className="timeline-ruler-tick"
                    style={{ left: frame * pixelsPerFrame }}
                  >
                    {durationUnit === 'frames'
                      ? frame
                      : formatDurationInput(frame, composition.frameRate, durationUnit)}
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
                      aria-label={`${lifecycleLabel(keyframe, composition.keyframes)} at frame ${frame}${loopDescription}`}
                      data-timeline-tooltip={`${lifecycleLabel(keyframe, composition.keyframes)} · frame ${frame} · Click selects and seeks${keyframe.role === 'start' ? ' · Before is fixed' : ' · Drag or Alt+Left/Right to move · Shift+double-click renames'}${loopDescription}`}
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
                          clearLayerKeyframe();
                          seekTimelineFrame(frame);
                          return;
                        }
                        if (
                          i > 0 &&
                          event.altKey &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                        ) {
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
                            data-timeline-tooltip={loopDescription.slice(3)}
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
                      ) : null}
                    </div>
                  );
                })}
                {soundEvents.map((cue, index) => {
                  const frame = mediaCueStartFrame(cue, composition) ?? 0;
                  const stackIndex = soundEvents
                    .slice(0, index)
                    .filter(
                      (candidate) => mediaCueStartFrame(candidate, composition) === frame,
                    ).length;
                  const source = soundEventSource(cue);
                  return (
                    <button
                      type="button"
                      key={cue.id}
                      className={`timeline-sound-event-marker${selectedSoundEvent?.id === cue.id ? ' selected' : ''}`}
                      style={
                        {
                          left: frame * pixelsPerFrame,
                          '--sound-event-stack': stackIndex,
                        } as CSSProperties
                      }
                      aria-label={`${cue.name} sound event at frame ${frame}`}
                      title={`${source?.name ?? cue.name} · frame ${frame} · Drag to retime`}
                      onPointerDown={(event) => handleSoundEventPointerDown(event, cue)}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectLayer(null);
                        setFrameCueSelection(null);
                        selectSoundEvent(cue.id);
                      }}
                    >
                      <span aria-hidden="true">🔊</span>
                      {stackIndex > 0 ? <small>{stackIndex + 1}</small> : null}
                    </button>
                  );
                })}
                {[...frameCueMarkers].map(([frame, cues]) => {
                  const cue =
                    cues.find((candidate) => candidate.id === selectedFrameCue?.id) ?? cues[0]!;
                  return (
                    <button
                      type="button"
                      key={frame}
                      className="timeline-frame-cue-marker"
                      style={{ left: frame * pixelsPerFrame }}
                      aria-label={`Frame cue ${cue.name} at frame ${cue.frame}`}
                      aria-pressed={cue.id === selectedFrameCue?.id}
                      title={cues.map((item) => `${item.name} · frame ${item.frame}`).join('\n')}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectFrameCue(cue.id);
                        seekTimelineFrame(frame);
                      }}
                    >
                      <span aria-hidden="true">⚑{cues.length > 1 ? ` ${cues.length}` : ''}</span>
                    </button>
                  );
                })}
              </div>

              {showAnimationGraph ? (
                <div className="timeline-graph-view" style={{ width: graphViewport.width }}>
                  {selectedLayer && selectedLayerProperty ? (
                    <AnimationGraphEditor
                      layer={selectedLayer}
                      property={selectedLayerProperty}
                      durationFrames={durationFrames}
                      viewport={{ ...graphViewport, left: 0, pixelsPerFrame }}
                      ticks={rulerTicks}
                      lifecycleFrames={displayedKeyframeFrames.map((key) => key.frame)}
                      currentFrame={displayedFrame}
                    />
                  ) : (
                    <section className="animation-graph-editor timeline-graph-empty" role="status">
                      Select a property to view and edit its graph. Use Keys to return to keyframes.
                    </section>
                  )}
                </div>
              ) : (
                timelineEntries.flatMap((entry) => {
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
                    '--layer-color': TIMELINE_LAYER_TRACK_COLOR,
                  } as LayerColorStyle;
                  const layerLoopBadge = loopBadgeByLayerId.get(layer.id);
                  const orderedKeys = [...timelineLayerKeyframes(layer)].sort(
                    (a, b) => a.frame - b.frame,
                  );
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
                            data-timeline-tooltip={`${layer.name} · ${fromKeyframe.frame}–${toKeyframe.frame} · ${spanFrames} frames · ${easingLabel(toKeyframe.easing)}`}
                          ></div>
                        );
                      })}
                      {orderedKeys.map((keyframe) => {
                        const hasLoopBadge = layerLoopBadge?.frame === keyframe.frame;
                        const keySelection = {
                          layerId: layer.id,
                          keyframeId: keyframe.id,
                          property: null,
                        };
                        const keyIsSelected = selectedLayerKeyframes.some((selection) =>
                          isSameSelectedKey(selection, keySelection),
                        );
                        const loopTitle = hasLoopBadge
                          ? layerLoopBadge.activation === 'lifecycle'
                            ? ' · Loop begins here and remains active while on-air'
                            : ' · Loop active at this Step'
                          : '';
                        return (
                          <div
                            key={keyframe.id}
                            className={`timeline-keyframe-dot${keyIsSelected ? ' active' : ''}${hasLoopBadge ? ' has-loop' : ''}`}
                            style={{ left: keyframe.frame * pixelsPerFrame }}
                            role="button"
                            tabIndex={0}
                            aria-label={`${layer.name} key at frame ${keyframe.frame}${loopTitle}`}
                            data-timeline-tooltip={`${layer.name} · frame ${keyframe.frame} · Click selects and seeks · Ctrl/Cmd-click adds · Shift-click selects range · Drag or Alt+Left/Right moves selection${loopTitle}`}
                            onFocus={() => {
                              if (
                                !useSelectionStore
                                  .getState()
                                  .selectedLayerKeyframes.some((selection) =>
                                    isSameSelectedKey(selection, keySelection),
                                  )
                              ) {
                                selectLayerKeyframe(layer.id, keyframe.id);
                              }
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              controller?.seek(keyframe.frame);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                selectLayerKeyframe(layer.id, keyframe.id);
                                seekTimelineFrame(keyframe.frame);
                                return;
                              }
                              if (layer.isLocked) return;
                              if (
                                event.altKey &&
                                !event.ctrlKey &&
                                !event.metaKey &&
                                (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                              ) {
                                event.preventDefault();
                                const selected = useSelectionStore
                                  .getState()
                                  .selectedLayerKeyframes.filter((selection) =>
                                    isSameKeyTrack(selection, keySelection),
                                  );
                                if (
                                  selected.some((selection) =>
                                    isSameSelectedKey(selection, keySelection),
                                  )
                                ) {
                                  moveTimelineKeyframesTogether(
                                    useSelectionStore.getState().selectedLayerKeyframes,
                                    event.key === 'ArrowLeft' ? -1 : 1,
                                  );
                                } else {
                                  moveLayerKeyframe(
                                    layer.id,
                                    keyframe.id,
                                    keyframe.frame + (event.key === 'ArrowLeft' ? -1 : 1),
                                  );
                                }
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
                                null,
                                orderedKeys,
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
                  const tracks = timelineAnimationTracks(layer);
                  const propertyRows = visiblePropertiesForLayer(layer).map((property) => {
                    const propertyKeys = [...(tracks[property] ?? [])].sort(
                      (a, b) => a.frame - b.frame,
                    );
                    const propertyLoopBadgeFrame = layerLoopBadge?.properties.includes(property)
                      ? layerLoopBadge.frame
                      : undefined;
                    const propertyLoopTitle =
                      propertyLoopBadgeFrame === undefined
                        ? ''
                        : `${animatablePropertyLabel(property, layer)} loop activates at frame ${propertyLoopBadgeFrame}`;
                    return (
                      <div
                        className={`timeline-track timeline-property-track${selectedLayerId === layer.id && selectedLayerProperty === property ? ' selected' : ''}`}
                        key={`${layer.id}:${property}`}
                        style={
                          {
                            '--layer-color': timelineTrackColorForProperty(property),
                          } as LayerColorStyle
                        }
                        onPointerDown={() => {
                          selectLayerProperty(layer.id, property);
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
                              data-timeline-tooltip={`${layer.name} · ${animatablePropertyLabel(property, layer)} · ${fromKeyframe.frame}–${toKeyframe.frame} · ${spanFrames} frames · ${easingLabel(toKeyframe.easing)}`}
                            ></div>
                          );
                        })}
                        {propertyKeys.map((keyframe) => {
                          const hasLoopBadge = propertyLoopBadgeFrame === keyframe.frame;
                          const keySelection = {
                            layerId: layer.id,
                            keyframeId: keyframe.id,
                            property,
                          };
                          const keyIsSelected = selectedLayerKeyframes.some((selection) =>
                            isSameSelectedKey(selection, keySelection),
                          );
                          return (
                            <div
                              key={keyframe.id}
                              className={`timeline-keyframe-dot property${keyIsSelected ? ' active' : ''}${hasLoopBadge ? ' has-loop' : ''}`}
                              style={{ left: keyframe.frame * pixelsPerFrame }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${animatablePropertyLabel(property, layer)} key at frame ${keyframe.frame}${hasLoopBadge ? ' · Loop activates here' : ''}`}
                              data-timeline-tooltip={`${animatablePropertyLabel(property, layer)} · frame ${keyframe.frame} · value ${keyframe.value.toFixed(3)} · Ctrl/Cmd-click adds · Shift-click selects range · Drag or Alt+Left/Right moves selection${hasLoopBadge ? ' · Loop activates here' : ''}`}
                              onFocus={() => {
                                if (
                                  !useSelectionStore
                                    .getState()
                                    .selectedLayerKeyframes.some((selection) =>
                                      isSameSelectedKey(selection, keySelection),
                                    )
                                ) {
                                  selectLayerKeyframe(layer.id, keyframe.id, property);
                                }
                              }}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                controller?.seek(keyframe.frame);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  selectLayerKeyframe(layer.id, keyframe.id, property);
                                  seekTimelineFrame(keyframe.frame);
                                  return;
                                }
                                if (layer.isLocked) return;
                                if (
                                  event.altKey &&
                                  !event.ctrlKey &&
                                  !event.metaKey &&
                                  (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                                ) {
                                  event.preventDefault();
                                  const selected = useSelectionStore
                                    .getState()
                                    .selectedLayerKeyframes.filter((selection) =>
                                      isSameKeyTrack(selection, keySelection),
                                    );
                                  if (
                                    selected.some((selection) =>
                                      isSameSelectedKey(selection, keySelection),
                                    )
                                  ) {
                                    moveTimelineKeyframesTogether(
                                      useSelectionStore.getState().selectedLayerKeyframes,
                                      event.key === 'ArrowLeft' ? -1 : 1,
                                    );
                                  } else {
                                    moveLayerPropertyKeyframe(
                                      layer.id,
                                      property,
                                      keyframe.id,
                                      keyframe.frame + (event.key === 'ArrowLeft' ? -1 : 1),
                                    );
                                  }
                                } else if (
                                  (event.key === 'Delete' || event.key === 'Backspace') &&
                                  (propertyKeys.length > 1 ||
                                    !!parseShaderAnimationProperty(property))
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
                                  propertyKeys,
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
                              data-timeline-tooltip={propertyLoopTitle}
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
                })
              )}

              {!showAnimationGraph &&
                displayedKeyframeFrames.slice(1).map(({ keyframeId, frame }, offset) => {
                  const keyframeIndex = offset + 1;
                  const keyframe = composition.keyframes[keyframeIndex]!;
                  const committedFrame = keyframeFrames[keyframeIndex]?.frame ?? frame;
                  return (
                    <button
                      type="button"
                      key={`lifecycle-line:${keyframeId}`}
                      className={`timeline-lifecycle-dragline ${keyframe.role}${keyframe.id === activeKeyframeId ? ' active' : ''}`}
                      style={{ left: frame * pixelsPerFrame }}
                      aria-label={`${lifecycleLabel(keyframe, composition.keyframes)} at frame ${frame}. Drag or use Alt+Left/Right to move.`}
                      data-timeline-tooltip={`${lifecycleLabel(keyframe, composition.keyframes)} · frame ${frame} · Click selects and seeks · Drag moves`}
                      onPointerDown={(event) =>
                        handleKeyframeMarkerPointerDown(event, keyframeIndex)
                      }
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        controller?.seek(frame);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          setActiveKeyframe(keyframe.id);
                          clearLayerKeyframe();
                          seekTimelineFrame(frame);
                          return;
                        }
                        if (
                          !event.altKey ||
                          event.ctrlKey ||
                          event.metaKey ||
                          (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                        )
                          return;
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
                  data-timeline-tooltip={`Frame ${displayedFrame} · Drag to scrub`}
                  onPointerDown={handleScrubPointerDown}
                />
              </div>
            </div>
          </div>
        </div>
        {selectedFrameCue ? (
          <CollapsibleSection
            sectionId="timeline.frame-cue-editor"
            title="Frame Cue"
            className="timeline-key-editor"
          >
            <FrameCueEditor
              cue={selectedFrameCue}
              cues={frameCues}
              endFrame={cueEndFrame}
              onSelect={selectFrameCue}
              onDelete={() => setFrameCueSelection(null)}
            />
          </CollapsibleSection>
        ) : selectedSoundEvent ? (
          <CollapsibleSection
            sectionId="timeline.sound-event-editor"
            title="Sound Event"
            className="timeline-key-editor"
          >
            <SoundEventEditor cue={selectedSoundEvent} />
          </CollapsibleSection>
        ) : showKeyEditor ? (
          <CollapsibleSection
            sectionId="timeline.key-editor"
            title="Keyframe editor"
            className="timeline-key-editor"
          >
            {selectedLayer && selectedLayerProperty && (
              <div className="timeline-channel-actions">
                <button
                  type="button"
                  className="timeline-channel-reset"
                  disabled={selectedLayer.isLocked || !selectedChannelAnimated}
                  title="Keep the value at the current playhead and remove this channel's main-timeline and local-loop animation. Other channels stay unchanged."
                  onClick={() => resetChannelAnimation(selectedLayer.id, selectedLayerProperty)}
                >
                  Reset {animatablePropertyLabel(selectedLayerProperty, selectedLayer)} animation
                </button>
              </div>
            )}
            {selectedLayerKeyframes.length > 1 && (
              <div className="timeline-multi-key-selection" role="status">
                <strong>{selectedLayerKeyframes.length} keys selected</strong>
                <span>Drag any selected key or use Alt+←/→ to move them together.</span>
              </div>
            )}
            {selectedLayer && (selectedPropertyKeyframe || selectedLayerKeyframe) && (
              <div className="timeline-layer-key-controls">
                <div className="timeline-key-editor-selection">
                  <strong>{selectedLayer.name}</strong>
                  <span>
                    {selectedLayerProperty
                      ? animatablePropertyLabel(selectedLayerProperty, selectedLayer)
                      : 'Layer transform'}
                    {' · frame '}
                    {(selectedPropertyKeyframe ?? selectedLayerKeyframe)!.frame}
                  </span>
                </div>
                {selectedPropertyKeyframe && selectedLayerProperty && (
                  <label>
                    Value
                    {selectedShaderSpec?.glslType === 'bool' ? (
                      <select
                        aria-label="Selected key value"
                        value={selectedPropertyKeyframe.value}
                        onChange={(event) =>
                          updateLayerPropertyKeyframeValue(
                            selectedLayer.id,
                            selectedLayerProperty,
                            selectedPropertyKeyframe.id,
                            Number(event.target.value),
                          )
                        }
                      >
                        <option value={0}>Off</option>
                        <option value={1}>On</option>
                      </select>
                    ) : (
                      <input
                        aria-label="Selected key value"
                        type="number"
                        step={selectedShaderSpec?.step ?? 'any'}
                        min={selectedShaderSpec?.min}
                        max={selectedShaderSpec?.max}
                        value={selectedPropertyKeyframe.value}
                        onChange={(event) =>
                          updateLayerPropertyKeyframeValue(
                            selectedLayer.id,
                            selectedLayerProperty,
                            selectedPropertyKeyframe.id,
                            Number(event.target.value),
                          )
                        }
                      />
                    )}
                  </label>
                )}
                <div>
                  Ease into this key
                  <EasingPicker
                    label="Selected layer key easing"
                    disabled={selectedShaderSpec?.discrete}
                    value={
                      selectedShaderSpec?.discrete
                        ? 'linear'
                        : (selectedPropertyKeyframe ?? selectedLayerKeyframe)!.easing
                    }
                    onChange={(easing) =>
                      selectedLayerProperty && selectedPropertyKeyframe
                        ? updateLayerPropertyKeyframeEasing(
                            selectedLayer.id,
                            selectedLayerProperty,
                            selectedPropertyKeyframe.id,
                            easing,
                          )
                        : selectedLayerKeyframe &&
                          updateLayerKeyframeEasing(
                            selectedLayer.id,
                            selectedLayerKeyframe.id,
                            easing,
                          )
                    }
                    curve={selectedPropertyKeyframe?.curve}
                    onCurveChange={
                      selectedLayerProperty &&
                      selectedPropertyKeyframe &&
                      !selectedShaderSpec?.discrete
                        ? (curve) =>
                            updateLayerPropertyKeyframeCurve(
                              selectedLayer.id,
                              selectedLayerProperty,
                              selectedPropertyKeyframe.id,
                              curve,
                            )
                        : undefined
                    }
                  />
                  {selectedShaderSpec?.discrete && <small>Hold (stepped)</small>}
                </div>
                {selectedLayerProperty && selectedPropertyKeyframe && (
                  <>
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
                      <span>{animatablePropertyLabel(selectedLayerProperty, selectedLayer)}</span>
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
                    <button
                      type="button"
                      onClick={createLoopForSelectedProperty}
                      disabled={selectedLayer.isLocked}
                    >
                      Add Loop…
                    </button>
                  ) : (
                    <>
                      <div className="timeline-loop-grid">
                        <FrameDurationControl
                          compact
                          label="Loop duration"
                          minFrames={1}
                          frameRate={composition.frameRate}
                          frames={selectedLayer.loop.durationFrames}
                          onChange={(frames) =>
                            setLayerLoop(selectedLayer.id, {
                              durationFrames: frames,
                            })
                          }
                        />
                        <label>
                          Repeats
                          <input
                            type="number"
                            min={1}
                            placeholder="∞"
                            disabled={Boolean(selectedLayer.lighting)}
                            title={
                              selectedLayer.lighting
                                ? 'Unlink shared lighting to use finite repeats.'
                                : undefined
                            }
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
                            disabled={Boolean(selectedLayer.lighting)}
                            title={
                              selectedLayer.lighting
                                ? 'Shared lighting uses the lifecycle clock.'
                                : undefined
                            }
                            value={
                              selectedLayer.loop.activation.type === 'lifecycle'
                                ? 'lifecycle'
                                : selectedLayer.loop.activation.type === 'step'
                                  ? `step:${selectedLayer.loop.activation.stepKeyframeId}`
                                  : `action:${selectedLayer.loop.activation.customActionId}`
                            }
                            onChange={(event) => {
                              const value = event.target.value;
                              setLayerLoop(selectedLayer.id, {
                                activation:
                                  value === 'lifecycle'
                                    ? { type: 'lifecycle' }
                                    : value.startsWith('step:')
                                      ? { type: 'step', stepKeyframeId: value.slice(5) }
                                      : {
                                          type: 'customAction',
                                          customActionId: value.slice(7),
                                        },
                              });
                            }}
                          >
                            <option value="lifecycle">Graphic is on-air</option>
                            {composition.keyframes
                              .filter((keyframe) => keyframe.role === 'step')
                              .map((keyframe) => (
                                <option key={keyframe.id} value={`step:${keyframe.id}`}>
                                  {lifecycleLabel(keyframe, composition.keyframes)}
                                </option>
                              ))}
                            {composition.customActions.map((action) => (
                              <option key={action.id} value={`action:${action.actionId}`}>
                                Custom action: {action.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <LoopTimingEditor layer={selectedLayer} composition={composition} />
                      <details className="timeline-loop-advanced">
                        {selectedLayer.lighting && (
                          <p className="inspector-hint">
                            These are the original light curves. Adjust shared sweep timing in
                            Resources → Patterns → Shared lighting.
                          </p>
                        )}
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
                          disabled={selectedLayer.isLocked}
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
                          Add {animatablePropertyLabel(selectedLayerProperty, selectedLayer)} to
                          loop
                        </button>
                      ) : (
                        <div className="timeline-loop-keys">
                          <div className="timeline-loop-key header">
                            <span>Frame</span>
                            <span>Value</span>
                            <span>Ease into this key</span>
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
                                step={selectedShaderSpec?.step ?? 'any'}
                                min={selectedShaderSpec?.min}
                                max={selectedShaderSpec?.max}
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
                              <EasingPicker
                                label="Loop key incoming easing"
                                disabled={selectedShaderSpec?.discrete}
                                value={selectedShaderSpec?.discrete ? 'linear' : key.easing}
                                onChange={(easing) =>
                                  updateSelectedLoopTrack(
                                    selectedLoopTrack.map((candidate) =>
                                      candidate.id === key.id
                                        ? {
                                            ...candidate,
                                            easing,
                                            curve: undefined,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
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
                              disabled={selectedLayer.isLocked}
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
                                    selectedShaderSpec
                                      ? getShaderTrackValueAtFrame(
                                          selectedLayer.element,
                                          selectedLayerProperty,
                                          selectedLoopTrack,
                                          frame,
                                          fallback,
                                        )
                                      : getTrackValueAtFrame(selectedLoopTrack, frame, fallback),
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
          </CollapsibleSection>
        ) : null}
        {frameMenu && frameMenuLayer && (
          <ContextMenu
            x={frameMenu.x}
            y={frameMenu.y}
            ariaLabel={`${frameMenuLayer.name} frame ${frameMenu.frame} actions`}
            onClose={() => setFrameMenu(null)}
            items={[
              ...(frameMenu.property
                ? [
                    {
                      id: 'reset-property-animation',
                      label: `Reset ${animatablePropertyLabel(frameMenu.property, frameMenuLayer)} animation`,
                      disabled:
                        frameMenuLayer.isLocked ||
                        !(
                          (timelineAnimationTracks(frameMenuLayer)[frameMenu.property]?.length ??
                            0) > 0 ||
                          (frameMenuLayer.loop?.tracks[frameMenu.property]?.length ?? 0) > 0
                        ),
                      title:
                        'Keep the current playhead value and remove this channel’s main and local-loop animation.',
                      onSelect: () => resetChannelAnimation(frameMenu.layerId, frameMenu.property!),
                    },
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
                        (!parseShaderAnimationProperty(frameMenu.property) &&
                          (timelineAnimationTracks(frameMenuLayer)[frameMenu.property]?.length ??
                            0) <= 1),
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
                        timelineLayerKeyframes(frameMenuLayer).length <= 1,
                      separatorBefore: true,
                      onSelect: () => {
                        if (!frameMenuKeyframe) return;
                        removeLayerKeyframe(frameMenu.layerId, frameMenuKeyframe.id);
                        clearLayerKeyframe();
                      },
                    },
                  ]),
              {
                id: 'paste-easing-only',
                label: 'Paste easing only',
                separatorBefore: true,
                disabled:
                  !motionClipboard.length ||
                  frameMenuLayer.isLocked ||
                  !(frameMenu.property ? frameMenuPropertyKeyframe : frameMenuKeyframe),
                onSelect: () => {
                  const source =
                    motionClipboard.find((key) => key.property === frameMenu.property) ??
                    motionClipboard[0];
                  if (!source) return;
                  runDiscreteHistoryStep(() => {
                    if (frameMenu.property && frameMenuPropertyKeyframe) {
                      updateLayerPropertyKeyframeEasing(
                        frameMenu.layerId,
                        frameMenu.property,
                        frameMenuPropertyKeyframe.id,
                        source.easing,
                      );
                      updateLayerPropertyKeyframeCurve(
                        frameMenu.layerId,
                        frameMenu.property,
                        frameMenuPropertyKeyframe.id,
                        source.curve ?? null,
                      );
                    } else if (frameMenuKeyframe) {
                      updateLayerKeyframeEasing(
                        frameMenu.layerId,
                        frameMenuKeyframe.id,
                        source.easing,
                      );
                      for (const [property, track] of Object.entries(
                        timelineAnimationTracks(frameMenuLayer),
                      )) {
                        const target = track?.find((key) => key.frame === frameMenu.frame);
                        if (target && source.curve)
                          updateLayerPropertyKeyframeCurve(
                            frameMenu.layerId,
                            property as AnimatableLayerProperty,
                            target.id,
                            source.curve,
                          );
                      }
                    }
                  }, 'Paste easing');
                },
              },
            ]}
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
        <TimelineHoverDetails panelRef={panelRef} />
      </div>
    </Panel>
  );
}
