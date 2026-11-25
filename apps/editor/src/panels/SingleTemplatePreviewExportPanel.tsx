import { useEditorWindow } from '../layout/EditorWindow';
import { PropertyRow } from '../components/PropertyRow';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { OgrafLogo } from '../components/OgrafLogo';
import { PresentationBackground } from '../components/PresentationBackground';
import { ProgramGuides } from '../components/ProgramGuides';
import { PreviewFpsControls, PreviewFpsOverlay } from '../components/PreviewFpsOverlay';
import { getCompositionOutputRect } from '@ograf-editor/scene-model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  assembleManifest,
  BUILT_IN_EXPORT_PROFILES,
  compileDescriptor,
  getExportProfile,
  type ExportProfileMode,
} from '@ograf-editor/codegen';
import { registerGraphicElement, type StudioFrameCueDetail } from '@ograf-editor/ograf-runtime';
import type {
  CompiledGraphicDescriptor,
  Graphic,
  RenderType,
  ScheduledAction,
} from '@ograf-editor/ograf-types';
import { validateManifest } from '@ograf-editor/validation';
import {
  computeKeyframeFrames,
  getPlayoutCompatibilityWarnings,
  hasElementMediaPaint,
  runBroadcastQa,
  type BroadcastQaIssue,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useTimelineStore } from '../state/timelineStore';
import { useEditorPreviewSourceStore } from '../state/editorPreviewSourceStore';
import { installEditorPreviewMirror } from '../canvas/editorPreviewMirror';
import { activateAdjacentProjectSetTemplate } from '../state/projectSetSession';
import { useTestDataStore, type TestValue } from '../state/testDataStore';
import { playRundown } from '../state/rundownPlayback';
import {
  assertStudioRendererPluginsAllowed,
  useRendererPluginSettingsStore,
} from '../state/pluginSettingsStore';
import { resolveStudioRendererComposition } from '../state/studioRendererResolution';
import {
  buildExportArtifacts,
  certifyExportArtifacts,
  type OGrafCompatibilityResult,
} from '../state/ografCompatibility';
import { useFitZoom } from '../canvas/useFitZoom';
import { transparencyCheckerboardStyle } from '../canvas/compositionBackground';
import {
  resolvePreviewDataRecord,
  resolvePreviewDataFormSession,
  type PreviewDataFormSession,
} from '../state/previewData';
import { canReusePreviewForShaderParameters } from '../state/shaderPreviewReuse';
import { canReusePreviewForTickerElements } from '../state/tickerPreviewReuse';
import {
  enterPreviewFullscreen,
  exitPreviewFullscreen,
  installPreviewShortcuts,
  isPreviewPresented,
  previewArrowNavigationLabel,
  resolvePreviewArrowNavigation,
} from '../state/previewPresentation';
import { registerPreviewPresentation } from '../state/previewPresentationStore';
import { dispatchPreviewKeyboardInput } from '../state/previewKeyboardInput';
import {
  attachBehaviorPreviewViewport,
  clearBehaviorPreview,
  hasRulePlayoutActions,
  outBehaviorPreview,
  replayBehaviorPreview,
  requestRulePlayoutPreview,
  takeBehaviorPreview,
  updateBehaviorPreview,
  useBehaviorPreviewStore,
} from '../state/behaviorPreviewStore';
import { measureAgentText } from '../state/agentCapture';
import { Panel } from './Panel';
import { PreviewDataFields } from './PreviewDataFields';
import { PreviewPlayoutControls } from './PreviewPlayoutControls';
import { SyncViewersControl } from './SyncViewersControl';
import { FrameCueLog, type FrameCueLogEntry } from './FrameCueLog';
import { ChartRendererUpgradeNotice } from './ChartRendererUpgradeNotice';
import {
  publishPlayoutControls,
  sharedSlotDataKey,
  stageSharedPreviewSlotField,
  unregisterPlayoutControls,
  type PlayoutControlsSession,
} from '../state/playoutControlsStore';
import { acknowledgePreviewSlotFields } from '../state/previewSlotDataStore';
import { PreviewControlsHeading } from './PreviewControlsHeading';
import { usePreviewControlsPosition } from './usePreviewControlsPosition';
import { usePreviewControlsInteraction } from './usePreviewControlsInteraction';
import { didFinishPreviewEdit } from './previewControlsInteraction';
import { PreviewError } from './PreviewError';
import { SharedPlayoutLinks } from './SharedPlayoutLinks';
import {
  hasSharedPlayoutContent,
  setSharedPlayoutLiveSnapshot,
  sharedPlayoutTargetKey,
  useSharedPlayoutEditor,
} from '../state/sharedPlayoutEditor';
import { useSharedLivePreview } from '../state/sharedLivePreview';
import { usePreviewPresentationSuspended } from './usePreviewPresentationSuspended';
import { useTickerUpdateStatuses } from './useTickerUpdateStatuses';
import { resolveSourceOverlayGeometry } from './sourceOverlay';
import { mediaCompatibleExportProfile, mediaCompatibleRenderType } from './mediaExportProfile';
import { defaultTemplateExportProfile, hasEnabledExternalFeed } from './templateExportProfile';
import { requestStudioExport } from '../state/studioExportDialogStore';
import './PreviewExportPanel.css';

interface LogEntry {
  id: number;
  method: string;
  paramsSummary: string;
  resultSummary: string;
  isError: boolean;
}

type RetainedPreviewGraphic = HTMLElement &
  Graphic & {
    updateTickerElements?: (descriptor: CompiledGraphicDescriptor) => boolean;
    setPresentationSuspended?: (suspended: boolean) => void;
  };

interface ScheduleRow {
  id: number;
  timestamp: number;
  actionType: ScheduledAction['action']['type'];
  paramsJson: string;
}

const DEFAULT_SCHEDULE_PARAMS_JSON: Record<ScheduledAction['action']['type'], string> = {
  updateAction: '{"data":{}}',
  playAction: '{"delta":1}',
  stopAction: '{}',
  customAction: '{"id":"","payload":{}}',
};

let logCounter = 0;
let scheduleRowCounter = 0;

function successful(result: unknown): boolean {
  return !(
    typeof result === 'object' &&
    result !== null &&
    'statusCode' in result &&
    typeof result.statusCode === 'number' &&
    result.statusCode >= 400
  );
}

export function SingleTemplatePreviewExportPanel() {
  const { window, document: ownerDocument } = useEditorWindow();
  const project = useProjectStore((s) => s.project);
  const documentLoadRevision = useProjectStore((s) => s.documentLoadRevision);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const templateIndex =
    projectSet?.templates.findIndex((template) => template.id === activeTemplateId) ?? -1;
  const templateCount = projectSet?.templates.length ?? 0;
  const composition = useActiveComposition();
  const syncEditorPreview = useWorkspaceStore((state) => state.editorPreferences.syncEditorPreview);
  const editorSource = useEditorPreviewSourceStore((state) =>
    syncEditorPreview ? state.source : null,
  );
  const matchingEditorSource =
    editorSource?.projectId === project.id && editorSource.compositionId === composition.id
      ? editorSource
      : null;
  const needsRulePlayoutPreview = project.compositions.some(hasRulePlayoutActions);
  const behavior = useBehaviorPreviewStore();
  const behaviorActive = !syncEditorPreview && Boolean(behavior.requestId);
  const [renderType, setRenderType] = useState<RenderType>('realtime');
  const [requestedSharedPublication, setRequestedSharedPublication] = useState<string | null>(null);
  const sharedLinks = useSharedPlayoutEditor((state) => state.links);
  const publishedSource = useSharedPlayoutEditor((state) => state.publishedSource);
  const publishedId = useSharedPlayoutEditor((state) => state.publicationId);
  const publicationKey = useSharedPlayoutEditor((state) => state.publicationKey);
  const sharedPreparationError = useSharedPlayoutEditor((state) => state.error);
  const targetKey = sharedPlayoutTargetKey(
    documentLoadRevision,
    projectSet?.transitionLogic ? projectSet.id : undefined,
    activeTemplateId,
    project.id,
    composition.id,
  );
  const availableSharedPublication = targetKey === publicationKey ? publishedId : null;
  const viewingPublishedCopy =
    availableSharedPublication !== null &&
    requestedSharedPublication === availableSharedPublication;
  const publishedSet = publishedSource && 'set' in publishedSource ? publishedSource.set : null;
  const sharedTemplate = publishedSet?.templates.find(
    (template) => template.id === activeTemplateId,
  );
  const sharedSourceMatches = publishedSet
    ? Boolean(sharedTemplate)
    : Boolean(
        publishedSource &&
        'composition' in publishedSource &&
        publishedSource.composition === composition,
      );
  // Standalone edits and new set members use the current composition. The operator can still
  // monitor and control the published copy from Shared Live.
  const sharedPlaybackAllowed =
    availableSharedPublication !== null &&
    !syncEditorPreview &&
    !behaviorActive &&
    renderType === 'realtime';
  const sharedLiveEnabled = sharedPlaybackAllowed && (viewingPublishedCopy || sharedSourceMatches);
  // A coordinated publication still supplies lane state for live data while a new child is edited.
  const mountedSharedPublication =
    sharedPlaybackAllowed && (sharedLiveEnabled || publishedSet)
      ? availableSharedPublication
      : null;
  const localPreviewHasContent = hasSharedPlayoutContent(composition);
  const sharedSet = sharedLiveEnabled ? publishedSet : null;
  const sharedDefinition = sharedSet?.transitionLogic;
  const previewComposition =
    sharedLiveEnabled && publishedSource && 'composition' in publishedSource
      ? publishedSource.composition
      : (sharedLiveEnabled &&
          sharedTemplate?.project.compositions.find((entry) => entry.id === composition.id)) ||
        composition;
  const output =
    syncEditorPreview && matchingEditorSource
      ? matchingEditorSource.output
      : behaviorActive
        ? { width: behavior.width, height: behavior.height }
        : getCompositionOutputRect(previewComposition);
  const testValues = useTestDataStore((s) => s.values);
  const functionOutputs = useMemo(
    () => new Set((previewComposition.functions ?? []).flatMap((fn) => Object.values(fn.outputs))),
    [previewComposition.functions],
  );
  const previewFields = useMemo(
    () =>
      behaviorActive
        ? behavior.dataFields
        : previewComposition.dataFields.filter((field) => !functionOutputs.has(field.id)),
    [behaviorActive, behavior.dataFields, previewComposition.dataFields, functionOutputs],
  );
  const previewDefaults = useMemo(
    () =>
      behaviorActive
        ? Object.fromEntries(
            previewFields.map((field) => [
              field.id,
              behavior.data[field.key] ?? field.defaultValue,
            ]),
          )
        : sharedLiveEnabled
          ? Object.fromEntries(previewFields.map((field) => [field.key, field.defaultValue]))
          : testValues,
    [behaviorActive, previewFields, behavior.data, sharedLiveEnabled, testValues],
  );
  const pluginPolicyRevision = useRendererPluginSettingsStore((state) => state.revision);
  const installedPlugins = useRendererPluginSettingsStore((state) => state.installed);

  const viewportRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fullscreenControlsRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenData, setShowFullscreenData] = useState(false);
  const controlsPosition = usePreviewControlsPosition(
    viewportRef,
    fullscreenControlsRef,
    isFullscreen && showFullscreenData,
  );
  usePreviewControlsInteraction(
    viewportRef,
    fullscreenControlsRef,
    isFullscreen && showFullscreenData,
    (event) => {
      viewportRef.current?.focus({ preventScroll: true });
      controlsPosition.openAt(event.clientX, event.clientY);
      setShowFullscreenData(true);
    },
  );
  const [fullscreenError, setFullscreenError] = useState('');
  const arrowLandingRef = useRef<{ templateId: string; projectId: string; delta: -1 | 1 } | null>(
    null,
  );
  const changeTemplate = (delta: -1 | 1) => {
    try {
      arrowLandingRef.current = null;
      setFullscreenError('');
      activateAdjacentProjectSetTemplate(delta);
    } catch (cause) {
      setFullscreenError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const sharedContainerRef = useRef<HTMLDivElement>(null);
  const graphicRef = useRef<RetainedPreviewGraphic | null>(null);
  const loadedNativeGraphic = useRef<RetainedPreviewGraphic | null>(null);
  const startedNativeGraphic = useRef<RetainedPreviewGraphic | null>(null);
  const pendingTickerDescriptor = useRef<{
    graphic: RetainedPreviewGraphic;
    descriptor: CompiledGraphicDescriptor;
  } | null>(null);
  const presentationSuspended = usePreviewPresentationSuspended(viewportRef, isFullscreen);
  const sharedLive = useSharedLivePreview(
    mountedSharedPublication,
    sharedContainerRef,
    presentationSuspended || !sharedLiveEnabled,
    ownerDocument,
  );
  const { send: sendSharedCommand } = sharedLive;
  const sharedError = sharedLiveEnabled ? sharedPreparationError || sharedLive.error : '';
  const livePublicationId =
    mountedSharedPublication === sharedLive.publicationId ? mountedSharedPublication : null;
  useEffect(() => {
    if (livePublicationId) setSharedPlayoutLiveSnapshot(livePublicationId, sharedLive.snapshot);
  }, [livePublicationId, sharedLive.snapshot]);
  useEffect(
    () => () => {
      if (livePublicationId) setSharedPlayoutLiveSnapshot(livePublicationId, null);
    },
    [livePublicationId],
  );
  const presentationSuspendedRef = useRef(presentationSuspended);
  // A layout effect, so a tab being shown resumes before its first paint.
  useLayoutEffect(() => {
    presentationSuspendedRef.current = presentationSuspended;
    graphicRef.current?.setPresentationSuspended?.(presentationSuspended);
  }, [presentationSuspended]);
  const [, requestTickerPreviewRebuild] = useState(0);
  const transportCallsRef = useRef(new Map<HTMLElement & Graphic, number>());
  const zoom = useFitZoom(
    viewportRef,
    output.width,
    output.height,
    isFullscreen ? 0 : 8,
    isFullscreen ? Infinity : 1,
  );

  const [log, setLog] = useState<LogEntry[]>([]);
  const [frameCueEntries, setFrameCueEntries] = useState<FrameCueLogEntry[]>([]);
  const nextFrameCueSequence = useRef(0);
  const frameCueLog = !syncEditorPreview && (
    <FrameCueLog entries={frameCueEntries} onClear={() => setFrameCueEntries([])} />
  );
  const [nativeCurrentStep, setCurrentStep] = useState<number | undefined>();
  const [nativePreviewLoaded, setIsPreviewLoaded] = useState(false);
  const currentStep = syncEditorPreview
    ? undefined
    : sharedLiveEnabled
      ? sharedLive.currentStep
      : behaviorActive
        ? behavior.currentStep
        : nativeCurrentStep;
  const isPreviewLoaded = syncEditorPreview
    ? Boolean(matchingEditorSource)
    : sharedLiveEnabled
      ? sharedLive.ready
      : behaviorActive
        ? Boolean(behavior.snapshot?.loaded && !behavior.loading)
        : nativePreviewLoaded;
  const canControlPreview =
    isPreviewLoaded &&
    (!behaviorActive || !behavior.busy) &&
    (!sharedLiveEnabled || Boolean(livePublicationId));
  const selectedSharedSlot =
    livePublicationId && sharedDefinition
      ? Object.values(sharedLive.snapshot?.slots ?? {}).find(
          (slot) =>
            !(slot.transition && !slot.incoming) &&
            (slot.incoming ?? slot.current)?.templateId === activeTemplateId,
        )
      : undefined;
  const selectedSharedGraphic = selectedSharedSlot
    ? (selectedSharedSlot.incoming ?? selectedSharedSlot.current)
    : undefined;
  const selectedSharedOnAir = Boolean(selectedSharedGraphic);
  const selectedSharedState = sharedDefinition?.states.find((state) =>
    selectedSharedGraphic
      ? state.id === selectedSharedGraphic.stateId
      : state.templateId === activeTemplateId,
  );
  const [sharedEdits, setSharedEdits] = useState<{
    publicationId: typeof sharedLive.publicationId;
    templateId: string | null;
    values: Record<string, TestValue>;
  } | null>(null);
  const activeSharedEdits =
    livePublicationId &&
    sharedEdits?.publicationId === livePublicationId &&
    sharedEdits.templateId === activeTemplateId
      ? sharedEdits
      : null;
  const dataSessionKey = JSON.stringify([
    activeTemplateId,
    project.id,
    composition.id,
    behavior.requestId,
    behavior.dataSyncRevision,
  ]);
  const [dataSession, setDataSession] = useState<PreviewDataFormSession | null>(null);
  const resolvedDataSession = resolvePreviewDataFormSession(
    dataSession,
    dataSessionKey,
    previewFields,
    previewDefaults,
    previewComposition,
  );
  // Reset synchronously so the new graphic's initial load cannot receive the old template's data.
  if (resolvedDataSession !== dataSession) setDataSession(resolvedDataSession);
  // The live receiver and the publisher can update in either order during a document switch.
  const acceptedSharedData = livePublicationId
    ? sharedSet
      ? selectedSharedGraphic?.data
      : sharedLive.data
    : undefined;
  const dataForm = useMemo(
    () =>
      sharedLiveEnabled
        ? ({ ...previewDefaults, ...acceptedSharedData, ...activeSharedEdits?.values } as Record<
            string,
            TestValue
          >)
        : syncEditorPreview
          ? resolvePreviewDataFormSession(
              null,
              dataSessionKey,
              previewFields,
              testValues,
              composition,
            ).values
          : resolvedDataSession.values,
    [
      sharedLiveEnabled,
      previewDefaults,
      acceptedSharedData,
      activeSharedEdits,
      syncEditorPreview,
      dataSessionKey,
      previewFields,
      testValues,
      composition,
      resolvedDataSession.values,
    ],
  );
  const updateDataField = useCallback(
    (key: string, value: TestValue) => {
      if (sharedLiveEnabled) {
        const publicationId = livePublicationId;
        if (!publicationId) return;
        if (sharedSet && sharedDefinition && selectedSharedState)
          stageSharedPreviewSlotField(sharedSet, sharedDefinition, selectedSharedState, key, value);
        setSharedEdits((previous) => ({
          publicationId,
          templateId: activeTemplateId,
          values: {
            ...(previous?.publicationId === publicationId &&
            previous.templateId === activeTemplateId
              ? previous.values
              : undefined),
            [key]: value,
          },
        }));
        return;
      }
      if (syncEditorPreview) {
        const field = composition.dataFields.find((candidate) => candidate.key === key);
        if (field)
          useTestDataStore
            .getState()
            .setValue(field.id, value, composition.layers, composition.dataFields);
        return;
      }
      setDataSession((previous) => {
        const current = resolvePreviewDataFormSession(
          previous,
          dataSessionKey,
          previewFields,
          previewDefaults,
          composition,
        );
        return { ...current, values: { ...current.values, [key]: value } };
      });
    },
    [
      sharedLiveEnabled,
      livePublicationId,
      sharedSet,
      sharedDefinition,
      selectedSharedState,
      activeTemplateId,
      syncEditorPreview,
      composition,
      dataSessionKey,
      previewFields,
      previewDefaults,
    ],
  );
  const [exportStatus, setExportStatus] = useState('');
  const [isCheckingCompatibility, setIsCheckingCompatibility] = useState(false);
  const [compatibility, setCompatibility] = useState<OGrafCompatibilityResult | null>(null);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scrubTimestamp, setScrubTimestamp] = useState(0);
  const [templateProfileChoice, setTemplateProfileChoice] = useState<{
    projectId: string;
    mode: ExportProfileMode;
  } | null>(null);
  const usesMediaPaint = useMemo(
    () =>
      composition.mediaCues.length > 0 ||
      composition.layers.some(
        (layer) => hasElementMediaPaint(layer.element) || layer.element.type === 'audio',
      ),
    [composition.layers, composition.mediaCues.length],
  );
  const hasCurrentTemplate = !projectSet || templateIndex >= 0;
  const hasExternalFeed = hasEnabledExternalFeed(composition);
  const requestedTemplateProfile =
    templateProfileChoice?.projectId === project.id
      ? templateProfileChoice.mode
      : defaultTemplateExportProfile(project, hasExternalFeed);
  const exportProfile = getExportProfile(
    mediaCompatibleExportProfile(usesMediaPaint, requestedTemplateProfile),
  );
  const playoutWarnings = useMemo(
    () =>
      getPlayoutCompatibilityWarnings(
        { supportsNonRealTime: exportProfile.mode !== 'realtime' },
        composition,
      ),
    [composition, exportProfile.mode],
  );
  const [qaIssues, setQaIssues] = useState<BroadcastQaIssue[] | null>(null);
  const [isRunningQa, setIsRunningQa] = useState(false);
  const [interlacedQa, setInterlacedQa] = useState(false);
  const [comparisonAssetId, setComparisonAssetId] = useState('');
  const [comparisonOpacity, setComparisonOpacity] = useState(0.5);
  const [comparisonNaturalSize, setComparisonNaturalSize] = useState<{
    assetId: string;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const nextRenderType = mediaCompatibleRenderType(usesMediaPaint, renderType);
    if (nextRenderType !== renderType) setRenderType(nextRenderType);
  }, [renderType, usesMediaPaint]);
  const comparisonAsset = composition.assets.find(
    (asset) => asset.id === comparisonAssetId && asset.kind === 'image',
  );
  const comparisonGeometry = useMemo(() => {
    if (!comparisonAsset) return null;
    return (
      resolveSourceOverlayGeometry(composition, comparisonAsset) ??
      (comparisonNaturalSize?.assetId === comparisonAsset.id
        ? {
            x: 0,
            y: 0,
            width: comparisonNaturalSize.width,
            height: comparisonNaturalSize.height,
            rotation: 0,
            transformOriginX: 0,
            transformOriginY: 0,
            source: 'intrinsic' as const,
          }
        : null)
    );
  }, [comparisonAsset, comparisonNaturalSize, composition]);

  useEffect(() => setComparisonNaturalSize(null), [comparisonAssetId]);

  const descriptor = useMemo(
    () => compileDescriptor(resolveStudioRendererComposition(composition, installedPlugins)),
    [composition, installedPlugins],
  );
  const previewStepCount = behaviorActive ? 1 : descriptor.stepCount;
  const previewDescriptorRef = useRef({
    latest: descriptor,
    mounted: descriptor,
    projectId: project.id,
    compositionId: composition.id,
    keyframes: composition.keyframes,
  });
  if (previewDescriptorRef.current.latest !== descriptor) {
    const previous = previewDescriptorRef.current;
    const tickerPatch =
      nativePreviewLoaded &&
      !syncEditorPreview &&
      !behaviorActive &&
      graphicRef.current?.updateTickerElements &&
      canReusePreviewForTickerElements(previous.latest, descriptor);
    // Parameter patches retain lifecycle-array identity in the store. Loading another document
    // (even one with the same IDs) supplies fresh arrays and must start a fresh preview session.
    if (
      previous.projectId !== project.id ||
      previous.compositionId !== composition.id ||
      previous.keyframes !== composition.keyframes ||
      (!tickerPatch && !canReusePreviewForShaderParameters(previous.latest, descriptor))
    ) {
      previewDescriptorRef.current.mounted = descriptor;
      pendingTickerDescriptor.current = null;
    } else if (tickerPatch && graphicRef.current) {
      pendingTickerDescriptor.current = { graphic: graphicRef.current, descriptor };
    }
    previewDescriptorRef.current.latest = descriptor;
    previewDescriptorRef.current.projectId = project.id;
    previewDescriptorRef.current.compositionId = composition.id;
    previewDescriptorRef.current.keyframes = composition.keyframes;
  }
  const previewDescriptor = previewDescriptorRef.current.mounted;
  const tickerUpdates = useTickerUpdateStatuses(
    syncEditorPreview
      ? (matchingEditorSource?.root ?? null)
      : sharedLiveEnabled
        ? sharedContainerRef
        : containerRef,
    sharedLiveEnabled
      ? sharedLive.graphic
      : behaviorActive
        ? behavior.requestId
        : previewDescriptor,
  );
  const previewData = useMemo(
    () => resolvePreviewDataRecord({ ...previewComposition, dataFields: previewFields }, dataForm),
    [previewComposition, previewFields, dataForm],
  );
  const latestPreviewDataRef = useRef(previewData);
  const lastAttemptedDataSignatureRef = useRef<string | null>(null);
  const rundownPlayingRef = useRef(false);
  latestPreviewDataRef.current = previewData;
  const manifest = useMemo(
    () => assembleManifest(project, composition, descriptor),
    [project, composition, descriptor],
  );
  const validation = useMemo(() => validateManifest(manifest), [manifest]);

  const appendLog = useCallback((method: string, params: unknown, result: unknown) => {
    const isError =
      typeof result === 'object' &&
      result !== null &&
      'statusCode' in result &&
      (result as { statusCode: number }).statusCode >= 400;
    setLog((prev) =>
      [
        {
          id: logCounter++,
          method,
          paramsSummary: JSON.stringify(params),
          resultSummary: JSON.stringify(result),
          isError,
        },
        ...prev,
      ].slice(0, 30),
    );
  }, []);

  const callShared = useCallback(
    async (method: string, command: Parameters<typeof sendSharedCommand>[0]) => {
      try {
        setFullscreenError('');
        const result = await sendSharedCommand(command);
        appendLog(method, command, result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFullscreenError(message);
        appendLog(method, command, { statusCode: 550, statusMessage: message });
        return { statusCode: 550, statusMessage: message };
      }
    },
    [appendLog, sendSharedCommand],
  );

  const sendSharedData = useCallback(
    (values: Record<string, TestValue>) => {
      if (!sharedSet) return callShared('updateAction', { kind: 'update', data: values });
      if (!selectedSharedOnAir || !selectedSharedState) return;
      return callShared('updateAction', {
        kind: 'action',
        actionId: 'transition.patch',
        payload: {
          slotId: selectedSharedState.slotId,
          stateId: selectedSharedState.id,
          data: values,
        },
      });
    },
    [callShared, selectedSharedOnAir, selectedSharedState, sharedSet],
  );

  useEffect(() => {
    if (!sharedLiveEnabled || !sharedLive.ready || !activeSharedEdits) return;
    if (sharedSet && !selectedSharedOnAir) return;
    const pending = activeSharedEdits;
    const timer = window.setTimeout(() => {
      void sendSharedData(pending.values)?.then((result) => {
        if (successful(result) && sharedSet && sharedDefinition && selectedSharedState)
          acknowledgePreviewSlotFields(
            sharedSlotDataKey(sharedSet, sharedDefinition, selectedSharedState),
            pending.values,
          );
        setSharedEdits((edits) => {
          if (
            edits?.publicationId !== pending.publicationId ||
            edits.templateId !== pending.templateId
          )
            return edits;
          const remaining = Object.fromEntries(
            Object.entries(edits.values).filter(([key, value]) => value !== pending.values[key]),
          );
          return Object.keys(remaining).length ? { ...edits, values: remaining } : null;
        });
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    sharedLiveEnabled,
    sharedLive.ready,
    activeSharedEdits,
    sendSharedData,
    sharedSet,
    sharedDefinition,
    selectedSharedState,
    selectedSharedOnAir,
    window,
  ]);

  const call = useCallback(
    async <T,>(
      method: string,
      params: unknown,
      fn: (graphic: HTMLElement & Graphic) => Promise<T>,
    ) => {
      const graphic = graphicRef.current;
      if (!graphic) return;
      const transport = method === 'playAction' || method === 'stopAction';
      const calls = transportCallsRef.current;
      if (transport) startedNativeGraphic.current = graphic;
      if (transport) calls.set(graphic, (calls.get(graphic) ?? 0) + 1);
      try {
        const result = await fn(graphic);
        if (graphicRef.current === graphic) appendLog(method, params, result);
      } catch (err) {
        if (graphicRef.current !== graphic) return;
        appendLog(method, params, {
          statusCode: 550,
          statusMessage: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (transport) {
          const pending = (calls.get(graphic) ?? 1) - 1;
          if (pending > 0) calls.set(graphic, pending);
          else calls.delete(graphic);
        }
      }
    },
    [appendLog],
  );

  useLayoutEffect(() => {
    const pending = pendingTickerDescriptor.current;
    if (!pending || pending.graphic !== graphicRef.current) return;
    pendingTickerDescriptor.current = null;
    if (pending.graphic.updateTickerElements?.(pending.descriptor)) return;
    // Older or not-yet-loaded runtimes can still use the existing full preparation path.
    previewDescriptorRef.current.mounted = pending.descriptor;
    requestTickerPreviewRebuild((revision) => revision + 1);
  }, [descriptor]);

  useLayoutEffect(() => {
    const stage = sharedLiveEnabled ? sharedContainerRef.current : containerRef.current;
    if (!stage) return;
    const record = (event: Event) => {
      const detail = (event as CustomEvent<StudioFrameCueDetail>).detail;
      if (!detail) return;
      const entry = { sequence: nextFrameCueSequence.current++, detail };
      setFrameCueEntries((entries) => [entry, ...entries].slice(0, 20));
    };
    stage.addEventListener('ograf-studio-cue', record);
    return () => stage.removeEventListener('ograf-studio-cue', record);
  }, [ownerDocument, sharedLiveEnabled]);

  useLayoutEffect(() => {
    if (behaviorActive && containerRef.current)
      return attachBehaviorPreviewViewport(containerRef.current);
  }, [behaviorActive, ownerDocument]);

  useEffect(() => {
    const container = sharedLiveEnabled ? sharedContainerRef.current : containerRef.current;
    if (!container) return;
    const failed = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) setFullscreenError(message);
    };
    container.addEventListener('ograf-function-error', failed);
    return () => container.removeEventListener('ograf-function-error', failed);
  }, [ownerDocument, sharedLiveEnabled]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!syncEditorPreview || !container) return;
    setFullscreenError('');
    arrowLandingRef.current = null;
    container.replaceChildren();
    if (!matchingEditorSource) return;
    const mirror = container.ownerDocument.createElement('div');
    mirror.className = 'editor-preview-mirror';
    Object.assign(mirror.style, {
      position: 'absolute',
      left: `${-matchingEditorSource.output.x}px`,
      top: `${-matchingEditorSource.output.y}px`,
      width: `${composition.width}px`,
      height: `${composition.height}px`,
    });
    container.appendChild(mirror);
    let dispose: () => void;
    try {
      dispose = installEditorPreviewMirror(matchingEditorSource.root, mirror);
    } catch (cause) {
      mirror.remove();
      setFullscreenError(
        cause instanceof Error ? cause.message : 'Unable to mirror the editor output.',
      );
      return;
    }
    return () => {
      dispose();
      mirror.remove();
    };
  }, [
    syncEditorPreview,
    matchingEditorSource,
    composition.width,
    composition.height,
    ownerDocument,
  ]);

  useLayoutEffect(() => {
    if (syncEditorPreview || !behavior.requestId) return;
    const section = viewportRef.current?.closest('details');
    if (section && !section.open) {
      section.querySelector<HTMLElement>('summary')?.click();
      section.open = true;
    }
  }, [syncEditorPreview, behavior.requestId]);

  // A new coordinated request has already loaded its own initial data. Only subsequent edits
  // should issue an update; replaying IN must not immediately trigger a second animation.
  const behaviorDataRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!behaviorActive) {
      behaviorDataRequestRef.current = null;
      return;
    }
    if (!isPreviewLoaded || behaviorDataRequestRef.current === behavior.requestId) return;
    behaviorDataRequestRef.current = behavior.requestId;
    lastAttemptedDataSignatureRef.current = JSON.stringify(behavior.data);
  }, [behaviorActive, behavior.requestId, behavior.data, isPreviewLoaded]);

  // Public shader value changes flow through the normal updateAction data path below. Retaining
  // the instance keeps its current Step, content clock and GPU resources while a control moves.
  // Source, bindings, backing and other structural authoring edits still create a fresh preview.
  useEffect(() => {
    if (syncEditorPreview || sharedLiveEnabled) return;
    if (behaviorActive) {
      setIsPreviewLoaded(false);
      setLog([]);
      return;
    }
    const landing = arrowLandingRef.current;
    if (landing && (landing.templateId !== activeTemplateId || landing.projectId !== project.id))
      arrowLandingRef.current = null;
    if (needsRulePlayoutPreview) {
      // A standalone GraphicElement cannot execute lane commands. Prepare the existing private
      // coordinator directly, paused Off; only an explicit arrow landing takes the template in.
      const playLanding =
        landing?.templateId === activeTemplateId && landing.projectId === project.id;
      arrowLandingRef.current = null;
      containerRef.current?.replaceChildren();
      graphicRef.current = null;
      setIsPreviewLoaded(false);
      setCurrentStep(undefined);
      setLog([]);
      setFullscreenError('');
      void requestRulePlayoutPreview({
        autoplay: playLanding,
        data: latestPreviewDataRef.current,
      }).catch((cause) => {
        const selection = useProjectSetStore.getState();
        if (
          selection.activeTemplateId !== activeTemplateId ||
          useProjectStore.getState().project.id !== project.id
        )
          return;
        setFullscreenError(cause instanceof Error ? cause.message : String(cause));
        // Missing owner assignments fail before reserving a coordinated session. Keep Play
        // available to retry after repair, rather than leaving a permanently disabled transport.
        if (!useBehaviorPreviewStore.getState().requestId) setIsPreviewLoaded(true);
      });
      return;
    }
    try {
      assertStudioRendererPluginsAllowed(previewDescriptor.rendererPlugins ?? []);
    } catch (error) {
      containerRef.current?.replaceChildren();
      setIsPreviewLoaded(false);
      appendLog(
        'load',
        {},
        { statusCode: 550, statusMessage: error instanceof Error ? error.message : String(error) },
      );
      return;
    }
    const tagName = registerGraphicElement(previewDescriptor);
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    const el = globalThis.document.createElement(tagName) as RetainedPreviewGraphic;
    container.appendChild(el);
    el.setPresentationSuspended?.(presentationSuspendedRef.current);
    graphicRef.current = el;
    setIsPreviewLoaded(false);
    setCurrentStep(undefined);
    setLog([]);

    const data = latestPreviewDataRef.current;
    const dataSignature = JSON.stringify(data);
    const params = {
      data,
      renderType,
      renderCharacteristics: {
        resolution: { width: output.width, height: output.height },
        frameRate: composition.frameRate,
        accessToPublicInternet: false,
      },
    };
    void el
      .load(params)
      .then(async (result) => {
        if (graphicRef.current !== el) return;
        appendLog('load', params, result);
        if (!successful(result)) return;
        lastAttemptedDataSignatureRef.current = dataSignature;
        const target = arrowLandingRef.current;
        if (target?.templateId === activeTemplateId && target.projectId === project.id) {
          arrowLandingRef.current = null;
          if (previewDescriptor.stepCount > 0) {
            const params = { goto: target.delta > 0 ? 0 : previewDescriptor.stepCount - 1 };
            await call('playAction', params, async (graphic) => {
              const played = await graphic.playAction(params);
              if (graphicRef.current === graphic && successful(played))
                setCurrentStep(played.currentStep);
              return played;
            });
          }
        }
        if (graphicRef.current === el) {
          loadedNativeGraphic.current = el;
          setIsPreviewLoaded(true);
        }
      })
      .catch((error) => {
        if (graphicRef.current !== el) return;
        appendLog('load', params, {
          statusCode: 550,
          statusMessage: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      if (graphicRef.current === el) graphicRef.current = null;
      if (loadedNativeGraphic.current === el) loadedNativeGraphic.current = null;
      if (startedNativeGraphic.current === el) startedNativeGraphic.current = null;
      void el.dispose({});
      el.remove();
    };
  }, [
    syncEditorPreview,
    sharedLiveEnabled,
    behaviorActive,
    needsRulePlayoutPreview,
    activeTemplateId,
    project.id,
    call,
    appendLog,
    composition.frameRate,
    output.height,
    output.width,
    previewDescriptor,
    renderType,
    pluginPolicyRevision,
  ]);

  useEffect(() => {
    const graphic = graphicRef.current;
    if (
      !sharedLinks ||
      sharedLiveEnabled ||
      syncEditorPreview ||
      behaviorActive ||
      renderType !== 'realtime' ||
      !isFullscreen ||
      !localPreviewHasContent ||
      !nativePreviewLoaded ||
      !graphic ||
      loadedNativeGraphic.current !== graphic ||
      startedNativeGraphic.current === graphic
    )
      return;
    // Match Shared Live's initial on-air frame without issuing any LAN commands.
    const params = { goto: 0, skipAnimation: true };
    void call('playAction', params, async (current) => {
      const result = await current.playAction(params);
      if (graphicRef.current === current && successful(result)) setCurrentStep(result.currentStep);
      return result;
    });
  }, [
    sharedLinks,
    sharedLiveEnabled,
    syncEditorPreview,
    behaviorActive,
    renderType,
    isFullscreen,
    localPreviewHasContent,
    nativePreviewLoaded,
    call,
  ]);

  useEffect(() => {
    setCompatibility(null);
  }, [project, composition, exportProfile]);

  useEffect(() => {
    if (syncEditorPreview || sharedLiveEnabled) return;
    if (rundownPlayingRef.current) return;
    if (!canControlPreview) return;
    if (!behaviorActive && needsRulePlayoutPreview) return;
    const signature = JSON.stringify(previewData);
    if (behaviorActive && signature === behavior.dataSyncSignature) {
      // A scoped template action or local Rule already committed these values in the runtime.
      // Refreshing its form must not turn that acknowledgement into a second updateAction.
      lastAttemptedDataSignatureRef.current = signature;
      return;
    }
    if (lastAttemptedDataSignatureRef.current === signature) return;

    const timeout = window.setTimeout(() => {
      lastAttemptedDataSignatureRef.current = signature;
      const params = { data: previewData };
      if (behaviorActive) {
        void updateBehaviorPreview(previewData).catch(() => undefined);
      } else {
        void call('updateAction', params, (graphic) => graphic.updateAction(params));
      }
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [
    syncEditorPreview,
    sharedLiveEnabled,
    call,
    canControlPreview,
    behaviorActive,
    behavior.dataSyncSignature,
    needsRulePlayoutPreview,
    previewData,
    window,
  ]);

  const handlePlayAction = useCallback(
    (params: { delta?: number; goto?: number }) => {
      if (syncEditorPreview) {
        const timeline = useTimelineStore.getState();
        if (timeline.isPlaying) timeline.controller?.pause();
        else timeline.controller?.play();
        return;
      }
      if (sharedLiveEnabled) {
        if (canControlPreview) void callShared('playAction', { kind: 'play', ...params });
        return;
      }
      if (behaviorActive) {
        if (!canControlPreview) return;
        void (
          params.goto !== undefined || currentStep === undefined
            ? takeBehaviorPreview()
            : outBehaviorPreview()
        ).catch(() => undefined);
        return;
      }
      if (needsRulePlayoutPreview) {
        setFullscreenError('');
        void requestRulePlayoutPreview({ data: latestPreviewDataRef.current }).catch((cause) =>
          setFullscreenError(cause instanceof Error ? cause.message : String(cause)),
        );
        return;
      }
      void call('playAction', params, async (g) => {
        const result = await g.playAction(params);
        if (graphicRef.current === g && successful(result)) setCurrentStep(result.currentStep);
        return result;
      });
    },
    [
      syncEditorPreview,
      sharedLiveEnabled,
      callShared,
      behaviorActive,
      needsRulePlayoutPreview,
      canControlPreview,
      currentStep,
      call,
    ],
  );

  const handleArrowNavigation = useCallback(
    (delta: -1 | 1) => {
      if (syncEditorPreview) {
        const timeline = useTimelineStore.getState();
        timeline.controller?.seek(
          Math.max(0, Math.min(timeline.durationFrames, timeline.currentFrame + delta)),
        );
        return;
      }
      const graphic = graphicRef.current;
      if (
        (!sharedLiveEnabled && !behaviorActive && !graphic && !needsRulePlayoutPreview) ||
        !canControlPreview ||
        arrowLandingRef.current ||
        (graphic && transportCallsRef.current.has(graphic))
      )
        return;
      const next = resolvePreviewArrowNavigation(delta, currentStep, previewStepCount);
      if (next.type === 'step') {
        handlePlayAction({ goto: next.step });
        return;
      }
      const session = useProjectSetStore.getState();
      const index =
        session.projectSet?.templates.findIndex(
          (template) => template.id === session.activeTemplateId,
        ) ?? -1;
      const target = session.projectSet?.templates[index + delta];
      if (!target) {
        // The final template still has its normal OUT; the first has its rewind to Start.
        // Rewinding an already Off graphic has no further destination.
        if (delta > 0 || currentStep !== undefined) handlePlayAction({ delta });
        return;
      }
      arrowLandingRef.current = { templateId: target.id, projectId: target.project.id, delta };
      try {
        setFullscreenError('');
        if (!activateAdjacentProjectSetTemplate(delta)) arrowLandingRef.current = null;
        if (sharedLiveEnabled) arrowLandingRef.current = null;
      } catch (cause) {
        arrowLandingRef.current = null;
        setFullscreenError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [
      syncEditorPreview,
      sharedLiveEnabled,
      behaviorActive,
      needsRulePlayoutPreview,
      currentStep,
      handlePlayAction,
      canControlPreview,
      previewStepCount,
    ],
  );

  const handleFullscreen = useCallback(async () => {
    const viewport = viewportRef.current;
    if (!viewport) throw new Error('The preview is not available yet.');
    setFullscreenError('');
    setShowFullscreenData(false);
    const playbackSection = viewport.closest('details');
    if (playbackSection && !playbackSection.open) {
      playbackSection.querySelector<HTMLElement>('summary')?.click();
      // Make the target visible before the browser consumes this user activation.
      playbackSection.open = true;
    }
    try {
      await enterPreviewFullscreen(viewport);
      if (!sharedLiveEnabled && !syncEditorPreview && !behaviorActive && needsRulePlayoutPreview)
        await requestRulePlayoutPreview({ autoplay: false, data: latestPreviewDataRef.current });
    } catch (error: unknown) {
      setFullscreenError(error instanceof Error ? error.message : 'Unable to enter fullscreen.');
      throw error;
    }
  }, [sharedLiveEnabled, syncEditorPreview, behaviorActive, needsRulePlayoutPreview]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    return registerPreviewPresentation({ enter: handleFullscreen, viewport, ownerDocument });
  }, [handleFullscreen, ownerDocument]);

  const toggleFullscreenData = useCallback(() => {
    const viewport = viewportRef.current;
    if (
      viewport
        ?.querySelector('.preview-fullscreen-data')
        ?.contains(viewport.ownerDocument.activeElement)
    ) {
      viewport.focus({ preventScroll: true });
    }
    setShowFullscreenData((visible) => !visible);
  }, []);

  useEffect(() => {
    if (!isFullscreen || !showFullscreenData) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.button !== 0 || didFinishPreviewEdit(event)) return;
      const controls = fullscreenControlsRef.current;
      const path = event.composedPath();
      if (!controls || path.includes(controls)) return;
      if (controls.contains(ownerDocument.activeElement))
        viewportRef.current?.focus({ preventScroll: true });
      setShowFullscreenData(false);
    };
    ownerDocument.addEventListener('pointerdown', dismissOutside, true);
    return () => ownerDocument.removeEventListener('pointerdown', dismissOutside, true);
  }, [isFullscreen, showFullscreenData, ownerDocument]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const changed = () => {
      const active = isPreviewPresented(viewport);
      setIsFullscreen(active);
      if (active) {
        setShowFullscreenData(false);
        viewport.focus({ preventScroll: true });
      }
    };
    changed();
    ownerDocument.addEventListener('fullscreenchange', changed);
    return () => {
      ownerDocument.removeEventListener('fullscreenchange', changed);
      if (isPreviewPresented(viewport)) {
        void exitPreviewFullscreen(viewport).catch(() => undefined);
      }
    };
  }, [ownerDocument]);

  useEffect(() => {
    const panel = panelRef.current,
      viewport = viewportRef.current;
    if (!panel || !viewport) return;
    return installPreviewShortcuts(
      ownerDocument,
      panel,
      viewport,
      (delta) => handlePlayAction({ delta }),
      () =>
        canControlPreview &&
        !arrowLandingRef.current &&
        !transportCallsRef.current.has(graphicRef.current!),
      {
        toggleControls: toggleFullscreenData,
        onArrow: handleArrowNavigation,
        onKeyboard: (event) =>
          !syncEditorPreview &&
          dispatchPreviewKeyboardInput(
            containerRef.current,
            event,
            (cause) => setFullscreenError(cause instanceof Error ? cause.message : String(cause)),
            sharedLiveEnabled ? sharedLive.graphic : null,
          ),
      },
    );
  }, [
    ownerDocument,
    handlePlayAction,
    handleArrowNavigation,
    canControlPreview,
    toggleFullscreenData,
    syncEditorPreview,
    sharedLiveEnabled,
    sharedLive.graphic,
  ]);

  const handleStop = () => {
    if (syncEditorPreview) {
      useTimelineStore.getState().controller?.stop();
      return;
    }
    if (sharedLiveEnabled) {
      if (canControlPreview) void callShared('stopAction', { kind: 'stop' });
      return;
    }
    if (behaviorActive) {
      if (canControlPreview) void outBehaviorPreview().catch(() => undefined);
      return;
    }
    void call('stopAction', {}, async (g) => {
      const result = await g.stopAction({});
      if (graphicRef.current === g && successful(result)) setCurrentStep(undefined);
      return result;
    });
  };

  const handleCustomAction = (actionId: string) => {
    if (sharedLiveEnabled) {
      if (!canControlPreview) return;
      if (!sharedSet) void callShared('customAction', { kind: 'action', actionId });
      else if (selectedSharedGraphic && selectedSharedState) {
        void callShared('customAction', {
          kind: 'action',
          actionId: 'template.action',
          payload: { slotId: selectedSharedState.slotId, actionId },
        });
      }
      return;
    }
    const params = { id: actionId, payload: {} };
    void call('customAction', params, (g) => g.customAction(params));
  };

  const updateDataBatch = (data: Record<string, TestValue>) => {
    if (sharedLiveEnabled) {
      if (canControlPreview) {
        if (!sharedSet || selectedSharedGraphic) void sendSharedData(data);
        else for (const [key, value] of Object.entries(data)) updateDataField(key, value);
      }
      return;
    }
    if (syncEditorPreview) {
      useTestDataStore
        .getState()
        .replaceValues(
          Object.fromEntries(
            composition.dataFields
              .filter((field) => Object.hasOwn(data, field.key))
              .map((field) => [field.id, data[field.key]!]),
          ),
          composition.layers,
          composition.dataFields,
        );
      return;
    }
    const normalized = resolvePreviewDataRecord(
      { ...composition, dataFields: previewFields },
      { ...dataForm, ...data },
    );
    setDataSession((previous) => {
      const current = resolvePreviewDataFormSession(
        previous,
        dataSessionKey,
        previewFields,
        previewDefaults,
        composition,
      );
      return { ...current, values: normalized };
    });
    // Row navigation is an explicit operator action, so apply immediately instead of waiting
    // for the debounce used while typing. Rundown playback itself owns its serialized updates.
    if (
      !rundownPlayingRef.current &&
      canControlPreview &&
      (behaviorActive || !needsRulePlayoutPreview)
    ) {
      lastAttemptedDataSignatureRef.current = JSON.stringify(normalized);
      if (behaviorActive)
        void updateBehaviorPreview(normalized).catch((cause) =>
          setFullscreenError(cause instanceof Error ? cause.message : String(cause)),
        );
      else
        void call('updateAction', { data: normalized }, (graphic) =>
          graphic.updateAction({ data: normalized }),
        );
    }
  };

  const runPreviewRundown: NonNullable<PlayoutControlsSession['runRundown']> = async (
    rows,
    options,
  ) => {
    if (syncEditorPreview)
      throw new Error('Turn off editor sync to play a rundown with transitions.');
    if (rundownPlayingRef.current) throw new Error('A rundown is already playing.');
    const check = (result: unknown) => {
      if (!successful(result)) throw new Error(`Preview command failed: ${JSON.stringify(result)}`);
    };
    if (sharedLiveEnabled) {
      const state = selectedSharedState;
      if (sharedSet && !state) throw new Error('Assign this template to a playout lane first.');
      const target = state && { slotId: state.slotId, stateId: state.id };
      let firstRow: Record<string, TestValue> = {};
      const update = async (data: Record<string, TestValue>) => {
        check(
          await callShared(
            'updateAction',
            target
              ? { kind: 'action', actionId: 'transition.patch', payload: { ...target, data } }
              : { kind: 'update', data },
          ),
        );
      };
      rundownPlayingRef.current = true;
      try {
        await playRundown(
          rows,
          {
            prepare: async (data) => {
              if (target) firstRow = data;
              else await update(data);
            },
            take: async () =>
              check(
                await callShared(
                  'playAction',
                  target
                    ? {
                        kind: 'action',
                        actionId: 'transition.take',
                        payload: { ...target, data: firstRow },
                      }
                    : { kind: 'play', goto: 0 },
                ),
              ),
            update,
            out: async () =>
              check(
                await callShared(
                  'stopAction',
                  target
                    ? {
                        kind: 'action',
                        actionId: 'transition.out',
                        payload: { slotId: target.slotId },
                      }
                    : { kind: 'stop' },
                ),
              ),
          },
          options,
        );
      } finally {
        rundownPlayingRef.current = false;
      }
      return;
    }
    if (behaviorActive && behavior.sourceTemplateId !== activeTemplateId)
      throw new Error('Select this template in Preview & Export before playing its rundown.');
    const graphic = graphicRef.current;
    const coordinated = behaviorActive || needsRulePlayoutPreview;
    let coordinatedId = behaviorActive ? behavior.requestId : null;
    const coordinatedStillCurrent = () =>
      coordinatedId !== null && useBehaviorPreviewStore.getState().requestId === coordinatedId;
    if (!coordinated && (!graphic || !canControlPreview))
      throw new Error('Open Preview & Export and wait for the graphic to load.');
    const publish = (data: Record<string, TestValue>) => {
      const normalized = resolvePreviewDataRecord(
        { ...composition, dataFields: previewFields },
        data,
      );
      lastAttemptedDataSignatureRef.current = JSON.stringify(normalized);
      updateDataBatch(normalized);
      return normalized;
    };
    rundownPlayingRef.current = true;
    try {
      await playRundown(
        rows,
        {
          prepare: async (data) => {
            const payload = publish(data);
            if (coordinated) {
              if (behaviorActive) {
                if (!coordinatedStillCurrent()) throw new Error('Preview changed during playback.');
                await updateBehaviorPreview(payload);
              } else {
                await requestRulePlayoutPreview({ autoplay: false, data: payload });
                coordinatedId = useBehaviorPreviewStore.getState().requestId;
              }
            } else {
              if (graphicRef.current !== graphic)
                throw new Error('Preview changed during playback.');
              check(await graphic!.updateAction({ data: payload }));
            }
          },
          take: async () => {
            if (coordinated) {
              if (!coordinatedStillCurrent()) throw new Error('Preview changed during playback.');
              await takeBehaviorPreview();
            } else {
              const result = await graphic!.playAction({ goto: 0 });
              check(result);
              setCurrentStep(result?.currentStep);
            }
          },
          update: async (data) => {
            if (coordinated && !coordinatedStillCurrent())
              throw new Error('Preview changed during playback.');
            const payload = publish(data);
            if (coordinated) await updateBehaviorPreview(payload);
            else {
              if (graphicRef.current !== graphic)
                throw new Error('Preview changed during playback.');
              check(await graphic!.updateAction({ data: payload }));
            }
          },
          out: async () => {
            if (coordinated) {
              if (coordinatedStillCurrent()) await outBehaviorPreview();
            } else if (graphicRef.current === graphic) {
              check(await graphic!.stopAction({}));
              setCurrentStep(undefined);
            }
          },
        },
        options,
      );
    } finally {
      rundownPlayingRef.current = false;
    }
  };

  const playoutControls: PlayoutControlsSession = {
    viewerSync: sharedLiveEnabled
      ? {
          checked: sharedLive.syncViewers,
          disabled: sharedLive.syncVersion < 0 || sharedLive.syncPending || sharedLive.loading,
          error: sharedLive.syncError,
          onChange: sharedLive.setSyncViewers,
        }
      : undefined,
    tickerUpdates,
    editorSynchronized: syncEditorPreview,
    templateName: projectSet?.templates[templateIndex]?.name ?? project.name,
    templateIndex,
    templateCount,
    currentStep,
    stepCount: previewStepCount,
    ready: canControlPreview,
    loading: !isPreviewLoaded,
    error: fullscreenError || sharedError || (behaviorActive ? (behavior.error ?? '') : ''),
    behaviorActive,
    behaviorLabel: behavior.label ?? '',
    projectSet,
    activeTemplateId,
    dataTemplateId: behaviorActive ? behavior.sourceTemplateId : activeTemplateId,
    dataTemplateName:
      projectSet?.templates.find((template) => template.id === behavior.sourceTemplateId)?.name ??
      project.name,
    data: previewData,
    fields: previewFields,
    values: dataForm,
    customActions: syncEditorPreview ? [] : descriptor.customActions,
    sharedTransition:
      sharedSet && livePublicationId
        ? {
            source: sharedSet,
            snapshot: sharedLive.snapshot,
            manifest: sharedLive.manifest,
            ready: canControlPreview,
            error: sharedError,
            sendAction: (actionId, payload) =>
              callShared('customAction', { kind: 'action', actionId, payload }),
          }
        : undefined,
    changeTemplate,
    play: handlePlayAction,
    out: handleStop,
    customAction: handleCustomAction,
    updateData: updateDataField,
    updateDataBatch,
    runRundown: runPreviewRundown,
    navigate: handleArrowNavigation,
    canNavigate: () =>
      canControlPreview &&
      !arrowLandingRef.current &&
      !transportCallsRef.current.has(graphicRef.current!),
  };
  const controlsOwner = useRef({});
  // Publish after commit so every control view observes the same settled preview state.
  useLayoutEffect(() => {
    publishPlayoutControls(controlsOwner.current, playoutControls);
  });
  useLayoutEffect(() => {
    const owner = controlsOwner.current;
    return () => unregisterPlayoutControls(owner);
  }, []);

  const addScheduleRow = () => {
    setScheduleRows((prev) => [
      ...prev,
      {
        id: scheduleRowCounter++,
        timestamp: 0,
        actionType: 'updateAction',
        paramsJson: DEFAULT_SCHEDULE_PARAMS_JSON.updateAction,
      },
    ]);
  };

  const removeScheduleRow = (id: number) =>
    setScheduleRows((prev) => prev.filter((row) => row.id !== id));

  const updateScheduleRow = (id: number, patch: Partial<ScheduleRow>) =>
    setScheduleRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const handleSendSchedule = () => {
    let schedule: ScheduledAction[];
    try {
      schedule = scheduleRows.map((row) => ({
        timestamp: row.timestamp,
        action: { type: row.actionType, params: JSON.parse(row.paramsJson || '{}') as unknown },
      }));
    } catch (err) {
      appendLog('setActionsSchedule', scheduleRows, {
        statusCode: 550,
        statusMessage: `Invalid params JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    const params = { schedule };
    void call('setActionsSchedule', params, (g) => g.setActionsSchedule(params));
  };

  const handleGoToTime = () => {
    const params = { timestamp: scrubTimestamp };
    void call('goToTime', params, (g) => g.goToTime(params));
  };

  const handleCompatibilityCheck = async () => {
    setIsCheckingCompatibility(true);
    setExportStatus('Running OGraf devtool-compatible checks…');
    try {
      const result = await certifyExportArtifacts(
        buildExportArtifacts(project, composition, exportProfile),
      );
      setCompatibility(result);
      setExportStatus(
        result.valid
          ? 'OGraf v1 compatibility test passed. The next unchanged export is eligible to save.'
          : `Compatibility failed: ${result.errors.join(' ')}`,
      );
    } catch (err) {
      setCompatibility(null);
      setExportStatus(err instanceof Error ? err.message : 'Compatibility test failed.');
    } finally {
      setIsCheckingCompatibility(false);
    }
  };

  const handleBroadcastQa = async () => {
    setIsRunningQa(true);
    const issues = runBroadcastQa(project, { interlacedOutput: interlacedQa });
    const lifecycle = computeKeyframeFrames(composition);
    const stepIds = new Set(
      composition.keyframes
        .filter((keyframe) => keyframe.role === 'step')
        .map((keyframe) => keyframe.id),
    );
    const frame =
      lifecycle.find((item) => stepIds.has(item.keyframeId))?.frame ?? lifecycle[0]?.frame ?? 0;
    const stressSamples = [
      'BREAKING NEWS — REPRESENTATIVE LONG REPLACEMENT TEXT 00:00',
      'İstanbul İzmir Şampiyonluk gündemi — العربية 1234567890',
    ];
    try {
      for (const layer of composition.layers.filter(
        (candidate) => candidate.isVisible && candidate.element.type === 'text',
      )) {
        for (const text of stressSamples) {
          const result = await measureAgentText({
            project,
            compositionId: composition.id,
            layerId: layer.id,
            text,
            frame,
          });
          if (result.overflowsParent || result.degenerate) {
            issues.push({
              severity: 'warning',
              category: 'typography',
              compositionId: composition.id,
              layerId: layer.id,
              frame,
              message: `${layer.name} ${result.degenerate ? 'hits its minimum font-size floor' : 'overflows its authored box'} with stress value “${text}”.`,
            });
          }
          if (result.resolvedFont.requestedFamily !== result.resolvedFont.resolvedFamily) {
            issues.push({
              severity: 'warning',
              category: 'resources',
              compositionId: composition.id,
              layerId: layer.id,
              frame,
              message: `${layer.name} requested ${result.resolvedFont.requestedFamily} but resolved to ${result.resolvedFont.resolvedFamily}.`,
            });
          }
        }
      }
      setQaIssues(
        issues.filter(
          (issue, index) =>
            issues.findIndex((candidate) => candidate.message === issue.message) === index,
        ),
      );
    } catch (error) {
      setQaIssues([
        ...issues,
        {
          severity: 'warning',
          category: 'typography',
          compositionId: composition.id,
          message: `Browser text stress test failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setIsRunningQa(false);
    }
  };

  return (
    <Panel title="Preview & Export">
      <div className="preview-export-panel" ref={panelRef}>
        <CollapsibleSection
          sectionId="preview.playback"
          title="Playback & actions"
          contentClassName="preview-section-content"
        >
          <div
            className="preview-stage-wrap"
            data-ograf-keyboard-scope
            ref={viewportRef}
            style={{ aspectRatio: `${output.width} / ${output.height}` }}
            tabIndex={0}
            aria-label={
              syncEditorPreview
                ? 'Graphic preview synced to editor. Left/Right: editor frames. Space: play or pause the editor Timeline. In fullscreen, right-click or D for controls. Escape: exit fullscreen.'
                : 'Graphic preview. In fullscreen, right-click for controls at the pointer. Left/Right: steps, then templates. Space: next lifecycle step. D: show or hide controls. Escape: exit fullscreen.'
            }
            onMouseDown={(event) => {
              if (
                event.button === 0 &&
                !(event.target as Element).closest('[data-preview-controls]')
              )
                event.currentTarget.focus({ preventScroll: true });
            }}
          >
            <div
              className="preview-stage-measure"
              style={{ width: output.width * zoom, height: output.height * zoom }}
            >
              <div
                className="preview-stage"
                style={{
                  width: output.width,
                  height: output.height,
                  transform: `scale(${zoom})`,
                  ...(previewComposition.backgroundColor === 'transparent'
                    ? transparencyCheckerboardStyle(zoom)
                    : undefined),
                }}
              >
                {!syncEditorPreview && <PresentationBackground />}
                <div className="preview-graphic-content">
                  <div
                    className="preview-render-host"
                    ref={containerRef}
                    hidden={sharedLiveEnabled}
                  />
                  <div
                    className="preview-render-host"
                    ref={sharedContainerRef}
                    hidden={!sharedLiveEnabled}
                  />
                </div>
                <ProgramGuides width={output.width} height={output.height} />
              </div>
              {!syncEditorPreview && !behaviorActive && comparisonAsset && (
                <img
                  className="preview-source-overlay"
                  src={comparisonAsset.dataUri}
                  alt="Source design comparison overlay"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                      setComparisonNaturalSize({
                        assetId: comparisonAsset.id,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      });
                    }
                  }}
                  style={{
                    left: (comparisonGeometry?.x ?? 0) * zoom,
                    top: (comparisonGeometry?.y ?? 0) * zoom,
                    width: (comparisonGeometry?.width ?? 0) * zoom,
                    height: (comparisonGeometry?.height ?? 0) * zoom,
                    opacity: comparisonOpacity,
                    visibility: comparisonGeometry ? 'visible' : 'hidden',
                    transform: `rotate(${comparisonGeometry?.rotation ?? 0}deg)`,
                    transformOrigin: `${(comparisonGeometry?.transformOriginX ?? 0) * 100}% ${(comparisonGeometry?.transformOriginY ?? 0) * 100}%`,
                  }}
                />
              )}
            </div>
            <PreviewFpsOverlay targetRef={viewportRef} active={!presentationSuspended} />
            <aside
              ref={fullscreenControlsRef}
              className="preview-fullscreen-data"
              hidden={!showFullscreenData}
              style={controlsPosition.style}
              aria-label="Preview data and playback controls"
              data-preview-controls
            >
              <div className="preview-popup-body">
                <PreviewControlsHeading position={controlsPosition}>
                  {!syncEditorPreview && (
                    <span className="preview-step-indicator" aria-live="polite">
                      {currentStep === undefined
                        ? 'Off air'
                        : `Step ${currentStep + 1} of ${previewStepCount}`}
                    </span>
                  )}
                </PreviewControlsHeading>
                <PreviewPlayoutControls session={playoutControls} />
                {frameCueLog}
                <p className="preview-fullscreen-data-note">
                  Right-click for controls · Drag to move · D toggles · Escape exits.
                </p>
              </div>
            </aside>
            {(!isPreviewLoaded || playoutControls.error) && (
              <div className="preview-fullscreen-loading">
                {playoutControls.error ? (
                  <PreviewError message={playoutControls.error} />
                ) : (
                  <span role="status">
                    {log.some((entry) => entry.method === 'load' && entry.isError)
                      ? 'Preview could not load. Exit preview to inspect the call log.'
                      : 'Loading preview…'}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="preview-diagnostics-row">
            <small className="preview-zoom-label">Preview {Math.round(zoom * 100)}%</small>
            {!syncEditorPreview && <PreviewFpsControls />}
          </div>

          <ChartRendererUpgradeNotice />

          {fullscreenError && (
            <PreviewError message={fullscreenError} className="preview-fullscreen-error" />
          )}
          {sharedError && (
            <div className="preview-controls-row">
              <PreviewError message={sharedError} />
              {sharedLive.error && (
                <button type="button" onClick={sharedLive.retry}>
                  Retry preview
                </button>
              )}
            </div>
          )}

          <div className="preview-controls">
            {syncEditorPreview ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleFullscreen().catch(() => undefined)}
                >
                  Fullscreen
                </button>
                <PreviewPlayoutControls session={playoutControls} showStatus />
              </>
            ) : (
              <>
                {behaviorActive && (
                  <div className="preview-behavior-status">
                    <span role="status">
                      {behavior.loading ? 'Preparing combined preview…' : behavior.label}
                    </span>
                    <button
                      type="button"
                      disabled={behavior.loading || behavior.busy}
                      onClick={() =>
                        void replayBehaviorPreview().catch((cause) =>
                          setFullscreenError(
                            cause instanceof Error ? cause.message : String(cause),
                          ),
                        )
                      }
                      title="Replay this behavior using the latest draft and template edits"
                    >
                      Replay
                    </button>
                    <button
                      type="button"
                      onClick={clearBehaviorPreview}
                      title="Close behavior preview"
                      aria-label="Close behavior preview"
                    >
                      ×
                    </button>
                    {behavior.sourceChanged && (
                      <small>The design changed. Replay to refresh.</small>
                    )}
                    {behavior.error && <PreviewError message={behavior.error} />}
                  </div>
                )}
                <div className="preview-template-navigation" aria-label="Preview navigation">
                  <button
                    type="button"
                    aria-label={`Navigate backward: ${previewArrowNavigationLabel(-1, currentStep, previewStepCount, templateIndex > 0)}`}
                    disabled={
                      !playoutControls.canNavigate() ||
                      (currentStep === undefined && templateIndex <= 0)
                    }
                    title={`${previewArrowNavigationLabel(-1, currentStep, previewStepCount, templateIndex > 0)} (Left arrow)`}
                    onClick={() => handleArrowNavigation(-1)}
                  >
                    ←
                  </button>
                  <span title={projectSet?.templates[templateIndex]?.name}>
                    {projectSet?.templates[templateIndex]?.name ?? project.name}
                  </span>
                  {templateCount > 1 && (
                    <small>
                      {templateIndex + 1}/{templateCount}
                    </small>
                  )}
                  <button
                    type="button"
                    aria-label={`Navigate forward: ${previewArrowNavigationLabel(1, currentStep, previewStepCount, templateIndex < templateCount - 1)}`}
                    disabled={!playoutControls.canNavigate()}
                    title={`${previewArrowNavigationLabel(1, currentStep, previewStepCount, templateIndex < templateCount - 1)} (Right arrow)`}
                    onClick={() => handleArrowNavigation(1)}
                  >
                    →
                  </button>
                </div>
                <div className="preview-controls-row">
                  <button
                    type="button"
                    title="Show this template's lifecycle preview fullscreen"
                    onClick={() => void handleFullscreen().catch(() => undefined)}
                  >
                    Fullscreen
                  </button>
                  <select
                    aria-label="Playback mode"
                    title="Live previews the current template. Shared Live controls the published viewer session. Rendered steps through time exactly."
                    value={
                      behaviorActive ? 'realtime' : viewingPublishedCopy ? 'shared' : renderType
                    }
                    disabled={behaviorActive}
                    onChange={(e) => {
                      const mode = e.target.value;
                      setRequestedSharedPublication(
                        mode === 'shared' ? availableSharedPublication : null,
                      );
                      setRenderType(mode === 'non-realtime' ? 'non-realtime' : 'realtime');
                    }}
                  >
                    <option value="realtime">Live</option>
                    {availableSharedPublication && <option value="shared">Shared Live</option>}
                    <option value="non-realtime" disabled={usesMediaPaint}>
                      Rendered
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handlePlayAction({ delta: -1 })}
                    disabled={!canControlPreview || currentStep === undefined}
                    title="Go back one step"
                  >
                    {'⏮ Back'}
                  </button>
                  <span className="preview-step-indicator">
                    {currentStep === undefined
                      ? 'Off air'
                      : `On air · step ${currentStep + 1} of ${previewStepCount}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePlayAction({ delta: 1 })}
                    disabled={!canControlPreview}
                    title={
                      currentStep === undefined
                        ? 'Play the graphic in'
                        : 'Continue to the next step, or out after the last one'
                    }
                  >
                    {currentStep === undefined ? 'Take In ▶' : 'Next ⏭'}
                  </button>
                  <button type="button" onClick={handleStop} disabled={!canControlPreview}>
                    Take Out
                  </button>
                </div>
                {playoutControls.viewerSync && (
                  <SyncViewersControl session={playoutControls.viewerSync} />
                )}
                {frameCueLog}

                {!behaviorActive && renderType === 'non-realtime' && (
                  <details className="preview-developer">
                    <summary>Developer · scheduled actions</summary>
                    <div className="preview-schedule">
                      <div className="preview-controls-row">
                        <span className="preview-step-indicator">goToTime</span>
                        <input
                          type="number"
                          className="preview-schedule-timestamp"
                          value={scrubTimestamp}
                          onChange={(e) => setScrubTimestamp(Number(e.target.value))}
                        />
                        <span className="preview-step-indicator">ms</span>
                        <button type="button" onClick={handleGoToTime}>
                          Go to time
                        </button>
                      </div>

                      {scheduleRows.map((row) => (
                        <div key={row.id} className="preview-schedule-row">
                          <input
                            type="number"
                            className="preview-schedule-timestamp"
                            value={row.timestamp}
                            onChange={(e) =>
                              updateScheduleRow(row.id, { timestamp: Number(e.target.value) })
                            }
                          />
                          <span className="preview-step-indicator">ms</span>
                          <select
                            value={row.actionType}
                            onChange={(e) => {
                              const actionType = e.target
                                .value as ScheduledAction['action']['type'];
                              updateScheduleRow(row.id, {
                                actionType,
                                paramsJson: DEFAULT_SCHEDULE_PARAMS_JSON[actionType],
                              });
                            }}
                          >
                            <option value="updateAction">updateAction</option>
                            <option value="playAction">playAction</option>
                            <option value="stopAction">stopAction</option>
                            <option value="customAction">customAction</option>
                          </select>
                          <input
                            type="text"
                            className="preview-schedule-params"
                            value={row.paramsJson}
                            onChange={(e) =>
                              updateScheduleRow(row.id, { paramsJson: e.target.value })
                            }
                          />
                          <button type="button" onClick={() => removeScheduleRow(row.id)}>
                            ✕
                          </button>
                        </div>
                      ))}

                      <div className="preview-controls-row">
                        <button type="button" onClick={addScheduleRow}>
                          + Schedule row
                        </button>
                        <button type="button" onClick={handleSendSchedule}>
                          Send setActionsSchedule
                        </button>
                      </div>
                    </div>
                  </details>
                )}

                {previewFields.length > 0 && (
                  <PreviewDataFields
                    fields={previewFields}
                    values={dataForm}
                    onChange={updateDataField}
                  />
                )}

                {!behaviorActive && descriptor.customActions.length > 0 && (
                  <div className="preview-controls-row">
                    {descriptor.customActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        disabled={!canControlPreview}
                        onClick={() => handleCustomAction(action.id)}
                      >
                        {action.name || action.id}
                      </button>
                    ))}
                  </div>
                )}

                <details className="preview-developer">
                  <summary>
                    Developer · call log
                    {log.some((entry) => entry.isError) ? (
                      <span className="preview-developer-error"> · error</span>
                    ) : null}
                  </summary>
                  <div className="preview-log">
                    {log.length === 0 ? (
                      <p className="panel-placeholder">
                        OGraf calls from the buttons above, with their data and results, appear
                        here.
                      </p>
                    ) : (
                      log.map((entry) => (
                        <div
                          key={entry.id}
                          className={`preview-log-entry${entry.isError ? ' error' : ''}`}
                        >
                          <span className="preview-log-method">{entry.method}</span>
                          <span className="preview-log-params">{entry.paramsSummary}</span>
                          <span className="preview-log-result">{entry.resultSummary}</span>
                        </div>
                      ))
                    )}
                  </div>
                </details>
              </>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          sectionId="preview.broadcast-qa"
          title="Typography & broadcast QA"
          className="data-panel-section"
        >
          <div className="preview-controls-row">
            <PropertyRow
              help={
                'Choose a reference image to overlay on the preview for visual comparison. This QA overlay is not included in the exported graphic.'
              }
              className="preview-data-row"
            >
              <span>Source overlay</span>
              <select
                value={comparisonAssetId}
                onChange={(event) => setComparisonAssetId(event.target.value)}
              >
                <option value="">Off</option>
                {composition.assets
                  .filter((asset) => asset.kind === 'image')
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
              </select>
            </PropertyRow>
            {comparisonAsset && (
              <PropertyRow
                help={
                  'Opacity of the reference overlay, from 0 for invisible to 1 for fully opaque. Lower it to compare the reference with the rendered graphic.'
                }
                className="preview-data-row"
              >
                <span>Overlay opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={comparisonOpacity}
                  onChange={(event) => setComparisonOpacity(Number(event.target.value))}
                />
              </PropertyRow>
            )}
            {comparisonGeometry && (
              <span className="preview-step-indicator">
                {Math.round(comparisonGeometry.width)}×{Math.round(comparisonGeometry.height)} at{' '}
                {Math.round(comparisonGeometry.x)}, {Math.round(comparisonGeometry.y)}
              </span>
            )}
            <PropertyRow
              help={
                "Include interlaced-output checks in broadcast QA. This changes the checks, not the graphic's render mode or frame rate."
              }
              className="preview-data-row"
            >
              <span>Interlaced</span>
              <input
                type="checkbox"
                checked={interlacedQa}
                onChange={(event) => setInterlacedQa(event.target.checked)}
              />
            </PropertyRow>
            <button type="button" disabled={isRunningQa} onClick={() => void handleBroadcastQa()}>
              {isRunningQa ? 'Testing…' : 'Run broadcast QA'}
            </button>
          </div>
          <p className="panel-placeholder">
            Checks on-air safe areas, minimum text size, packaged fonts, backing contrast, optional
            interlaced rules, and long Latin/Turkish/Arabic replacement text in the real browser
            renderer. QA is advisory and does not replace OGraf certification.
          </p>
          {qaIssues && (
            <ul className="preview-qa-results">
              {qaIssues.length === 0 ? (
                <li className="preview-validation-check-valid">✓ No QA warnings.</li>
              ) : (
                qaIssues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`} className={issue.severity}>
                    {issue.severity === 'warning' ? '⚠' : 'ℹ'} [{issue.category}] {issue.message}
                  </li>
                ))
              )}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          sectionId="preview.export"
          title={
            <span className="preview-export-heading">
              <OgrafLogo section />
              Export
            </span>
          }
          ariaLabel="Export"
          className="data-panel-section"
        >
          <div className="preview-controls-row">
            <button type="button" onClick={(event) => requestStudioExport(event.currentTarget)}>
              Export OGraf…
            </button>
          </div>
          <p className="panel-placeholder">
            Choose the scope, files, thumbnail and destination in the Export OGraf dialog.
          </p>
          {hasCurrentTemplate && (
            <>
              <PropertyRow
                help="Choose the playout mode for this compatibility test on the current template."
                className="preview-data-row"
              >
                <span>Compatibility profile</span>
                <select
                  aria-label="Compatibility profile"
                  value={exportProfile.id}
                  disabled={isCheckingCompatibility}
                  onChange={(event) => {
                    setTemplateProfileChoice({
                      projectId: project.id,
                      mode: event.target.value as ExportProfileMode,
                    });
                    setExportStatus('');
                  }}
                >
                  {BUILT_IN_EXPORT_PROFILES.map((profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
                      disabled={usesMediaPaint && profile.mode !== 'realtime'}
                    >
                      {profile.name}
                    </option>
                  ))}
                </select>
              </PropertyRow>
              {playoutWarnings.length > 0 && (
                <aside
                  className="preview-playout-warnings"
                  aria-label="Playout compatibility warnings"
                  role="status"
                >
                  <strong>⚠ Playout compatibility</strong>
                  <ul>
                    {playoutWarnings.map((warning) => (
                      <li key={warning.id}>{warning.message}</li>
                    ))}
                  </ul>
                </aside>
              )}
              <p className={`preview-validation${validation.valid ? '' : ' invalid'}`}>
                {validation.valid
                  ? '✓ Manifest schema precheck passed.'
                  : `✕ ${validation.errors.length} manifest issue(s):`}
              </p>
              {!validation.valid && (
                <ul className="preview-validation-errors">
                  {validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
              {compatibility && (
                <ul className="preview-validation-errors">
                  {compatibility.checks.map((check) => (
                    <li
                      key={check.id}
                      className={check.valid ? 'preview-validation-check-valid' : undefined}
                    >
                      {check.valid ? '✓' : '✕'} {check.label}
                      {!check.valid && check.errors.length > 0
                        ? ` — ${check.errors.join(' ')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="preview-controls-row">
                <button
                  type="button"
                  onClick={handleCompatibilityCheck}
                  disabled={isCheckingCompatibility}
                >
                  {isCheckingCompatibility ? 'Testing…' : 'Run compatibility test'}
                </button>
              </div>
              {exportStatus && (
                <p className="preview-export-status" role="status">
                  {exportStatus}
                </p>
              )}
            </>
          )}
          <SharedPlayoutLinks />
        </CollapsibleSection>
      </div>
    </Panel>
  );
}
