import { canvasAutoKeyframe, canvasFrame, useCanvasViewStore } from './canvasViewStore';
import { create } from 'zustand';
import { current, isDraft, produce } from 'immer';
import {
  normalizeCanvasCrop,
  validateLogicFunctionDefinitions,
  assertLogicFunctionReferenceRemovable,
  type LogicFunctionDefinition,
  normalizeDataConnection,
  MAX_DATA_CONNECTIONS,
  layerCropErrors,
  type CropRect,
  type LayerCrop,
  textPathReferenceErrors,
  textPathCompatibilityErrors,
  layerExportKeyError,
  frameCueErrors,
  MAX_FRAME_CUES,
  type FrameCue,
} from '@ograf-editor/scene-model';
import { immer } from 'zustand/middleware/immer';
import { useProjectSetStore } from './projectSetStore';
import { onAirFrame } from './onAirFrame';
import {
  compactFreshRecipeTiming,
  createUiProject,
  isUntouchedBlankTiming,
  setNewCompositionTiming,
} from './newTemplateTiming';
import { synchronizeSetComponentLibrary } from './componentSetLibrary';
import { planChartRendererUpgrade } from './chartRendererUpgrade';
import {
  rendererPluginKey,
  MAX_RENDERER_PLUGIN_CATALOG_ENTRIES,
  MAX_RENDERER_PLUGIN_CATALOG_BYTES,
  rendererPluginByteLength,
  validateRendererPluginReference,
  validateRendererPluginSnapshot,
  applyAnimationPreset,
  applyChartMarkAnimationPreset,
  chartRendererFeatureErrors,
  isAnimationPresetPluginSnapshot,
  isShaderPackPluginSnapshot,
  resolveShaderPackPresetPaint,
  studioPluginReference,
  type AnimationPresetApplyOptions,
  type ChartMarkAnimationOptions,
  type StudioPluginReference,
  type ShaderPackPluginSnapshot,
  type ShaderPackPresetTarget,
  type ChartPreset,
  type RendererPluginReference,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import {
  rendererPluginReference,
  useRendererPluginSettingsStore,
  isInstalledChartPlugin,
  assertStudioPluginsAllowed,
} from './pluginSettingsStore';
import {
  applyPathEdit,
  type PathEdit,
  assertMaskSourcesRemovable,
  assertModifierSourcesRemovable,
  assertModifierGroupCopySafe,
  applyModifierSafeGroupChanges,
  layerModifierFieldIds,
  layerModifiersErrors,
  remapLayerModifierReferences,
  layerMaskErrors,
  addEffect,
  ensureLegacyEffects,
  updateEffect,
  removeEffect,
  duplicateEffect,
  reorderEffects,
  effectProperty,
  effectParameterSpec,
  getEffectStack,
  effectParams,
  type EffectType,
  type EffectPatch,
  applyDesignTokenBinding,
  markTypographyOverrides,
  bindFieldDefaultToken,
  syncDesignToken,
  stylePackColorUsesToken,
  applyStylePack,
  setTilingPattern,
  getPatternPresetPatch,
  setLayerLighting,
  layerLightingErrors,
  type PatternLightingLink,
  type TilingPatternPatch,
  removeTilingPattern,
  addTilingPatternLayer,
  removeStylePack,
  findAssetConsumers,
  buildComponentDefinition,
  updateComponentDefinitionFromLayers,
  refreshComponentDependencies,
  remapClockTimerLayerActions,
  linkExistingComponentLayers,
  reconcileProjectComponentInstances,
  resetComponentInstanceOverrides,
  makeComponentInstanceUnique as makeUniqueComponentInstance,
  createCustomActionDefinition,
  createFieldDefinition,
  cloneFieldDefinitionWithFreshIds,
  createId,
  createKeyframe,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createMediaCue,
  createLayerVisualRule,
  applyLayerMotion,
  layerMotionStaggerOffsets,
  layerMotionWindows,
  pruneVisualRuleReferences,
  rehomeVisualRuleGroupOwners,
  remapVisualRule,
  renameVisualRuleCustomAction,
  visualRuleFieldIds,
  isVisualRuleMouseFieldId,
  createShaderPaint,
  createShaderResource as createStoredShaderResource,
  createRectangleElement,
  inspectShaderElement,
  inspectShaderSource,
  inspectShaderResourcePaint,
  getElementShaderPaints,
  getElementShaderPaint,
  hasElementMediaPaint,
  getShaderAnimatableProperties,
  getShaderAnimationValue,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  clampShaderAnimationValue,
  applyShaderAnimationValues,
  applyElementDataValue,
  shaderParameterTarget,
  isGradientPaint,
  isMediaPaint,
  isShaderPaint,
  normalizeMediaPaint,
  normalizeTextAnimation,
  normalizeClockTimerSettings,
  syncShaderParameterFields,
  syncCompositionShaderParameterFields,
  syncDesignerBindingDefaults,
  syncDesignerTransformBindingDefaults,
  createTransition,
  defaultTransformForRole,
  findLayerKeyframeAtFrame,
  findLayerPropertyKeyframeAtFrame,
  getLayerEffectsAtFrame,
  getPaintAtFrame,
  getLayerPropertyValueAtFrame,
  isLayerPropertyAnimated,
  resetLayerPropertyAnimation as resetPropertyAnimation,
  syncResetShaderParameterDefault,
  gradientStopIndexForProperty,
  parseEffectProperty,
  parseModifierProperty,
  withEffectParameter,
  withModifierParameter,
  getResolvedLayerAnimationTracks,
  getLayerTransformAtFrame,
  getTotalFrames,
  migrateProject,
  materializeLowerThird,
  materializeBug,
  materializeClock,
  materializeCountdown,
  materializeScoreboard,
  materializeTicker,
  materializeRepeater,
  instantiateComponentDefinition,
  refreshComponentInstances,
  normalizeLayerEffects,
  normalizeDesignTokenValue,
  pruneInvalidGradientStopTracks,
  normalizeAuthoredTransformPatch,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
  TRANSFORM_ANIMATION_PROPERTIES,
  EFFECT_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
  type Asset,
  type TestDataRundown,
  testRundownErrors,
  type AudioElement,
  type ChartElement,
  type ClockTimerSettings,
  type BlendMode,
  type DesignToken,
  type DesignTokenTargetProperty,
  type DesignTokenType,
  type Composition,
  type ComponentDefinition,
  type CompositionLayout,
  type CubicBezierCurve,
  type CustomActionDefinition,
  type EasingPreset,
  type EllipseElement,
  type FieldDefinition,
  type FieldType,
  type ImageElement,
  type ImageSequenceElement,
  type LottieElement,
  type MediaCue,
  type ShaderElement,
  type ShaderPaint,
  type ShaderPaintSlot,
  type ShaderParameterValue,
  type LayerKeyframe,
  type LayerPropertyKeyframe,
  type LayerLoopActivation,
  type Layer,
  type LayerBinding,
  type LayerEffects,
  type LayerSemantics,
  type LayerTransform,
  type LayerConstraints,
  type LayerAutoLayout,
  type LayerVisualRule,
  type LayerMotionSide,
  type LayerMotionSpec,
  type LayerMotionStagger,
  type VisualRuleTrigger,
  type DataConnectionDefinition,
  DEFAULT_LAYER_AUTO_LAYOUT,
  retimeAnimationPhase as retimeAnimationPhaseModel,
  type AnimationRetimePhase,
  type AnimationRetimeResult,
  type NewLayerKind,
  type MaterializedLowerThird,
  type MaterializedBroadcastRecipe,
  type MaterializedRepeater,
  type AppliedStylePack,
  type StylePackId,
  type PathElement,
  type Paint,
  type Project,
  type RectangleElement,
  type RuntimeCollectionDefinition,
  type TextElement,
  type TickerElement,
  normalizeTicker,
  tickerErrors,
} from '@ograf-editor/scene-model';
import {
  alignedPatches,
  distributedPatches,
  resizeConstrainedTransform,
  type AlignmentMode,
  type DistributionMode,
} from '../canvas/layoutGeometry';
import { useTimelineStore } from './timelineStore';
import { getEditorLoopSample } from './editorLoopSample';
import { nextTimerAlarm } from './timerAlarmRules';
import { useLayerClipboardStore } from './layerClipboardStore';
import { planLifecycleRetime, type LifecycleRetimePlan } from './lifecycleRetime';
import { buildSvgBundle } from './svgBundleImport';
import { placeImages, prepareImage, readImageSize, type ImagePlacement } from './imageImport';
import { prepareAssetImport } from './assetImport';
import { createNextBinding, createPlayoutBinding, playoutProperty } from './bindingFieldCreation';
import { useTestDataStore } from './testDataStore';
import { resolveDesignerElement, resolveDesignerEffects } from './dataBinding';
import { resolvePreviewFieldValue } from './previewFieldValue';
import {
  defaultShaderResourceName,
  isStoredShaderResourceTarget,
  resolveShaderResource,
  shaderPaintWithPatch,
  type ShaderResourceTarget,
  type ShaderResourcePatch,
  type StoredShaderResourceTarget,
} from './shaderResources';
import { shaderPackLayerTargetReason } from '../panels/shaderPackGalleryHelpers';

/** Compare editable content, not the user's display name or object property insertion order. */
function shaderLibraryContentKey(paint: ShaderPaint): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  const { name: _name, ...content } = paint;
  return JSON.stringify(canonical(content));
}

/** Approval is local and exact; a preset must never fall back to another version or chart default. */
function installedShaderPack(reference: StudioPluginReference): ShaderPackPluginSnapshot {
  const errors = validateRendererPluginReference(reference);
  if (errors.length) throw new Error(errors.join(' '));
  const entry = useRendererPluginSettingsStore
    .getState()
    .installed.find(
      (candidate) =>
        candidate.enabled &&
        candidate.trusted &&
        isShaderPackPluginSnapshot(candidate.snapshot) &&
        rendererPluginKey(studioPluginReference(candidate.snapshot)) ===
          rendererPluginKey(reference),
    );
  if (!entry || !isShaderPackPluginSnapshot(entry.snapshot))
    throw new Error('Install, review and enable this exact shader pack in Plugins first.');
  assertStudioPluginsAllowed([entry.snapshot]);
  return entry.snapshot;
}

export type { NewLayerKind } from '@ograf-editor/scene-model';

export type ElementFields = { fill: Paint } & Omit<RectangleElement, 'type' | 'fill'> & {
    patternId: string;
  } & Omit<EllipseElement, 'type' | 'fill'> &
  Omit<TextElement, 'type' | 'fill' | 'clock' | 'direction'> & {
    clock?: ClockTimerSettings | null;
    direction: TextElement['direction'] | TickerElement['direction'];
  } & Omit<ImageElement, 'type' | 'fill'> &
  Omit<AudioElement, 'type'> &
  Omit<PathElement, 'type' | 'fill'> &
  Omit<ImageSequenceElement, 'type' | 'fill'> &
  Omit<LottieElement, 'type' | 'fill'> &
  Omit<ChartElement, 'type'> &
  Omit<TickerElement, 'type' | 'direction'> &
  Omit<ShaderElement, 'type'>;

interface ProjectState {
  project: Project;
  /** Editor-only load boundary; same-set template navigation does not open a new document. */
  documentLoadRevision: number;
  activeCompositionId: string;
  activeKeyframeId: string;
}

interface ProjectActions {
  setLayerLighting: (layerId: string | string[], link: PatternLightingLink | null) => void;
  placeImageSource: (
    source: File[] | { assetId: string },
    options?: ImagePlacement,
  ) => Promise<string[]>;
  newProject: () => void;
  loadProject: (
    project: Project,
    options?: {
      freshUiTemplate?: boolean;
      preserveFreshUiIdentity?: boolean;
      setNavigationId?: string;
      setTemplateId?: string | null;
      previousTemplateId?: string | null;
    },
  ) => void;
  /** Checkpoint non-serialized fresh-template bookkeeping for a failed session transaction. */
  captureFreshTemplateSession: () => () => void;
  setActiveComposition: (compositionId: string) => void;
  setCompositionCrop: (crop: CropRect | undefined) => void;
  setProjectMeta: (
    patch: Partial<
      Pick<
        Project,
        | 'id'
        | 'name'
        | 'description'
        | 'version'
        | 'supportsRealTime'
        | 'supportsNonRealTime'
        | 'thumbnailFrame'
      >
    >,
  ) => void;
  updateCompositionSettings: (
    patch: Partial<
      Pick<
        Composition,
        | 'name'
        | 'width'
        | 'height'
        | 'frameRate'
        | 'updateTransitionFrames'
        | 'shortOutFrames'
        | 'updateInterruption'
        | 'backgroundColor'
      >
    >,
  ) => void;
  updateCompositionLayout: (patch: Partial<Omit<CompositionLayout, 'guides'>>) => void;
  addCanvasGuide: (axis: 'vertical' | 'horizontal', position?: number) => string;
  updateCanvasGuide: (guideId: string, position: number) => void;
  removeCanvasGuide: (guideId: string) => void;

  addMediaCueFromAsset: (assetId: string) => string;
  addSoundEventFromAsset: (assetId: string, frame?: number) => string;
  /** An audio cue that only rules start: manual trigger, never on the timeline by itself. */
  addRuleSoundFromAsset: (assetId: string) => string;
  addLiveMediaCue: () => string;
  updateMediaCue: (cueId: string, patch: Partial<MediaCue>) => void;
  removeMediaCue: (cueId: string) => void;
  addFrameCue: (frame: number) => string;
  updateFrameCue: (cueId: string, cue: Omit<FrameCue, 'id'>) => void;
  removeFrameCue: (cueId: string) => void;

  addLayer: (
    kind: NewLayerKind,
    placement?: { x: number; y: number; groupId?: string; parentId?: string },
  ) => string;
  addDrawnPath: (path: {
    d: string;
    x: number;
    y: number;
    width: number;
    height: number;
    closed: boolean;
  }) => string;
  /** A gallery choice always supplies an exact installed plugin version. */
  addChartLayer: (
    preset: ChartPreset,
    provider: RendererPluginReference,
    placement?: { x: number; y: number; groupId?: string; parentId?: string },
  ) => string;
  setTilingPattern: (patch: TilingPatternPatch, patternId?: string) => string;
  removeTilingPattern: (patternId: string) => void;
  addPatternInstance: (
    patternId: string,
    placement?: { x: number; y: number; groupId?: string; parentId?: string },
  ) => string;
  createPatternResource: (
    patch: TilingPatternPatch,
    addToCanvas?: boolean,
    placement?: { x: number; y: number; groupId?: string; parentId?: string },
  ) => { patternId: string; layerId?: string };
  duplicatePatternResource: (patternId: string) => string;
  makePatternIndependent: (layerId: string) => string;
  addLowerThird: () => MaterializedLowerThird;
  addBug: () => MaterializedBroadcastRecipe;
  addTicker: () => MaterializedBroadcastRecipe;
  addScoreboard: () => MaterializedBroadcastRecipe;
  addClock: () => MaterializedBroadcastRecipe;
  addCountdown: () => MaterializedBroadcastRecipe;
  addRepeater: (
    layerIds: string[],
    count?: number,
    direction?: 'horizontal' | 'vertical',
    gap?: number,
  ) => MaterializedRepeater | null;
  pasteLayers: (layers: Layer[], offset?: number) => string[];
  duplicateLayers: (layerIds: string[]) => string[];
  removeLayer: (layerId: string) => void;
  updateLayerTransform: (layerId: string, frame: number, patch: Partial<LayerTransform>) => void;
  addLayerKeyframe: (
    layerId: string,
    frame: number,
    options?: { includeEffects?: boolean },
  ) => string;
  addLayerHoldFrame: (layerId: string, frame: number) => string;
  moveLayerKeyframe: (layerId: string, keyframeId: string, frame: number) => void;
  moveTimelineKeyframesTogether: (
    keyframes: Array<{
      layerId: string;
      property: AnimatableLayerProperty | null;
      keyframeId: string;
    }>,
    deltaFrames: number,
  ) => number;
  removeLayerKeyframe: (layerId: string, keyframeId: string) => void;
  updateLayerKeyframeEasing: (layerId: string, keyframeId: string, easing: EasingPreset) => void;
  addLayerPropertyKeyframe: (
    layerId: string,
    property: AnimatableLayerProperty,
    frame: number,
  ) => string;
  enableLayerPropertyAnimation: (
    layerId: string,
    property: AnimatableLayerProperty,
    frame: number,
  ) => string;
  toggleLayerPropertyKeyframe: (
    layerId: string,
    property: AnimatableLayerProperty,
    frame: number,
  ) => string | null;
  resetLayerPropertyAnimation: (
    layerId: string,
    property: AnimatableLayerProperty,
    frame: number,
  ) => void;
  moveLayerPropertyKeyframe: (
    layerId: string,
    property: AnimatableLayerProperty,
    keyframeId: string,
    frame: number,
  ) => void;
  removeLayerPropertyKeyframe: (
    layerId: string,
    property: AnimatableLayerProperty,
    keyframeId: string,
  ) => void;
  updateLayerPropertyKeyframeEasing: (
    layerId: string,
    property: AnimatableLayerProperty,
    keyframeId: string,
    easing: EasingPreset,
  ) => void;
  updateLayerPropertyKeyframeCurve: (
    layerId: string,
    property: AnimatableLayerProperty,
    keyframeId: string,
    curve: CubicBezierCurve | null,
  ) => void;
  offsetLayerPropertyTrack: (
    layerId: string,
    property: AnimatableLayerProperty,
    deltaFrames: number,
  ) => void;
  scaleLayerPropertyTrack: (
    layerId: string,
    property: AnimatableLayerProperty,
    scale: number,
  ) => void;
  reverseLayerPropertyTrack: (layerId: string, property: AnimatableLayerProperty) => void;
  distributeLayerPropertyTrack: (layerId: string, property: AnimatableLayerProperty) => void;
  setLayerLoop: (
    layerId: string,
    patch: Partial<{
      name: string;
      activation: LayerLoopActivation;
      durationFrames: number;
      phaseOffsetFrames: number;
      repeatCount: number | null;
      timing: import('@ograf-editor/scene-model').LayerLoopClip['timing'] | null;
    }>,
  ) => void;
  setLayerLoopPropertyTrack: (
    layerId: string,
    property: AnimatableLayerProperty,
    keys: LayerPropertyKeyframe[],
  ) => void;
  removeLayerLoop: (layerId: string) => void;
  updateLayerElement: (layerId: string, patch: Partial<ElementFields>) => void;
  selectChartProvider: (layerId: string, provider: RendererPluginReference) => void;
  upgradeChartRenderer: (from: RendererPluginReference, to: RendererPluginReference) => void;
  editLayerPath: (layerId: string, edit: PathEdit, frame?: number) => void;
  updateLayerTextStroke: (
    layerId: string,
    frame: number,
    patch: Partial<Pick<TextElement, 'strokeColor' | 'strokeWidth' | 'strokePaint'>>,
  ) => void;
  updateLayerPaint: (layerId: string, frame: number, paint: Paint | undefined) => void;
  createShaderResource: (paint?: ShaderPaint) => StoredShaderResourceTarget;
  ensureShaderResource: (paint: ShaderPaint) => StoredShaderResourceTarget;
  applyShaderPaintToLayers: (
    layerIds: string | readonly string[],
    paint: ShaderPaint,
    target: ShaderPackPresetTarget,
    options?: { saveResource?: boolean },
  ) => void;
  applyShaderPackPreset: (
    layerIds: string | readonly string[],
    reference: StudioPluginReference,
    presetId: string,
    target: ShaderPackPresetTarget,
  ) => void;
  importShaderPackPreset: (
    reference: StudioPluginReference,
    presetId: string,
    target: ShaderPackPresetTarget,
  ) => StoredShaderResourceTarget;
  updateShaderResource: (target: ShaderResourceTarget, patch: ShaderResourcePatch) => void;
  updateLayerShaderParameter: (
    layerId: string,
    frame: number,
    slot: ShaderPaintSlot,
    name: string,
    value: ShaderParameterValue,
  ) => void;
  updateLayerPropertyKeyframeValue: (
    layerId: string,
    property: AnimatableLayerProperty,
    keyframeId: string,
    value: number,
  ) => void;
  removeShaderResource: (target: ShaderResourceTarget) => void;
  updateLayerEffects: (layerId: string, frame: number, patch: Partial<LayerEffects>) => void;
  addLayerEffect: (layerId: string, type: EffectType, patch?: EffectPatch) => void;
  updateLayerEffect: (layerId: string, effectId: string, patch: EffectPatch, frame: number) => void;
  removeLayerEffect: (layerId: string, effectId: string) => void;
  duplicateLayerEffect: (layerId: string, effectId: string) => void;
  reorderLayerEffects: (layerId: string, effectIds: string[]) => void;
  addGroupEffect: (layerIds: string[], type: EffectType, patch?: EffectPatch) => void;
  updateGroupEffect: (
    layerIds: string[],
    effectId: string,
    patch: EffectPatch,
    frame: number,
  ) => void;
  removeGroupEffect: (layerIds: string[], effectId: string) => void;
  duplicateGroupEffect: (layerIds: string[], effectId: string) => void;
  reorderGroupEffects: (layerIds: string[], effectIds: string[]) => void;
  renameLayer: (layerId: string, name: string) => void;
  setLayerExportKey: (layerId: string, key: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerGuide: (layerId: string) => void;
  setLayerBlendMode: (layerId: string, blendMode: BlendMode) => void;
  toggleLayerLock: (layerId: string) => void;
  groupLayers: (layerIds: string[]) => string | null;
  ungroupLayers: (layerIds: string[]) => void;
  setLayerParent: (layerId: string, parentId: string | null) => void;
  setLayerClipChildren: (layerId: string, clipChildren: boolean) => void;
  setLayerCrops: (crops: Record<string, LayerCrop | undefined>) => void;
  setLayerMask: (layerId: string, mask: Layer['mask'], hideSource?: boolean) => void;
  setLayerMaskOnly: (layerId: string, value: boolean) => void;
  setLayerConstraints: (layerId: string, constraints: Partial<LayerConstraints>) => void;
  setLayerAutoLayout: (layerId: string, layout: Partial<LayerAutoLayout>) => void;
  setLayerUpdateTransition: (layerId: string, patch: Partial<Layer['updateTransition']>) => void;
  setLayerMotionPath: (layerId: string, link: Layer['motionPath']) => void;
  setLayerMotionBlur: (layerId: string, value: NonNullable<Layer['motionBlur']>) => void;
  setLayerTextPath: (layerId: string, link: Layer['textPath']) => void;
  addLayerVisualRule: (layerId: string, trigger?: VisualRuleTrigger) => string | null;
  /** Create one linked alarm and its ordinary Rule atomically. */
  addClockTimerAlarm: (layerId: string) => string | null;
  updateLayerVisualRule: (
    layerId: string,
    ruleId: string,
    patch: Partial<Omit<LayerVisualRule, 'id'>>,
  ) => void;
  /** Moves a rule to another editable object, preserving explicit action targets and its identity. */
  retargetLayerVisualRule: (
    sourceLayerId: string,
    ruleId: string,
    targetLayerId: string,
    hostGroupId?: string,
  ) => boolean;
  moveLayerVisualRule: (layerId: string, ruleId: string, direction: -1 | 1) => void;
  duplicateLayerVisualRule: (layerId: string, ruleId: string) => string | null;
  /**
   * Bakes an Animate In or Out choice into each unlocked layer's tracks. A stagger spreads the
   * layers' timing in the given order, replacing each spec's own `offsetFrames`.
   */
  setLayerMotion: (
    layerIds: string | string[],
    side: LayerMotionSide,
    spec: LayerMotionSpec | null,
    stagger?: LayerMotionStagger,
  ) => void;
  applyLayerAnimationPreset: (
    layerIds: string | readonly string[],
    reference: StudioPluginReference,
    presetId: string,
    side: LayerMotionSide,
    options: AnimationPresetApplyOptions,
  ) => void;
  applyChartMarkPreset: (
    layerId: string,
    reference: StudioPluginReference,
    presetId: string,
    side: LayerMotionSide,
    options: ChartMarkAnimationOptions,
  ) => void;
  clearChartMarkPreset: (layerId: string, side: LayerMotionSide) => void;
  /** Replaces a whole rule, which lets the editor drop optional keys. */
  replaceLayerVisualRule: (layerId: string, ruleId: string, rule: LayerVisualRule) => void;
  removeLayerVisualRule: (layerId: string, ruleId: string) => void;
  addDataConnection: () => string;
  updateDataConnection: (
    connectionId: string,
    patch: Partial<Omit<DataConnectionDefinition, 'id'>>,
  ) => void;
  removeDataConnection: (connectionId: string) => void;
  setLayerSemantics: (layerId: string, patch: Partial<LayerSemantics>) => void;
  setDesignSystemName: (name: string) => void;
  applyStylePack: (stylePack: StylePackId) => AppliedStylePack;
  removeStylePack: () => void;
  addDesignToken: (type?: DesignTokenType) => string;
  updateDesignToken: (tokenId: string, patch: Partial<Omit<DesignToken, 'id'>>) => void;
  removeDesignToken: (tokenId: string) => void;
  bindDesignToken: (
    layerId: string,
    tokenId: string,
    targetProperty: DesignTokenTargetProperty,
  ) => void;
  unbindDesignToken: (layerId: string, targetProperty: DesignTokenTargetProperty) => void;
  createTimelineFolder: (layerIds: string[]) => string | null;
  renameTimelineFolder: (folderId: string, name: string) => void;
  setTimelineFolderColor: (folderId: string, color: string) => void;
  removeTimelineFolder: (folderId: string) => void;
  alignLayers: (layerIds: string[], frame: number, mode: AlignmentMode) => void;
  distributeLayers: (layerIds: string[], frame: number, mode: DistributionMode) => void;
  reorderLayers: (orderedLayerIds: string[]) => void;

  setActiveKeyframe: (keyframeId: string) => void;
  addKeyframe: () => string;
  removeKeyframe: (keyframeId: string) => void;
  renameKeyframe: (keyframeId: string, name: string) => void;
  updateTransition: (
    transitionId: string,
    patch: Partial<{ durationFrames: number; easing: EasingPreset }>,
  ) => void;
  moveLifecycleKeyframe: (keyframeId: string, targetFrame: number) => LifecycleRetimePlan | null;
  retimeAnimationPhase: (
    phase: AnimationRetimePhase,
    targetFrames: number,
  ) => AnimationRetimeResult;

  addDataField: (type: FieldType) => string;
  setLogicFunctions: (functions: LogicFunctionDefinition[], compositionId?: string) => void;
  removeDataField: (fieldId: string) => void;
  updateDataField: (
    fieldId: string,
    patch: Partial<
      Pick<
        FieldDefinition,
        | 'key'
        | 'label'
        | 'description'
        | 'type'
        | 'defaultValue'
        | 'defaultTokenId'
        | 'required'
        | 'exposeToOgraf'
        | 'options'
        | 'constraints'
        | 'fileExtensions'
        | 'properties'
        | 'items'
        | 'nodosType'
      >
    >,
  ) => void;
  /** Expose or hide complete field schemas together as one undoable edit. */
  setDataFieldsExposure: (fieldIds: readonly string[], exposed: boolean) => void;
  setNodosInputFields: (fieldIds: readonly string[]) => void;
  setLayerBindings: (layerId: string, bindings: LayerBinding[]) => void;
  addLayerBinding: (layerId: string) => string | null;
  /** Creates or removes the one field + binding that lets playout fill this layer's content. */
  setLayerPlayoutEditable: (layerId: string, editable: boolean) => void;
  addRuntimeCollection: (
    fieldId: string,
    prototypeLayerIds: string[],
    offsetPerItem: { x: number; y: number },
    capacity: number,
  ) => string;
  updateRuntimeCollection: (
    collectionId: string,
    patch: Partial<
      Pick<
        RuntimeCollectionDefinition,
        | 'name'
        | 'fieldId'
        | 'prototypeLayerIds'
        | 'offsetPerItem'
        | 'capacity'
        | 'itemKeyPath'
        | 'sortPath'
        | 'sortDirection'
        | 'pageSize'
        | 'page'
      >
    >,
  ) => void;
  removeRuntimeCollection: (collectionId: string) => void;

  addCustomAction: () => string;
  removeCustomAction: (actionDefId: string) => void;
  updateCustomAction: (
    actionDefId: string,
    patch: Partial<Pick<CustomActionDefinition, 'actionId' | 'name' | 'description'>>,
  ) => void;

  /** Reads `file` as a `data:` URI and adds it to the active composition's asset registry. */
  setTestRundowns: (rundowns: TestDataRundown[]) => void;
  importAsset: (file: File) => Promise<string>;
  addPreparedAsset: (asset: Asset) => string;
  importSvgBundle: (files: File[]) => Promise<{ assetId: string; warnings: string[] }>;
  updateAsset: (
    assetId: string,
    patch: Partial<
      Pick<
        Asset,
        | 'name'
        | 'packagePath'
        | 'fontFamily'
        | 'fontWeight'
        | 'fontStyle'
        | 'licenseName'
        | 'licenseUrl'
        | 'licenseText'
      >
    >,
  ) => void;
  removeAsset: (assetId: string) => void;
  createComponent: (layerIds: string[], name?: string) => string | null;
  instantiateComponent: (
    componentId: string,
    offset?: { x: number; y: number },
    linked?: boolean,
  ) => string[];
  updateComponentFromLayers: (componentId: string, layerIds: string[]) => boolean;
  updateComponentLayer: (
    componentId: string,
    sourceLayerId: string,
    patch: Partial<Omit<Layer, 'id' | 'componentLink'>>,
  ) => void;
  updateComponentField: (
    componentId: string,
    sourceFieldId: string,
    patch: Partial<FieldDefinition>,
  ) => void;
  bindComponentClockValue: (
    componentId: string,
    sourceLayerId: string,
    fieldId?: string | null,
  ) => void;
  resetComponentOverrides: (layerIds: string[], paths?: string[]) => void;
  makeComponentInstanceUnique: (instanceId: string) => string | null;
  refreshLinkedComponentInstances: (componentId: string) => string[];
  renameComponent: (componentId: string, name: string) => void;
  removeComponent: (componentId: string) => void;
}

function generateUniqueKey(existingKeys: string[], prefix: string): string {
  const used = new Set(existingKeys);
  let n = existingKeys.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function createRuleConditionField(composition: Composition, layer: Layer): FieldDefinition {
  const key = generateUniqueKey(
    composition.dataFields.map((candidate) => candidate.key),
    'ruleCondition',
  );
  const field = createFieldDefinition('text', { key, label: `${layer.name} condition` });
  composition.dataFields.push(field);
  return field;
}

function nextVisualRuleName(composition: Composition, copiedName?: string): string {
  const names = composition.layers.flatMap((layer) =>
    (layer.visualRules ?? []).map((rule) => rule.name.trim().toLowerCase()),
  );
  const used = new Set(names);
  const numbered = /^rule #(\d+)$/i;
  if (
    copiedName?.trim() &&
    !numbered.test(copiedName.trim()) &&
    !/^visual rule$/i.test(copiedName.trim())
  ) {
    const base = `${copiedName.trim()} copy`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${base} ${suffix++}`;
    return candidate;
  }
  let highest = 0n;
  for (const name of names) {
    const match = numbered.exec(name);
    if (match) {
      const number = BigInt(match[1]!);
      if (number > highest) highest = number;
    }
  }
  return `Rule #${highest + 1n}`;
}

export type ProjectStore = ProjectState & ProjectActions;

export function getActiveComposition(project: Project, activeCompositionId: string): Composition {
  const composition = project.compositions.find((c) => c.id === activeCompositionId);
  if (!composition) {
    throw new Error(`Active composition not found: ${activeCompositionId}`);
  }
  return composition;
}

function updateEffectAtFrame(
  composition: Composition,
  layer: Layer,
  effectId: string,
  patch: EffectPatch,
  frame: number,
): void {
  const boundedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
  const existingEffect = getEffectStack(layer.effects).find((effect) => effect.id === effectId);
  if (!existingEffect) throw new Error(`Effect not found: ${effectId}`);
  const before = Object.fromEntries(
    Object.entries(patch.params ?? {}).flatMap(([param, value]) => {
      if (typeof value !== 'number') return [];
      const property = effectProperty(existingEffect, param) as AnimatableLayerProperty;
      return [[param, getLayerPropertyValueAtFrame(layer, property, boundedFrame)]];
    }),
  );
  const effect = updateEffect(layer, effectId, patch);
  for (const [param, value] of Object.entries(effectParams(effect, layer.effects))) {
    if (typeof value !== 'number' || before[param] === undefined) continue;
    const property = effectProperty(effect, param) as AnimatableLayerProperty;
    if (!keyPropertyEdit(layer, property, boundedFrame, value, before[param]!))
      offsetExistingPropertyKeys(layer, property, value - before[param]!);
  }
}

function getDefaultAuthoringKeyframeId(composition: Composition): string {
  return (
    (
      composition.keyframes.find((keyframe) => keyframe.role === 'step') ??
      composition.keyframes.find((keyframe) => keyframe.role === 'start') ??
      composition.keyframes[0]
    )?.id ?? ''
  );
}

function materializeAnimationTracks(layer: Layer): void {
  const resolved =
    layer.animationTrackMode === 'independent'
      ? layer.animationTracks
      : getResolvedLayerAnimationTracks(layer);
  layer.animationTracks = Object.fromEntries(
    Object.entries(resolved).map(([property, keyframes]) => [
      property,
      keyframes?.map((keyframe) => ({ ...keyframe })) ?? [],
    ]),
  );
}

/** A new object is static until its designer explicitly keys a property. */
function insertNewLayer(
  composition: Composition,
  layer: Layer,
  kind: NewLayerKind,
  placement?: {
    x: number;
    y: number;
    groupId?: string;
    parentId?: string;
    width?: number;
    height?: number;
  },
): void {
  if (placement?.groupId) layer.groupId = placement.groupId;
  if (placement?.parentId) layer.parentId = placement.parentId;
  layer.animationTrackMode = 'independent';
  layer.animationTracks = {};
  layer.keyframes = [
    createLayerKeyframe(0, {
      ...defaultTransformForRole(kind, 'step'),
      ...(placement
        ? {
            x: placement.x,
            y: placement.y,
            ...(placement.width !== undefined ? { width: placement.width } : {}),
            ...(placement.height !== undefined ? { height: placement.height } : {}),
          }
        : {}),
    }),
  ];
  composition.layers.push(layer);
  syncShaderParameterFields(composition, layer);
}

function placePatternLayer(
  composition: Composition,
  layerId: string,
  placement?: { x: number; y: number; groupId?: string; parentId?: string },
): void {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error('The new pattern layer is unavailable.');
  if (placement?.groupId) layer.groupId = placement.groupId;
  if (placement?.parentId) layer.parentId = placement.parentId;
  const transform = getLayerTransformAtFrame(layer, 0);
  if (placement) Object.assign(transform, { x: placement.x, y: placement.y });
  layer.animationTrackMode = 'independent';
  layer.animationTracks = {};
  layer.keyframes = [createLayerKeyframe(0, transform)];
}

const CHART_LAYER_PRESETS: Record<ChartPreset, true> = {
  bar: true,
  'horizontal-bar': true,
  'stacked-bar': true,
  line: true,
  area: true,
  pie: true,
  doughnut: true,
  radar: true,
  'polar-area': true,
};

function selectedChartRendererSnapshot(provider: RendererPluginReference): RendererPluginSnapshot {
  if (!provider) throw new Error('Select an installed chart renderer plugin first.');
  const referenceErrors = validateRendererPluginReference(provider);
  if (referenceErrors.length) throw new Error(referenceErrors.join(' '));
  const installed = useRendererPluginSettingsStore
    .getState()
    .installed.find(
      (entry) =>
        isInstalledChartPlugin(entry) &&
        entry.enabled &&
        entry.trusted &&
        rendererPluginKey(rendererPluginReference(entry.snapshot)) === rendererPluginKey(provider),
    );
  if (!installed || !isInstalledChartPlugin(installed))
    throw new Error('Install, trust and enable this chart provider in Plugins first.');
  const snapshot = structuredClone(installed.snapshot);
  const errors = validateRendererPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  return snapshot;
}

function upsertPropertyKeyframe(
  layer: Layer,
  property: AnimatableLayerProperty,
  frame: number,
  value: number,
  easing: EasingPreset = 'linear',
): LayerPropertyKeyframe {
  materializeAnimationTracks(layer);
  const track = layer.animationTracks[property] ?? [];
  let keyframe = track.find((candidate) => candidate.frame === frame);
  if (keyframe) {
    keyframe.value = value;
  } else {
    keyframe = createLayerPropertyKeyframe(frame, value, { easing });
    track.push(keyframe);
  }
  layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
  return keyframe;
}

function syncAggregateKeyframe(layer: Layer, frame: number, easing: EasingPreset): LayerKeyframe {
  let keyframe = findLayerKeyframeAtFrame(layer, frame);
  if (!keyframe) {
    keyframe = createLayerKeyframe(frame, getLayerTransformAtFrame(layer, frame), { easing });
    layer.keyframes.push(keyframe);
    layer.keyframes = sortLayerKeyframes(layer.keyframes);
  } else {
    keyframe.transform = getLayerTransformAtFrame(layer, frame);
  }
  return keyframe;
}

function removeAggregateKeyframeIfOrphaned(layer: Layer, frame: number): void {
  const propertyKeyRemains = Object.values(layer.animationTracks).some((track) =>
    track?.some((keyframe) => keyframe.frame === frame),
  );
  if (
    !propertyKeyRemains &&
    layer.keyframes.length > 1 &&
    !(layer.animationTrackMode === 'independent' && frame === 0)
  ) {
    layer.keyframes = layer.keyframes.filter((keyframe) => keyframe.frame !== frame);
  }
}

function framesAreUnique(frames: number[]): boolean {
  return new Set(frames).size === frames.length;
}

function timelineKeyDeltaBounds(
  keys: Array<{ id: string; frame: number }>,
  selectedIds: Set<string>,
  totalFrames: number,
): { min: number; max: number } {
  const selected = keys.filter((key) => selectedIds.has(key.id));
  const unselected = keys.filter((key) => !selectedIds.has(key.id));
  let min = -totalFrames;
  let max = totalFrames;
  for (const key of selected) {
    min = Math.max(min, -key.frame);
    max = Math.min(max, totalFrames - key.frame);
    const previous = unselected
      .filter((candidate) => candidate.frame < key.frame)
      .reduce<number | null>(
        (nearest, candidate) =>
          nearest === null || candidate.frame > nearest ? candidate.frame : nearest,
        null,
      );
    const next = unselected
      .filter((candidate) => candidate.frame > key.frame)
      .reduce<number | null>(
        (nearest, candidate) =>
          nearest === null || candidate.frame < nearest ? candidate.frame : nearest,
        null,
      );
    if (previous !== null) min = Math.max(min, previous + 1 - key.frame);
    if (next !== null) max = Math.min(max, next - 1 - key.frame);
  }
  return { min, max };
}

function writeLayerTransformAtFrame(
  composition: Composition,
  layer: Layer,
  frame: number,
  patch: Partial<LayerTransform>,
): void {
  const roundedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
  let keyframe = findLayerKeyframeAtFrame(layer, roundedFrame);
  const easing = keyframe?.easing ?? 'linear';
  if (!keyframe) {
    keyframe = createLayerKeyframe(roundedFrame, getLayerTransformAtFrame(layer, roundedFrame));
    layer.keyframes.push(keyframe);
    layer.keyframes = sortLayerKeyframes(layer.keyframes);
  }
  const normalizedPatch = normalizeAuthoredTransformPatch(patch);
  for (const [property, value] of Object.entries(normalizedPatch) as [
    keyof LayerTransform,
    number,
  ][]) {
    upsertPropertyKeyframe(layer, property, roundedFrame, value, easing);
  }
  keyframe.transform = getLayerTransformAtFrame(layer, roundedFrame);
}

/** Auto enables a new property; an existing track always follows playhead edits. */
function shouldKeyPropertyEdit(layer: Layer, property: AnimatableLayerProperty): boolean {
  return (
    useCanvasViewStore.getState().mode === 'animate' &&
    useTimelineStore.getState().editScope === 'playhead' &&
    (canvasAutoKeyframe() || isLayerPropertyAnimated(layer, property))
  );
}

export function keyPropertyEdit(
  layer: Layer,
  property: AnimatableLayerProperty,
  frame: number,
  value: number,
  before = getLayerPropertyValueAtFrame(layer, property, frame),
): boolean {
  if (!shouldKeyPropertyEdit(layer, property)) return false;
  if (Math.abs(value - before) < 1e-9) return true;
  // Auto's first later edit needs the old design value at zero, not a synthetic Step/End pose.
  if (!isLayerPropertyAnimated(layer, property) && frame > 0)
    upsertPropertyKeyframe(layer, property, 0, before);
  const key = upsertPropertyKeyframe(layer, property, frame, value);
  syncAggregateKeyframe(layer, frame, key.easing);
  return true;
}

function writePlayheadLayerTransform(
  layer: Layer,
  frame: number,
  patch: Partial<LayerTransform>,
): void {
  for (const [property, value] of Object.entries(normalizeAuthoredTransformPatch(patch)) as Array<
    [keyof LayerTransform, number]
  >) {
    if (!keyPropertyEdit(layer, property, frame, value))
      offsetLayerTransform(layer, frame, { [property]: value });
  }
}

/** Preserve the sampled design when the final key is removed. Virtual reveal channels reset. */
function removePropertyKeyframe(
  layer: Layer,
  property: AnimatableLayerProperty,
  keyframeId: string,
  sampleFrame: number,
): void {
  const value = getLayerPropertyValueAtFrame(layer, property, sampleFrame);
  materializeAnimationTracks(layer);
  const track = layer.animationTracks[property] ?? [];
  const removedFrame = track.find((key) => key.id === keyframeId)?.frame;
  if (removedFrame === undefined) return;
  const remaining = track.filter((key) => key.id !== keyframeId);
  if (remaining.length) layer.animationTracks[property] = remaining;
  else {
    // Resolve legacy channels before opting this one out, preserving all other authored motion.
    layer.animationTrackMode = 'independent';
    delete layer.animationTracks[property];
    if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
      for (const key of layer.keyframes) key.transform[property as keyof LayerTransform] = value;
    } else if (parseShaderAnimationProperty(property))
      layer.element = applyShaderAnimationValues(layer.element, { [property]: value });
    else if (parseEffectProperty(property))
      layer.effects = withEffectParameter(layer.effects, property, value);
    else if (parseModifierProperty(property))
      layer.modifiers = withModifierParameter(layer, property, value).modifiers;
    else if (property === 'strokeWidth' && layer.element.type === 'text')
      layer.element.strokeWidth = value;
    else if (property === 'motionPathProgress' && layer.motionPath)
      layer.motionPath.progress = value;
    else if (
      EFFECT_ANIMATION_PROPERTIES.includes(property as (typeof EFFECT_ANIMATION_PROPERTIES)[number])
    )
      layer.effects = ensureLegacyEffects(
        normalizeLayerEffects({ ...layer.effects, [property]: value }),
        { [property]: value },
      );
    else {
      const index = gradientStopIndexForProperty(property);
      const fill = 'fill' in layer.element ? layer.element.fill : undefined;
      if (index !== null && isGradientPaint(fill) && fill.stops[index])
        fill.stops[index]!.offset = value;
    }
  }
  removeAggregateKeyframeIfOrphaned(layer, removedFrame);
}

function normalizeOffsetProperty(
  layer: Layer,
  property: AnimatableLayerProperty,
  value: number,
): number {
  if (parseShaderAnimationProperty(property))
    return clampShaderAnimationValue(layer.element, property, value);
  if (['x', 'y', 'width', 'height'].includes(property))
    return normalizeAuthoredTransformPatch({ [property]: value })[
      property as keyof LayerTransform
    ]!;
  if (
    property === 'opacity' ||
    property === 'dropShadowOpacity' ||
    property.startsWith('fill.stops[') ||
    property.startsWith('clip')
  )
    return Math.max(0, Math.min(1, value));
  if (
    property === 'blur' ||
    property === 'dropShadowBlur' ||
    property === 'strokeWidth' ||
    property === 'scale'
  )
    return Math.max(0, value);
  const spec = effectParameterSpec(layer.effects, property);
  return spec ? Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, value)) : value;
}

/** Offset existing curves without materializing tracks or adding playhead keys. */
function offsetExistingPropertyKeys(
  layer: Layer,
  property: AnimatableLayerProperty,
  delta: number,
): void {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return;
  for (const track of [layer.animationTracks[property], layer.loop?.tracks[property]])
    for (const key of track ?? [])
      key.value = normalizeOffsetProperty(layer, property, key.value + delta);
}

function offsetLayerTransform(layer: Layer, frame: number, patch: Partial<LayerTransform>): void {
  const before = getLayerTransformAtFrame(layer, frame);
  for (const [property, value] of Object.entries(normalizeAuthoredTransformPatch(patch)) as [
    keyof LayerTransform,
    number,
  ][]) {
    const delta = value - before[property];
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) continue;
    offsetExistingPropertyKeys(layer, property, delta);
    for (const key of layer.keyframes)
      key.transform[property] = normalizeOffsetProperty(
        layer,
        property,
        key.transform[property] + delta,
      );
  }
}

/** Design edits preserve existing keys: position offsets all poses, while an animated
 * non-position property changes its existing on-air key. Constant properties stay constant. */
function writeDesignLayerTransform(
  layer: Layer,
  frame: number,
  patch: Partial<LayerTransform>,
): void {
  const normalized = normalizeAuthoredTransformPatch(patch);
  const keyed = new Map<
    keyof LayerTransform,
    { trackKey?: LayerPropertyKeyframe; poseKey?: LayerKeyframe }
  >();
  for (const property of Object.keys(normalized) as Array<keyof LayerTransform>) {
    if (property === 'x' || property === 'y') continue;
    const resolved = getResolvedLayerAnimationTracks(layer)[property] ?? [];
    const animated = resolved.some(
      (key) => Math.abs(key.value - (resolved[0]?.value ?? key.value)) > 1e-9,
    );
    if (!animated) continue;
    const track = layer.animationTracks[property];
    const trackKey = track?.find((key) => key.frame === frame);
    const poseKey = layer.keyframes.find((key) => key.frame === frame);
    if ((track?.length && !trackKey) || (!track?.length && !poseKey))
      throw new Error(
        `The animated ${property} has no key at the on-air Step. Switch to Animate to edit it without changing other keys.`,
      );
    keyed.set(property, { trackKey, poseKey });
  }
  for (const [property, value] of Object.entries(normalized) as Array<
    [keyof LayerTransform, number]
  >) {
    const existing = keyed.get(property);
    if (!existing) {
      offsetLayerTransform(layer, frame, { [property]: value });
      continue;
    }
    const next = normalizeOffsetProperty(layer, property, value);
    if (existing.trackKey) existing.trackKey.value = next;
    if (existing.poseKey) existing.poseKey.transform[property] = next;
  }
}

function writeUiLayerTransform(
  composition: Composition,
  layer: Layer,
  frame: number,
  patch: Partial<LayerTransform>,
): void {
  const roundedFrame = Math.max(
    0,
    Math.min(getTotalFrames(composition), Math.round(canvasFrame(composition, frame))),
  );
  const before = getLayerTransformAtFrame(layer, roundedFrame);
  const keyedTranslation = {
    x: shouldKeyPropertyEdit(layer, 'x'),
    y: shouldKeyPropertyEdit(layer, 'y'),
  };
  if (useCanvasViewStore.getState().mode === 'design')
    writeDesignLayerTransform(layer, roundedFrame, patch);
  else writePlayheadLayerTransform(layer, roundedFrame, patch);
  const after = getLayerTransformAtFrame(layer, roundedFrame);
  const deltaX = after.x - before.x,
    deltaY = after.y - before.y;
  if (deltaX === 0 && deltaY === 0) return;
  for (const descendant of descendantLayers(composition, layer.id)) {
    const pose = getLayerTransformAtFrame(descendant, roundedFrame);
    const childPatch = {
      ...(deltaX !== 0 ? { x: pose.x + deltaX } : {}),
      ...(deltaY !== 0 ? { y: pose.y + deltaY } : {}),
    };
    for (const axis of ['x', 'y'] as const) {
      const value = childPatch[axis];
      if (value === undefined) continue;
      if (keyedTranslation[axis]) {
        if (!isLayerPropertyAnimated(descendant, axis) && roundedFrame > 0)
          upsertPropertyKeyframe(descendant, axis, 0, pose[axis]);
        const key = upsertPropertyKeyframe(descendant, axis, roundedFrame, value);
        syncAggregateKeyframe(descendant, roundedFrame, key.easing);
      } else offsetLayerTransform(descendant, roundedFrame, { [axis]: value });
    }
  }
}

export function resizeConstrainedLayers(
  composition: Composition,
  oldSize: { width: number; height: number },
  newSize: { width: number; height: number },
): void {
  if (oldSize.width === newSize.width && oldSize.height === newSize.height) return;
  for (const layer of composition.layers) {
    const tracks = getResolvedLayerAnimationTracks(layer);
    const frames = new Set(layer.keyframes.map((keyframe) => keyframe.frame));
    for (const property of ['x', 'y', 'width', 'height'] as const) {
      for (const keyframe of tracks[property] ?? []) frames.add(keyframe.frame);
    }
    // Resolve every source pose before writing any destination key. Otherwise a newly written
    // early key can change interpolation at a later frame and make responsive resizing depend on
    // iteration order.
    const resizedFrames = [...frames]
      .sort((a, b) => a - b)
      .map((frame) => ({
        frame,
        resized: resizeConstrainedTransform(
          getLayerTransformAtFrame(layer, frame),
          layer.constraints,
          oldSize,
          newSize,
        ),
      }));
    const staticProperties = new Set(
      (['x', 'y', 'width', 'height'] as const).filter(
        (property) =>
          layer.animationTrackMode === 'independent' &&
          !isLayerPropertyAnimated(layer, property) &&
          resizedFrames.every(
            ({ resized }) => resized[property] === resizedFrames[0]?.resized[property],
          ),
      ),
    );
    for (const { frame, resized } of resizedFrames) {
      const patch = {
        x: resized.x,
        y: resized.y,
        width: resized.width,
        height: resized.height,
      };
      for (const property of staticProperties) {
        offsetLayerTransform(layer, frame, { [property]: resized[property] });
        delete (patch as Partial<typeof patch>)[property];
      }
      if (Object.keys(patch).length) writeLayerTransformAtFrame(composition, layer, frame, patch);
    }
  }
}

function descendantLayers(composition: Composition, parentId: string): Layer[] {
  const result: Layer[] = [];
  const visit = (id: string) => {
    for (const layer of composition.layers) {
      if (layer.parentId !== id || result.includes(layer)) continue;
      result.push(layer);
      visit(layer.id);
    }
  };
  visit(parentId);
  return result;
}

function linkedInstanceKey(layer: Layer): string | null {
  const link = layer.componentLink;
  return link ? `${link.componentId}\u0000${link.instanceId}` : null;
}

function completeLinkedInstanceKeys(composition: Composition, copiedLayers: Layer[]): Set<string> {
  const copiedLayerIds = new Set(copiedLayers.map((layer) => layer.id));
  const candidateKeys = new Set(
    copiedLayers.map(linkedInstanceKey).filter((key): key is string => key !== null),
  );
  const complete = new Set<string>();

  for (const key of candidateKeys) {
    const members = composition.layers.filter((layer) => linkedInstanceKey(layer) === key);
    const link = members[0]?.componentLink;
    const definition = link
      ? composition.components.find((candidate) => candidate.id === link.componentId)
      : undefined;
    if (!definition || members.length !== definition.layers.length) continue;
    if (members.some((layer) => !copiedLayerIds.has(layer.id))) continue;
    const sourceLayerIds = members.map((layer) => layer.componentLink?.sourceLayerId);
    if (sourceLayerIds.some((sourceLayerId) => !sourceLayerId)) continue;
    if (new Set(sourceLayerIds).size !== definition.layers.length) continue;
    if (!definition.layers.every((source) => sourceLayerIds.includes(source.id))) continue;
    if (
      members.some((layer) =>
        layer.bindings.some(
          (binding) => !composition.dataFields.some((field) => field.id === binding.fieldId),
        ),
      )
    )
      continue;
    complete.add(key);
  }

  return complete;
}

function uniqueCopiedFieldKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  const key = `${base}_${suffix}`;
  used.add(key);
  return key;
}

function rememberCopiedSchemaIds(
  source: FieldDefinition,
  copy: FieldDefinition,
  ids: Map<string, string>,
): void {
  ids.set(source.id, copy.id);
  source.properties.forEach((child, index) => {
    if (copy.properties[index]) rememberCopiedSchemaIds(child, copy.properties[index]!, ids);
  });
  if (source.items && copy.items) rememberCopiedSchemaIds(source.items, copy.items, ids);
}

/** A duplicated live instance needs a fresh identity map, including its cached inherited values. */
function remapCopiedComponentLink(
  source: Layer,
  copy: Layer,
  composition: Composition,
  layers: Map<string, string>,
  fields: Map<string, string>,
  offset: number,
  groups: ReadonlyMap<string, string>,
): void {
  if (!source.componentLink || !copy.componentLink) return;
  const link = structuredClone(source.componentLink);
  link.instanceId = copy.componentLink.instanceId;
  const keys = new Map<string, string>();
  const pairKeys = (before: Array<{ id: string }>, after: Array<{ id: string }>) => {
    before.forEach((key, index) => {
      if (after[index]) keys.set(key.id, after[index]!.id);
    });
  };
  pairKeys(source.keyframes, copy.keyframes);
  for (const [property, entries] of Object.entries(getResolvedLayerAnimationTracks(source)))
    pairKeys(entries ?? [], copy.animationTracks[property as AnimatableLayerProperty] ?? []);
  if (source.loop && copy.loop) {
    keys.set(source.loop.id, copy.loop.id);
    for (const [property, entries] of Object.entries(source.loop.tracks))
      pairKeys(entries ?? [], copy.loop.tracks[property as AnimatableLayerProperty] ?? []);
  }
  pairKeys(source.visualRules, copy.visualRules);
  const keyId = (id: string): string => {
    let result = keys.get(id);
    if (!result) {
      result = createId('component-key');
      keys.set(id, result);
    }
    return result;
  };
  link.fieldIds = Object.fromEntries(
    Object.entries(link.fieldIds ?? {}).map(([id, actual]) => [id, fields.get(actual) ?? actual]),
  );
  link.keyIds = Object.fromEntries(
    Object.entries(link.keyIds ?? {}).map(([id, actual]) => [id, keyId(actual)]),
  );
  if (link.offset) link.offset = { x: link.offset.x + offset, y: link.offset.y + offset };
  if (link.baseline) {
    const base = link.baseline;
    base.id = copy.id;
    base.groupId = copy.groupId;
    if (base.parentId) base.parentId = layers.get(base.parentId) ?? base.parentId;
    if (base.mask)
      base.mask.sourceLayerId = layers.get(base.mask.sourceLayerId) ?? base.mask.sourceLayerId;
    if (base.motionPath)
      base.motionPath.sourceLayerId =
        layers.get(base.motionPath.sourceLayerId) ?? base.motionPath.sourceLayerId;
    if (base.textPath)
      base.textPath.sourceLayerId =
        layers.get(base.textPath.sourceLayerId) ?? base.textPath.sourceLayerId;
    if (base.modifiers)
      base.modifiers = remapLayerModifierReferences(base.modifiers, { layers, groups, fields })!;
    for (const key of base.keyframes) {
      key.id = keyId(key.id);
      key.transform.x += offset;
      key.transform.y += offset;
    }
    for (const tracks of [base.animationTracks, base.loop?.tracks])
      for (const [property, entries] of Object.entries(tracks ?? {}))
        for (const key of entries ?? []) {
          key.id = keyId(key.id);
          if (property === 'x' || property === 'y') key.value += offset;
        }
    if (base.loop) base.loop.id = keyId(base.loop.id);
    base.bindings = base.bindings.map((binding) => ({
      ...binding,
      fieldId: fields.get(binding.fieldId) ?? binding.fieldId,
    }));
    base.visualRules = base.visualRules.map((rule) =>
      remapVisualRule(rule, {
        id: keyId(rule.id),
        layerIds: layers,
        fieldIds: fields,
        groupIds: groups,
      }),
    );
    remapClockTimerLayerActions(base as Layer, layers);
  }
  const remapField = (field: FieldDefinition): void => {
    field.id = fields.get(field.id) ?? field.id;
    field.properties.forEach(remapField);
    if (field.items) remapField(field.items);
    if (field.generatedShaderParameter)
      field.generatedShaderParameter.layerId =
        layers.get(field.generatedShaderParameter.layerId) ??
        field.generatedShaderParameter.layerId;
  };
  for (const base of Object.values(link.fieldBaselines ?? {})) {
    remapField(base);
    const actual = composition.dataFields.find((field) => field.id === base.id);
    if (actual) base.key = actual.key;
  }
  copy.componentLink = link;
}

function appendLayerCopies(
  composition: Composition,
  sourceComposition: Composition,
  sources: Layer[],
  offset: number,
  placement: 'front' | 'after-selection' = 'front',
): string[] {
  assertModifierGroupCopySafe(sourceComposition, sources);
  const copiedIds: string[] = [];
  const copiedLayers: Layer[] = [];
  const usedNames = new Set(composition.layers.map((layer) => layer.name));
  const idMap = new Map(sources.map((layer) => [layer.id, createId('layer')]));
  const groupMap = new Map(
    sources
      .map((layer) => layer.groupId)
      .filter((groupId): groupId is string => Boolean(groupId))
      .map((groupId) => [groupId, createId('group')]),
  );
  const safeLinkedInstances = completeLinkedInstanceKeys(sourceComposition, sources);
  const linkedInstanceCopies = new Map(
    [...safeLinkedInstances].map((key) => [key, createId('component-instance')]),
  );
  const copiedFieldIds = new Map<string, Map<string, string>>();
  const usedFieldKeys = new Set(composition.dataFields.map((field) => field.key));

  for (const instanceKey of safeLinkedInstances) {
    const fields = new Map<string, string>();
    const boundFieldIds = [
      ...new Set(
        sources
          .filter((layer) => linkedInstanceKey(layer) === instanceKey)
          .flatMap((layer) => [
            ...layer.bindings.map((binding) => binding.fieldId),
            ...(layer.visualRules ?? []).flatMap(visualRuleFieldIds),
            ...layerModifierFieldIds(layer),
            ...Object.values(layer.componentLink?.fieldIds ?? {}),
          ]),
      ),
    ];
    for (const sourceFieldId of boundFieldIds) {
      const sourceField = sourceComposition.dataFields.find((field) => field.id === sourceFieldId);
      if (!sourceField) continue;
      const field = cloneFieldDefinitionWithFreshIds(sourceField);
      if (field.generatedShaderParameter)
        field.generatedShaderParameter.layerId =
          idMap.get(field.generatedShaderParameter.layerId) ??
          field.generatedShaderParameter.layerId;
      field.key = uniqueCopiedFieldKey(sourceField.key, usedFieldKeys);
      composition.dataFields.push(field);
      rememberCopiedSchemaIds(sourceField, field, fields);
    }
    copiedFieldIds.set(instanceKey, fields);
  }

  for (const source of sources) {
    const baseName = source.name.replace(/ copy(?: \d+)?$/, '');
    let name = `${baseName} copy`;
    let suffix = 2;
    while (usedNames.has(name)) name = `${baseName} copy ${suffix++}`;
    usedNames.add(name);
    const instanceKey = linkedInstanceKey(source);
    const copiedInstanceId = instanceKey ? linkedInstanceCopies.get(instanceKey) : undefined;
    const fieldIds = instanceKey ? copiedFieldIds.get(instanceKey) : undefined;

    const layer: Layer = {
      ...structuredClone(source),
      id: idMap.get(source.id)!,
      name,
      groupId: source.groupId ? (groupMap.get(source.groupId) ?? null) : null,
      parentId: source.parentId ? (idMap.get(source.parentId) ?? null) : null,
      motionPath: source.motionPath
        ? {
            ...source.motionPath,
            sourceLayerId:
              idMap.get(source.motionPath.sourceLayerId) ?? source.motionPath.sourceLayerId,
          }
        : null,
      textPath:
        source.textPath &&
        (idMap.has(source.textPath.sourceLayerId) ||
          composition.layers.some((layer) => layer.id === source.textPath!.sourceLayerId))
          ? {
              ...source.textPath,
              sourceLayerId:
                idMap.get(source.textPath.sourceLayerId) ?? source.textPath.sourceLayerId,
            }
          : null,
      mask: source.mask
        ? idMap.has(source.mask.sourceLayerId) ||
          composition.layers.some((layer) => layer.id === source.mask!.sourceLayerId)
          ? {
              ...source.mask,
              sourceLayerId: idMap.get(source.mask.sourceLayerId) ?? source.mask.sourceLayerId,
            }
          : null
        : null,
      componentLink:
        source.componentLink && copiedInstanceId
          ? { ...source.componentLink, instanceId: copiedInstanceId }
          : null,
      bindings: source.bindings.flatMap((binding) => {
        const fieldId =
          fieldIds?.get(binding.fieldId) ??
          (composition.dataFields.some((field) => field.id === binding.fieldId)
            ? binding.fieldId
            : undefined);
        return fieldId ? [{ ...structuredClone(binding), fieldId }] : [];
      }),
      visualRules: (source.visualRules ?? []).flatMap((rule) => {
        const available = (fieldId: string) =>
          Boolean(fieldIds?.get(fieldId)) ||
          composition.dataFields.some((field) => field.id === fieldId);
        if (!visualRuleFieldIds(rule).every(available)) return [];
        return [
          remapVisualRule(rule, {
            layerIds: idMap,
            groupIds: groupMap,
            ...(fieldIds ? { fieldIds } : {}),
          }),
        ];
      }),
      keyframes: source.keyframes.map((keyframe) =>
        createLayerKeyframe(
          keyframe.frame,
          {
            ...keyframe.transform,
            x: keyframe.transform.x + offset,
            y: keyframe.transform.y + offset,
          },
          { easing: keyframe.easing },
        ),
      ),
      animationTracks: {},
    };
    delete layer.exportKey;
    if (source.modifiers)
      layer.modifiers = remapLayerModifierReferences(source.modifiers, {
        layers: idMap,
        groups: groupMap,
        ...(fieldIds ? { fields: fieldIds } : {}),
      })!;
    const sourceTracks =
      source.animationTrackMode === 'independent'
        ? source.animationTracks
        : getResolvedLayerAnimationTracks(source);
    layer.animationTracks = Object.fromEntries(
      Object.entries(sourceTracks).map(([property, keyframes]) => [
        property,
        (keyframes ?? []).map((keyframe) =>
          createLayerPropertyKeyframe(
            keyframe.frame,
            keyframe.value + (property === 'x' || property === 'y' ? offset : 0),
            {
              easing: keyframe.easing,
              ...(keyframe.curve ? { curve: { ...keyframe.curve } } : {}),
            },
          ),
        ),
      ]),
    );
    if (source.loop) {
      layer.loop = {
        ...structuredClone(source.loop),
        id: createId('layer-loop'),
        tracks: Object.fromEntries(
          Object.entries(source.loop.tracks).map(([property, keyframes]) => [
            property,
            (keyframes ?? []).map((keyframe) =>
              createLayerPropertyKeyframe(
                keyframe.frame,
                keyframe.value + (property === 'x' || property === 'y' ? offset : 0),
                {
                  easing: keyframe.easing,
                  ...(keyframe.curve ? { curve: { ...keyframe.curve } } : {}),
                },
              ),
            ),
          ]),
        ),
      };
    }
    remapClockTimerLayerActions(layer, idMap);
    if (fieldIds)
      remapCopiedComponentLink(source, layer, composition, idMap, fieldIds, offset, groupMap);
    copiedLayers.push(layer);
    copiedIds.push(layer.id);
  }

  if (placement === 'after-selection') {
    const sourceIds = new Set(sources.map((source) => source.id));
    const insertionIndex =
      Math.max(
        -1,
        ...composition.layers.map((layer, index) => (sourceIds.has(layer.id) ? index : -1)),
      ) + 1;
    composition.layers.splice(insertionIndex, 0, ...copiedLayers);
  } else {
    composition.layers.push(...copiedLayers);
  }

  syncCompositionShaderParameterFields(composition);
  const generatedFieldIds = new Map<string, string>();
  for (const source of sources) {
    const copy = copiedLayers.find((layer) => layer.id === idMap.get(source.id));
    if (!copy) continue;
    for (const binding of copy.bindings) {
      const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId);
      if (!field || field.generatedShaderParameter?.layerId !== copy.id) continue;
      const original = source.bindings.find(
        (candidate) => candidate.targetProperty === binding.targetProperty,
      );
      if (original) generatedFieldIds.set(original.fieldId, field.id);
    }
  }
  if (generatedFieldIds.size)
    for (const copy of copiedLayers) {
      if (copy.modifiers)
        copy.modifiers = remapLayerModifierReferences(copy.modifiers, {
          fields: generatedFieldIds,
        })!;
      if (copy.componentLink?.baseline?.modifiers)
        copy.componentLink.baseline.modifiers = remapLayerModifierReferences(
          copy.componentLink.baseline.modifiers,
          { fields: generatedFieldIds },
        )!;
    }
  const modifierErrors = layerModifiersErrors(composition.layers, composition.dataFields);
  if (modifierErrors.length) throw new Error(modifierErrors.join(' '));
  return copiedIds;
}

function duplicateObjectLayers(composition: Composition, layerIds: string[]): Layer[] {
  const wanted = new Set(layerIds);
  const selectedGroupIds = new Set(
    composition.layers
      .filter((layer) => wanted.has(layer.id) && layer.groupId)
      .map((layer) => layer.groupId!),
  );
  for (const layer of composition.layers) {
    if (layer.groupId && selectedGroupIds.has(layer.groupId)) wanted.add(layer.id);
  }
  return composition.layers
    .filter((layer) => wanted.has(layer.id))
    .map((layer) => structuredClone(layer));
}

let projectLoadGeneration = 0;

function projectUsesMediaPaint(project: Project): boolean {
  return project.compositions.some(
    (composition) =>
      isMediaPaint(composition.backgroundPaint) ||
      (composition.mediaCues?.length ?? 0) > 0 ||
      [
        ...composition.layers,
        ...composition.components.flatMap((component) => component.layers),
      ].some((layer) => hasElementMediaPaint(layer.element) || layer.element.type === 'audio'),
  );
}

function enforceMediaRuntimeProfile(project: Project): void {
  if (
    !projectUsesMediaPaint(project) &&
    !project.compositions.some((composition) => composition.functions?.length)
  )
    return;
  project.supportsRealTime = true;
  project.supportsNonRealTime = false;
}

function pinChartRendererSnapshot(
  composition: { rendererPlugins?: RendererPluginSnapshot[] },
  snapshot: RendererPluginSnapshot,
): void {
  const key = rendererPluginKey(rendererPluginReference(snapshot));
  const plugins = (composition.rendererPlugins ??= []);
  const index = plugins.findIndex(
    (entry) => rendererPluginKey(rendererPluginReference(entry)) === key,
  );
  const next =
    index < 0
      ? [...plugins, snapshot]
      : plugins.map((entry, candidate) => (candidate === index ? snapshot : entry));
  if (next.length > MAX_RENDERER_PLUGIN_CATALOG_ENTRIES)
    throw new Error('This composition has too many pinned renderer versions.');
  const bytes = next.reduce(
    (size, entry) =>
      size +
      rendererPluginByteLength(JSON.stringify(entry.manifest)) +
      rendererPluginByteLength(entry.source) +
      rendererPluginByteLength(entry.licenseText),
    0,
  );
  if (bytes > MAX_RENDERER_PLUGIN_CATALOG_BYTES)
    throw new Error('Pinned renderer code exceeds this composition’s 8 MiB limit.');
  if (index < 0) plugins.push(snapshot);
  else plugins[index] = snapshot;
}

export const useProjectStore = create<ProjectStore>()(
  immer((publish, get) => {
    // Reconcile before publishing so a source edit and its instances form one undoable edit.
    const set = (
      mutate: (state: ProjectStore) => void,
      validateModifierDependencies = false,
      loadingProject = false,
    ): void => {
      const previousProject = get().project;
      let synchronizedSet: ReturnType<typeof synchronizeSetComponentLibrary> | undefined;
      const session = useProjectSetStore.getState();
      // Finish reconciliation and graph validation in a private draft. A rejected edit must
      // not publish a component library, metadata change or undo entry in either store.
      const staged = produce(get(), (state) => {
        mutate(state);
        const edited = isDraft(state.project) ? current(state.project) : state.project;
        if (edited === previousProject) return;
        reconcileProjectComponentInstances(
          state.project,
          !loadingProject && state.project.id === previousProject.id ? previousProject : undefined,
        );
        if (validateModifierDependencies) {
          const errors = state.project.compositions.flatMap((composition) =>
            layerModifiersErrors(composition.layers, composition.dataFields),
          );
          if (errors.length) throw new Error(errors.join('\n'));
        }
        const active = session.projectSet?.templates.find(
          (template) => template.id === session.activeTemplateId,
        );
        if (
          !loadingProject &&
          session.projectSet &&
          active &&
          active.project.id === state.project.id
        ) {
          const project = isDraft(state.project) ? current(state.project) : state.project;
          const synchronized = synchronizeSetComponentLibrary(
            session.projectSet,
            active.id,
            project,
            previousProject.id === project.id ? previousProject : undefined,
          );
          if (synchronized !== session.projectSet) {
            synchronizedSet = synchronized;
            const resolved = synchronized.templates.find(
              (template) => template.id === active.id,
            )?.project;
            if (resolved && JSON.stringify(resolved) !== JSON.stringify(project))
              state.project = resolved;
          }
        }
      });
      if (synchronizedSet) session.setProjectSet(synchronizedSet);
      publish(staged);
    };
    const initialProject = createUiProject();
    let freshUiProjectId: string | null = initialProject.id;
    // Session-only bookkeeping: a blank created in this set remains fresh if the user
    // navigates to another template and back. Opening a document or starting another
    // project clears this list; no marker is serialized into the user's files.
    let freshUiSetId: string | null = null;
    const freshUiSetTemplates = new Map<string, string>();
    const initialComposition = initialProject.compositions[0]!;
    const designerEdit = (
      layerIds: string | readonly string[],
      properties: readonly string[] | ((layer: Layer) => readonly string[]),
      mutate: (state: ProjectStore, composition: Composition, layers: Layer[]) => void | false,
    ): void => {
      const values = useTestDataStore.getState().values;
      const resets: Array<{ fieldId: string; sourcePath: string[] }> = [];
      set((state) => {
        const composition = getActiveComposition(state.project, state.activeCompositionId);
        const ids = new Set(typeof layerIds === 'string' ? [layerIds] : layerIds);
        const layers = composition.layers.filter((layer) => ids.has(layer.id));
        if (layers.length !== ids.size || layers.some((layer) => layer.isLocked)) return;
        const fields = current(composition.dataFields);
        const before = layers.map((layer) => {
          const authored = current(layer);
          try {
            return {
              element: resolveDesignerElement(authored, values, fields),
              effects: resolveDesignerEffects(authored, authored.effects, values, fields),
            };
          } catch {
            // Invalid test input must not prevent the designer from repairing the authored value.
            return { element: authored.element, effects: authored.effects };
          }
        });
        const targets = layers.map((layer) =>
          typeof properties === 'function' ? properties(layer) : properties,
        );
        const preview = Object.fromEntries(
          fields.flatMap((field) => {
            const value = resolvePreviewFieldValue(field, values[field.id]);
            return value === undefined ? [] : [[field.id, value]];
          }),
        );
        if (mutate(state, composition, layers) === false) return;
        layers.forEach((layer, index) => markTypographyOverrides(layer, targets[index]!));
        // Keep the link for Reset, but never let a later theme edit erase an explicit designer edit.
        layers.forEach((layer, index) => {
          for (const binding of layer.designTokenBindings) {
            const property = binding.targetProperty;
            if (
              targets[index]!.includes('borderRadius') &&
              property.startsWith('borderRadius') &&
              property !== 'borderRadius' &&
              before[index]!.element.type === 'rectangle' &&
              layer.element.type === 'rectangle'
            ) {
              const corner = property.slice('borderRadius'.length);
              const key =
                `${corner.charAt(0).toLowerCase()}${corner.slice(1)}` as keyof typeof layer.element.borderRadius;
              if (before[index]!.element.borderRadius[key] !== layer.element.borderRadius[key])
                binding.overridden = true;
            }
            if (
              targets[index]!.some(
                (target) =>
                  target === property ||
                  property.startsWith(`${target}.`) ||
                  property.startsWith(`${target}[`) ||
                  (layer.element.type === 'text' && target === 'fill' && property === 'color'),
              )
            )
              binding.overridden = true;
          }
        });
        layers.forEach((layer, index) =>
          resets.push(
            ...syncDesignerBindingDefaults(
              composition,
              layer,
              before[index]!,
              targets[index]!,
              preview,
            ),
          ),
        );
      });
      useTestDataStore.getState().clearOverrides(resets);
    };
    const addFreshRecipe = <T>(
      fallbackPack: StylePackId,
      materialize: (composition: Composition) => T,
    ): T => {
      let result!: T;
      let nextStepFrame: number | undefined;
      set((state) => {
        const composition = getActiveComposition(state.project, state.activeCompositionId);
        const wasAtStep = useTimelineStore.getState().currentFrame === onAirFrame(composition);
        if (
          state.project.id === freshUiProjectId &&
          compactFreshRecipeTiming(composition, fallbackPack) &&
          wasAtStep
        )
          nextStepFrame = onAirFrame(composition);
        result = materialize(composition);
      });
      if (nextStepFrame !== undefined) {
        useTimelineStore.getState().controller?.seek(nextStepFrame);
        useTimelineStore.getState().setCurrentFrame(nextStepFrame);
      }
      return result;
    };
    return {
      project: initialProject,
      documentLoadRevision: 0,
      activeCompositionId: initialProject.mainCompositionId,
      activeKeyframeId: getDefaultAuthoringKeyframeId(initialComposition),

      captureFreshTemplateSession: () => {
        const projectId = freshUiProjectId;
        const setId = freshUiSetId;
        const templates = [...freshUiSetTemplates];
        return () => {
          freshUiProjectId = projectId;
          freshUiSetId = setId;
          freshUiSetTemplates.clear();
          for (const [id, value] of templates) freshUiSetTemplates.set(id, value);
        };
      },

      newProject: () => {
        projectLoadGeneration++;
        useLayerClipboardStore.getState().copy([]);
        useTimelineStore.getState().resetForProjectLoad();
        set((state) => {
          const project = createUiProject();
          freshUiProjectId = project.id;
          const composition = project.compositions[0]!;
          state.project = project;
          state.documentLoadRevision = (state.documentLoadRevision ?? 0) + 1;
          state.activeCompositionId = project.mainCompositionId;
          state.activeKeyframeId = getDefaultAuthoringKeyframeId(composition);
        });
        freshUiSetId = null;
        freshUiSetTemplates.clear();
        useTimelineStore.getState().setCurrentFrame(0);
      },

      loadProject: (project, options) => {
        const outgoingId = get().project.id;
        const outgoingWasFresh = freshUiProjectId === outgoingId;
        const navigationSetId = options?.setNavigationId;
        const session = useProjectSetStore.getState();
        const outgoingTemplateId = options?.previousTemplateId ?? session.activeTemplateId;
        const sameSetNavigation =
          navigationSetId !== undefined && navigationSetId === session.projectSet?.id;
        set(
          (state) => {
            const migrated = migrateProject(project);
            for (const candidate of migrated.compositions)
              syncCompositionShaderParameterFields(candidate);
            enforceMediaRuntimeProfile(migrated);
            state.project = migrated;
            if (!sameSetNavigation)
              state.documentLoadRevision = (state.documentLoadRevision ?? 0) + 1;
            state.activeCompositionId = migrated.mainCompositionId;
            const composition = getActiveComposition(migrated, migrated.mainCompositionId);
            state.activeKeyframeId = getDefaultAuthoringKeyframeId(composition);
          },
          false,
          true,
        );
        // A rejected incoming source must leave the outgoing editing session intact.
        projectLoadGeneration++;
        if (sameSetNavigation) {
          if (freshUiSetId !== navigationSetId) {
            freshUiSetId = navigationSetId;
            freshUiSetTemplates.clear();
          }
          if (outgoingWasFresh && outgoingTemplateId)
            freshUiSetTemplates.set(outgoingTemplateId, outgoingId);
          if (options?.freshUiTemplate && options.setTemplateId)
            freshUiSetTemplates.set(options.setTemplateId, project.id);
          freshUiProjectId =
            options?.setTemplateId && freshUiSetTemplates.get(options.setTemplateId) === project.id
              ? project.id
              : null;
        } else if (
          options?.preserveFreshUiIdentity &&
          outgoingWasFresh &&
          project.id === outgoingId
        ) {
          freshUiProjectId = project.id;
        } else {
          freshUiSetId = null;
          freshUiSetTemplates.clear();
          freshUiProjectId = options?.freshUiTemplate ? project.id : null;
        }
        useLayerClipboardStore.getState().copy([]);
        const next = get();
        useTimelineStore
          .getState()
          .resetForProjectLoad(
            options?.freshUiTemplate
              ? 0
              : onAirFrame(getActiveComposition(next.project, next.activeCompositionId)),
          );
      },

      setActiveComposition: (compositionId) => {
        const composition = get().project.compositions.find((item) => item.id === compositionId);
        if (!composition) throw new Error(`Composition not found: ${compositionId}`);
        if (get().activeCompositionId === compositionId) return;
        useTimelineStore.getState().resetForProjectLoad();
        set((state) => {
          state.activeCompositionId = compositionId;
          state.activeKeyframeId = getDefaultAuthoringKeyframeId(composition);
        });
        useTimelineStore.getState().setCurrentFrame(onAirFrame(composition));
      },

      setProjectMeta: (patch) =>
        set((state) => {
          Object.assign(state.project, patch);
          enforceMediaRuntimeProfile(state.project);
        }),

      setCompositionCrop: (crop) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const normalized = normalizeCanvasCrop(crop, composition.width, composition.height);
          if (normalized) composition.crop = normalized;
          else delete composition.crop;
        }),

      updateCompositionSettings: (patch) => {
        let nextStepFrame: number | undefined;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const resetBlankTiming =
            state.project.id === freshUiProjectId &&
            !useProjectSetStore.getState().projectSet &&
            patch.frameRate !== undefined &&
            patch.frameRate > 0 &&
            patch.frameRate !== composition.frameRate &&
            isUntouchedBlankTiming(composition);
          const wasAtStep = useTimelineStore.getState().currentFrame === onAirFrame(composition);
          const oldSize = { width: composition.width, height: composition.height };
          const next = { ...patch };
          // Guard the numeric fields: a cleared/invalid input must not poison the composition
          // (frameRate 0 would divide-by-zero every frame<->seconds conversion in the app).
          if (next.width !== undefined && !(next.width > 0)) delete next.width;
          if (next.height !== undefined && !(next.height > 0)) delete next.height;
          if (next.frameRate !== undefined && !(next.frameRate > 0)) delete next.frameRate;
          if (next.updateTransitionFrames !== undefined)
            next.updateTransitionFrames = Math.max(0, Math.round(next.updateTransitionFrames));
          if (next.shortOutFrames !== undefined)
            next.shortOutFrames = Math.max(1, Math.round(next.shortOutFrames));
          const newSize = {
            width: next.width ?? composition.width,
            height: next.height ?? composition.height,
          };
          resizeConstrainedLayers(composition, oldSize, newSize);
          Object.assign(composition, next);
          if (resetBlankTiming) {
            setNewCompositionTiming(composition);
            if (wasAtStep) nextStepFrame = onAirFrame(composition);
          }
          if (next.backgroundColor !== undefined) {
            delete composition.backgroundPaint;
            delete composition.backgroundStyleId;
            composition.backgroundPaintOverridden = true;
          }
          if (composition.crop)
            composition.crop = normalizeCanvasCrop(
              composition.crop,
              composition.width,
              composition.height,
            );
        });
        if (nextStepFrame !== undefined) useTimelineStore.getState().setCurrentFrame(nextStepFrame);
      },

      updateCompositionLayout: (patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          Object.assign(composition.layout, patch);
          composition.layout.gridSize = Math.max(1, Math.round(composition.layout.gridSize));
          composition.layout.snapThreshold = Math.max(
            0,
            Math.round(composition.layout.snapThreshold),
          );
        }),

      addCanvasGuide: (axis, position) => {
        const id = createId('guide');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.layout.guides.push({
            id,
            axis,
            position: Math.round(
              position ?? (axis === 'vertical' ? composition.width / 2 : composition.height / 2),
            ),
          });
        });
        return id;
      },

      updateCanvasGuide: (guideId, position) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const guide = composition.layout.guides.find((candidate) => candidate.id === guideId);
          if (guide) guide.position = Math.round(position);
        }),

      removeCanvasGuide: (guideId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.layout.guides = composition.layout.guides.filter(
            (candidate) => candidate.id !== guideId,
          );
        }),

      addMediaCueFromAsset: (assetId) => {
        let cueId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const asset = composition.assets.find((candidate) => candidate.id === assetId);
          if (!asset || (asset.kind !== 'media' && asset.kind !== 'audio')) {
            throw new Error('Media cues require an imported audio or video asset.');
          }
          const sourceId = createId('media-source');
          const cue = createMediaCue({
            name: asset.name.replace(/\.[^.]+$/, '') || 'Media Cue',
            sources: [
              {
                id: sourceId,
                name: asset.name,
                kind: 'clip',
                mediaType: asset.kind === 'audio' ? 'audio' : 'video',
                src: `asset:${asset.id}`,
              },
            ],
            activeSourceId: sourceId,
            trigger:
              asset.kind === 'audio'
                ? { type: 'manual' }
                : { type: 'lifecycle', keyframeId: state.activeKeyframeId },
            durationFrames: null,
          });
          (composition.mediaCues ??= []).push(cue);
          cueId = cue.id;
          enforceMediaRuntimeProfile(state.project);
        });
        return cueId;
      },

      addSoundEventFromAsset: (assetId, frame) => {
        let cueId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const asset = composition.assets.find((candidate) => candidate.id === assetId);
          if (!asset || asset.kind !== 'audio') {
            throw new Error('Sound Events require an imported audio asset.');
          }
          const sourceId = createId('media-source');
          const startFrame = Math.max(
            0,
            Math.min(
              getTotalFrames(composition),
              Math.round(frame ?? useTimelineStore.getState().currentFrame),
            ),
          );
          const cue = createMediaCue({
            name: asset.name.replace(/\.[^.]+$/, '') || 'Sound Event',
            sources: [
              {
                id: sourceId,
                name: asset.name,
                kind: 'clip',
                mediaType: 'audio',
                src: `asset:${asset.id}`,
              },
            ],
            activeSourceId: sourceId,
            trigger: { type: 'timeline', startFrame },
            durationFrames: null,
            loop: false,
            muted: false,
            retrigger: 'restart',
          });
          (composition.mediaCues ??= []).push(cue);
          cueId = cue.id;
          enforceMediaRuntimeProfile(state.project);
        });
        return cueId;
      },

      addRuleSoundFromAsset: (assetId) => {
        let cueId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const asset = composition.assets.find((candidate) => candidate.id === assetId);
          if (!asset || asset.kind !== 'audio') {
            throw new Error('Rule sounds require an imported audio asset.');
          }
          const sourceId = createId('media-source');
          const cue = createMediaCue({
            name: asset.name.replace(/\.[^.]+$/, '') || 'Sound',
            sources: [
              {
                id: sourceId,
                name: asset.name,
                kind: 'clip',
                mediaType: 'audio',
                src: `asset:${asset.id}`,
              },
            ],
            activeSourceId: sourceId,
            trigger: { type: 'manual' },
            durationFrames: null,
            loop: false,
            muted: false,
            retrigger: 'restart',
          });
          (composition.mediaCues ??= []).push(cue);
          cueId = cue.id;
          enforceMediaRuntimeProfile(state.project);
        });
        return cueId;
      },

      addLiveMediaCue: () => {
        let cueId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const sourceId = createId('media-source');
          const cue = createMediaCue({
            name: 'Live Media',
            sources: [{ id: sourceId, name: 'Live input', kind: 'live', tag: 'live.input' }],
            activeSourceId: sourceId,
            trigger: { type: 'lifecycle', keyframeId: state.activeKeyframeId },
          });
          (composition.mediaCues ??= []).push(cue);
          cueId = cue.id;
          enforceMediaRuntimeProfile(state.project);
        });
        return cueId;
      },

      updateMediaCue: (cueId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const cue = (composition.mediaCues ?? []).find((candidate) => candidate.id === cueId);
          if (!cue) return;
          Object.assign(cue, structuredClone(patch));
          if (!cue.sources.some((source) => source.id === cue.activeSourceId)) {
            cue.activeSourceId = cue.sources[0]?.id ?? null;
          }
          enforceMediaRuntimeProfile(state.project);
        }),

      removeMediaCue: (cueId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          assertLogicFunctionReferenceRemovable(composition, 'cue', cueId);
          composition.mediaCues = (composition.mediaCues ?? []).filter((cue) => cue.id !== cueId);
          pruneVisualRuleReferences(composition);
        }),

      addFrameCue: (frame) => {
        const id = createId('frame-cue');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const cues = (composition.frameCues ??= []);
          if (cues.length >= MAX_FRAME_CUES)
            throw new Error(`A template supports at most ${MAX_FRAME_CUES} frame cues.`);
          const endFrame = getTotalFrames(composition);
          const cue = {
            id,
            name: `Cue ${cues.length + 1}`,
            frame: Math.max(0, Math.min(endFrame, Math.round(frame))),
          };
          const [error] = frameCueErrors([cue], endFrame);
          if (error) throw new Error(error);
          cues.push(cue);
        });
        return id;
      },

      updateFrameCue: (cueId, input) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const index = composition.frameCues?.findIndex((cue) => cue.id === cueId) ?? -1;
          if (index < 0 || !composition.frameCues) throw new Error('Frame cue not found.');
          const cue = { ...input, id: cueId, name: input.name.trim() };
          const [error] = frameCueErrors([cue], getTotalFrames(composition));
          if (error) throw new Error(error);
          composition.frameCues[index] = structuredClone(cue);
        }),

      removeFrameCue: (cueId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.frameCues = (composition.frameCues ?? []).filter((cue) => cue.id !== cueId);
        }),

      addDrawnPath: (path) => {
        const layer = createLayerOfKind('path');
        if (layer.element.type !== 'path') throw new Error('Path layer creation failed');
        layer.element.d = path.d;
        layer.element.viewBoxWidth = path.width;
        layer.element.viewBoxHeight = path.height;
        if (!path.closed) {
          layer.element.fill = 'transparent';
          layer.element.strokeColor = '#ffffff';
          layer.element.strokeWidth = 3;
        }
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          insertNewLayer(composition, layer, 'path', path);
        });
        return layer.id;
      },

      addLayer: (kind, placement) => {
        if (kind === 'chart') {
          const provider = useRendererPluginSettingsStore.getState().defaultProvider;
          if (!provider)
            throw new Error(
              'No default chart renderer selected. Create a chart from an installed provider in the Plugins toolbar.',
            );
          const snapshot = selectedChartRendererSnapshot(provider);
          const preset = snapshot.manifest.presets.includes('bar')
            ? 'bar'
            : snapshot.manifest.presets[0]!;
          return get().addChartLayer(preset, provider, placement);
        }
        if (kind === 'pattern') {
          let id = '';
          set((state) => {
            const c = getActiveComposition(state.project, state.activeCompositionId);
            const p = setTilingPattern(
              c,
              getPatternPresetPatch('dots', c.width, c.height, c.frameRate),
            );
            id = addTilingPatternLayer(c, p.id);
            placePatternLayer(c, id, placement);
          });
          return id;
        }
        const layer = createLayerOfKind(kind);
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          insertNewLayer(composition, layer, kind, placement);
          if (kind === 'text' && layer.element.type === 'text') {
            const token = composition.designSystem.tokens.find(
              (item) =>
                item.type === 'color' && /(?:text|foreground)/i.test(`${item.key} ${item.name}`),
            );
            if (token) {
              const binding = { tokenId: token.id, targetProperty: 'color' as const };
              applyDesignTokenBinding(layer, binding, token);
              layer.designTokenBindings.push(binding);
            }
          }
          if (kind === 'audio') {
            state.project.supportsRealTime = true;
            state.project.supportsNonRealTime = false;
          }
        });
        return layer.id;
      },

      addChartLayer: (preset, provider, placement) => {
        if (typeof preset !== 'string' || !Object.hasOwn(CHART_LAYER_PRESETS, preset))
          throw new Error('Unknown chart preset.');
        const snapshot = selectedChartRendererSnapshot(provider);
        if (!snapshot.manifest.presets.includes(preset))
          throw new Error(`This chart provider does not support the ${preset} preset.`);
        const layer = createLayerOfKind('chart');
        if (layer.element.type !== 'chart') throw new Error('Expected chart element.');
        layer.element.preset = preset;
        layer.element.provider = { ...provider };
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          pinChartRendererSnapshot(composition, snapshot);
          insertNewLayer(composition, layer, 'chart', placement);
        });
        return layer.id;
      },

      addLowerThird: () => {
        return addFreshRecipe('news', materializeLowerThird);
      },
      setTilingPattern: (patch, patternId) => {
        let id = '';
        set((state) => {
          id = setTilingPattern(
            getActiveComposition(state.project, state.activeCompositionId),
            patch,
            patternId,
          ).id;
        });
        return id;
      },
      removeTilingPattern: (patternId) =>
        set((state) => {
          removeTilingPattern(
            getActiveComposition(state.project, state.activeCompositionId),
            patternId,
          );
        }),
      addPatternInstance: (patternId, placement) => {
        let id = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          id = addTilingPatternLayer(composition, patternId);
          placePatternLayer(composition, id, placement);
        });
        return id;
      },
      createPatternResource: (patch, addToCanvas = true, placement) => {
        let result!: { patternId: string; layerId?: string };
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const baseName = patch.name?.trim() || 'Pattern';
          let name = baseName;
          let suffix = 2;
          while (composition.patterns.some((pattern) => pattern.name === name))
            name = `${baseName} ${suffix++}`;
          const pattern = setTilingPattern(composition, { ...patch, name });
          result = { patternId: pattern.id };
          if (addToCanvas) {
            result.layerId = addTilingPatternLayer(composition, pattern.id);
            placePatternLayer(composition, result.layerId, placement);
          }
        });
        return result;
      },
      duplicatePatternResource: (patternId) => {
        const state = get();
        const source = getActiveComposition(state.project, state.activeCompositionId).patterns.find(
          (pattern) => pattern.id === patternId,
        );
        if (!source) throw new Error('This pattern no longer exists.');
        const { id: _id, ...copy } = structuredClone(source);
        return get().createPatternResource({ ...copy, name: `${source.name} copy` }, false)
          .patternId;
      },
      makePatternIndependent: (layerId) => {
        const state = get();
        const composition = getActiveComposition(state.project, state.activeCompositionId);
        const layer = composition.layers.find((candidate) => candidate.id === layerId);
        if (!layer || layer.element.type !== 'pattern') throw new Error('Select a pattern layer.');
        if (layer.isLocked) throw new Error('Unlock this layer before making it independent.');
        const sourcePatternId = layer.element.patternId;
        const source = composition.patterns.find((pattern) => pattern.id === sourcePatternId);
        if (!source) throw new Error('This pattern no longer exists.');
        const { id: _id, ...copy } = structuredClone(source);
        let id = '';
        set((draft) => {
          const current = getActiveComposition(draft.project, draft.activeCompositionId);
          const target = current.layers.find((candidate) => candidate.id === layerId)!;
          if (target.element.type !== 'pattern') return;
          const baseName = `${source.name} copy`;
          let name = baseName;
          let suffix = 2;
          while (current.patterns.some((pattern) => pattern.name === name))
            name = `${baseName} ${suffix++}`;
          id = setTilingPattern(current, { ...copy, name }).id;
          target.element.patternId = id;
          if (target.lighting?.patternId === source.id) target.lighting.patternId = id;
        });
        return id;
      },

      addBug: () => {
        return addFreshRecipe('news', materializeBug);
      },

      addTicker: () => {
        return addFreshRecipe('news', materializeTicker);
      },

      addScoreboard: () => {
        return addFreshRecipe('sports', materializeScoreboard);
      },

      addClock: () => {
        return addFreshRecipe('news', materializeClock);
      },

      addCountdown: () => {
        return addFreshRecipe('sports', materializeCountdown);
      },

      addRepeater: (layerIds, count = 3, direction = 'horizontal', gap = 24) => {
        if (layerIds.length === 0 || count < 2) return null;
        let result!: MaterializedRepeater;
        try {
          set((state) => {
            const composition = getActiveComposition(state.project, state.activeCompositionId);
            result = materializeRepeater(composition, {
              layerIds,
              items: Array.from({ length: count }, (_, index) => ({
                label: `Item ${index + 1}`,
              })),
              direction,
              gap,
            });
          });
          return result;
        } catch {
          return null;
        }
      },

      pasteLayers: (layers, offset = 20) => {
        if (layers.length === 0) return [];
        const snapshot = get();
        const sourceComposition = getActiveComposition(
          snapshot.project,
          snapshot.activeCompositionId,
        );
        const sources = layers.map((layer) => structuredClone(layer));
        let pastedIds: string[] = [];
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          pastedIds = appendLayerCopies(composition, sourceComposition, sources, offset);
          // Rules pasted from another composition may aim at layers that aren't here.
          pruneVisualRuleReferences(composition);
        });
        return pastedIds;
      },

      duplicateLayers: (layerIds) => {
        const snapshot = get();
        const sourceComposition = getActiveComposition(
          snapshot.project,
          snapshot.activeCompositionId,
        );
        const sources = duplicateObjectLayers(sourceComposition, layerIds);
        if (sources.length === 0) return [];
        let duplicatedIds: string[] = [];
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          duplicatedIds = appendLayerCopies(
            composition,
            sourceComposition,
            sources,
            0,
            'after-selection',
          );
        });
        return duplicatedIds;
      },

      removeLayer: (layerId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          if (
            composition.runtimeCollections.some((collection) =>
              collection.prototypeLayerIds.includes(layerId),
            )
          ) {
            return;
          }
          if (composition.layers.find((layer) => layer.id === layerId)?.isLocked) return;
          assertMaskSourcesRemovable(composition, new Set([layerId]));
          assertModifierSourcesRemovable(composition, new Set([layerId]));
          rehomeVisualRuleGroupOwners(composition.layers, new Set([layerId]));
          composition.layers = composition.layers.filter((l) => l.id !== layerId);
          syncCompositionShaderParameterFields(composition);
          for (const layer of composition.layers) {
            if (layer.parentId === layerId) layer.parentId = null;
            if (layer.motionPath?.sourceLayerId === layerId) layer.motionPath = null;
            if (layer.textPath?.sourceLayerId === layerId) layer.textPath = null;
          }
          for (const folder of composition.layout.timelineFolders) {
            folder.layerIds = folder.layerIds.filter((candidate) => candidate !== layerId);
          }
          composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
            (folder) => folder.layerIds.length > 0,
          );
          pruneVisualRuleReferences(composition);
        }),

      updateLayerTransform: (layerId, frame, patch) => {
        const values = useTestDataStore.getState().values;
        const resets: Array<{ fieldId: string; sourcePath: string[] }> = [];
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (!layer || layer.isLocked) return;
          const preview = Object.fromEntries(
            composition.dataFields.flatMap((field) => {
              const value = resolvePreviewFieldValue(field, values[field.id]);
              return value === undefined ? [] : [[field.id, value]];
            }),
          );
          const bound = syncDesignerTransformBindingDefaults(composition, layer, patch, preview);
          resets.push(...bound.resets);
          if (Object.keys(bound.patch).length)
            writeUiLayerTransform(composition, layer, frame, bound.patch);
        });
        useTestDataStore.getState().clearOverrides(resets);
      },

      addLayerKeyframe: (layerId, frame, options = {}) => {
        let createdId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) throw new Error(`Layer is missing or locked: ${layerId}`);
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const existing = findLayerKeyframeAtFrame(layer, roundedFrame);
          const created =
            existing ??
            createLayerKeyframe(roundedFrame, getLayerTransformAtFrame(layer, roundedFrame));
          if (!existing) layer.keyframes.push(created);
          layer.keyframes = sortLayerKeyframes(layer.keyframes);
          const transform = getLayerTransformAtFrame(layer, roundedFrame);
          for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
            upsertPropertyKeyframe(
              layer,
              property,
              roundedFrame,
              transform[property],
              created.easing,
            );
          }
          if (options.includeEffects !== false) {
            const effects = getLayerEffectsAtFrame(layer, roundedFrame);
            for (const property of EFFECT_ANIMATION_PROPERTIES) {
              upsertPropertyKeyframe(
                layer,
                property,
                roundedFrame,
                effects[property],
                created.easing,
              );
            }
          }
          createdId = created.id;
        });
        return createdId;
      },

      addLayerHoldFrame: (layerId, frame) => {
        let createdId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) throw new Error(`Layer is missing or locked: ${layerId}`);
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const existing = findLayerKeyframeAtFrame(layer, roundedFrame);
          if (existing) {
            createdId = existing.id;
            return;
          }
          const previous = [...layer.keyframes]
            .sort((a, b) => a.frame - b.frame)
            .filter((keyframe) => keyframe.frame < roundedFrame)
            .at(-1);
          const created = createLayerKeyframe(
            roundedFrame,
            previous?.transform ?? getLayerTransformAtFrame(layer, roundedFrame),
            { easing: previous?.easing ?? 'linear' },
          );
          layer.keyframes.push(created);
          layer.keyframes = sortLayerKeyframes(layer.keyframes);
          for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
            upsertPropertyKeyframe(
              layer,
              property,
              roundedFrame,
              created.transform[property],
              created.easing,
            );
          }
          const effects = getLayerEffectsAtFrame(layer, roundedFrame);
          for (const property of EFFECT_ANIMATION_PROPERTIES) {
            upsertPropertyKeyframe(
              layer,
              property,
              roundedFrame,
              effects[property],
              created.easing,
            );
          }
          createdId = created.id;
        });
        return createdId;
      },

      moveLayerKeyframe: (layerId, keyframeId, frame) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          const keyframe = layer?.keyframes.find((candidate) => candidate.id === keyframeId);
          if (!layer || layer.isLocked || !keyframe) return;
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          if (
            layer.keyframes.some(
              (candidate) => candidate.id !== keyframeId && candidate.frame === roundedFrame,
            )
          ) {
            return;
          }
          const previousFrame = keyframe.frame;
          keyframe.frame = roundedFrame;
          layer.keyframes = sortLayerKeyframes(layer.keyframes);
          materializeAnimationTracks(layer);
          for (const property of Object.keys(layer.animationTracks) as AnimatableLayerProperty[]) {
            const track = layer.animationTracks[property];
            const propertyKey = track?.find((candidate) => candidate.frame === previousFrame);
            if (
              propertyKey &&
              !track?.some(
                (candidate) => candidate.id !== propertyKey.id && candidate.frame === roundedFrame,
              )
            ) {
              propertyKey.frame = roundedFrame;
              layer.animationTracks[property] = sortLayerPropertyKeyframes(track ?? []);
            }
          }
        }),

      moveTimelineKeyframesTogether: (keyframeSelections, deltaFrames) => {
        let appliedDelta = 0;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const uniqueSelections = [
            ...new Map(
              keyframeSelections.map((selection) => [
                `${selection.layerId}:${selection.property ?? 'layer'}:${selection.keyframeId}`,
                selection,
              ]),
            ).values(),
          ];
          if (uniqueSelections.length === 0) return;
          const requestedDelta = Math.round(deltaFrames);
          if (requestedDelta === 0) return;
          const totalFrames = getTotalFrames(composition);
          let bounds = { min: -totalFrames, max: totalFrames };
          const aggregateMoves: Array<{
            layer: Layer;
            keys: LayerKeyframe[];
          }> = [];
          const propertyMoveMap = new Map<
            string,
            {
              layer: Layer;
              property: AnimatableLayerProperty;
              keys: Map<string, LayerPropertyKeyframe>;
            }
          >();
          const propertyMoveFor = (layer: Layer, property: AnimatableLayerProperty) => {
            const id = `${layer.id}:${property}`;
            let move = propertyMoveMap.get(id);
            if (!move) {
              move = { layer, property, keys: new Map() };
              propertyMoveMap.set(id, move);
            }
            return move;
          };

          for (const layerId of new Set(uniqueSelections.map((selection) => selection.layerId))) {
            const layer = composition.layers.find((candidate) => candidate.id === layerId);
            if (!layer || layer.isLocked) return;
            materializeAnimationTracks(layer);
            const layerSelections = uniqueSelections.filter(
              (selection) => selection.layerId === layerId,
            );
            const aggregateIds = new Set(
              layerSelections
                .filter((selection) => selection.property === null)
                .map((selection) => selection.keyframeId),
            );
            const aggregateKeys = layer.keyframes.filter((keyframe) =>
              aggregateIds.has(keyframe.id),
            );
            if (aggregateKeys.length !== aggregateIds.size) return;
            if (aggregateKeys.length > 0) {
              const aggregateBounds = timelineKeyDeltaBounds(
                layer.keyframes,
                aggregateIds,
                totalFrames,
              );
              bounds = {
                min: Math.max(bounds.min, aggregateBounds.min),
                max: Math.min(bounds.max, aggregateBounds.max),
              };
              aggregateMoves.push({ layer, keys: aggregateKeys });
              const aggregateFrames = new Set(aggregateKeys.map((keyframe) => keyframe.frame));
              for (const [property, keys] of Object.entries(layer.animationTracks) as [
                AnimatableLayerProperty,
                LayerPropertyKeyframe[] | undefined,
              ][]) {
                for (const keyframe of keys ?? []) {
                  if (aggregateFrames.has(keyframe.frame)) {
                    propertyMoveFor(layer, property).keys.set(keyframe.id, keyframe);
                  }
                }
              }
            }

            for (const selection of layerSelections.filter(
              (candidate) => candidate.property !== null,
            )) {
              const property = selection.property!;
              const keyframe = layer.animationTracks[property]?.find(
                (candidate) => candidate.id === selection.keyframeId,
              );
              if (!keyframe) return;
              propertyMoveFor(layer, property).keys.set(keyframe.id, keyframe);
            }
          }

          const propertyMoves: Array<{
            layer: Layer;
            property: AnimatableLayerProperty;
            keys: LayerPropertyKeyframe[];
          }> = [];
          for (const move of propertyMoveMap.values()) {
            const movedKeys = [...move.keys.values()];
            const track = move.layer.animationTracks[move.property] ?? [];
            const movedIds = new Set(move.keys.keys());
            const trackBounds = timelineKeyDeltaBounds(track, movedIds, totalFrames);
            bounds = {
              min: Math.max(bounds.min, trackBounds.min),
              max: Math.min(bounds.max, trackBounds.max),
            };
            propertyMoves.push({ layer: move.layer, property: move.property, keys: movedKeys });
          }
          appliedDelta = Math.max(bounds.min, Math.min(bounds.max, requestedDelta));
          if (appliedDelta === 0) return;

          for (const move of aggregateMoves) {
            for (const keyframe of move.keys) keyframe.frame += appliedDelta;
            move.layer.keyframes = sortLayerKeyframes(move.layer.keyframes);
          }
          for (const move of propertyMoves) {
            const previousFrames = move.keys.map((keyframe) => keyframe.frame);
            const track = move.layer.animationTracks[move.property] ?? [];
            for (const keyframe of move.keys) keyframe.frame += appliedDelta;
            move.layer.animationTracks[move.property] = sortLayerPropertyKeyframes(track);
            for (const keyframe of move.keys) {
              syncAggregateKeyframe(move.layer, keyframe.frame, keyframe.easing);
            }
            for (const frame of previousFrames) {
              removeAggregateKeyframeIfOrphaned(move.layer, frame);
            }
          }
        });
        return appliedDelta;
      },

      removeLayerKeyframe: (layerId, keyframeId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked || layer.keyframes.length <= 1) return;
          const removed = layer.keyframes.find((keyframe) => keyframe.id === keyframeId);
          layer.keyframes = layer.keyframes.filter((keyframe) => keyframe.id !== keyframeId);
          if (!removed) return;
          materializeAnimationTracks(layer);
          for (const property of Object.keys(layer.animationTracks) as AnimatableLayerProperty[]) {
            const track = layer.animationTracks[property] ?? [];
            if (track.length > 1 || parseShaderAnimationProperty(property)) {
              layer.animationTracks[property] = track.filter(
                (keyframe) => keyframe.frame !== removed.frame,
              );
              if (
                parseShaderAnimationProperty(property) &&
                layer.animationTracks[property]?.length === 0
              )
                delete layer.animationTracks[property];
            }
          }
        }),

      updateLayerKeyframeEasing: (layerId, keyframeId, easing) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          const keyframe = layer?.keyframes.find((candidate) => candidate.id === keyframeId);
          if (!layer || layer.isLocked || !keyframe) return;
          keyframe.easing = easing;
          materializeAnimationTracks(layer);
          for (const property of Object.keys(layer.animationTracks) as AnimatableLayerProperty[]) {
            const propertyKey = layer.animationTracks[property]?.find(
              (candidate) => candidate.frame === keyframe.frame,
            );
            if (propertyKey) {
              propertyKey.easing = easing;
              delete propertyKey.curve;
            }
          }
        }),

      addLayerPropertyKeyframe: (layerId, property, frame) => {
        let createdId = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) throw new Error(`Layer is missing or locked: ${layerId}`);
          if (
            parseShaderAnimationProperty(property) &&
            !shaderAnimationPropertySpec(layer.element, property)
          )
            throw new Error(`Unknown shader animation property "${property}".`);
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const existing = findLayerPropertyKeyframeAtFrame(layer, property, roundedFrame);
          const created =
            existing ??
            upsertPropertyKeyframe(
              layer,
              property,
              roundedFrame,
              getLayerPropertyValueAtFrame(layer, property, roundedFrame),
            );
          syncAggregateKeyframe(layer, roundedFrame, created.easing);
          createdId = created.id;
        });
        return createdId;
      },

      enableLayerPropertyAnimation: (layerId, property, frame) =>
        get().addLayerPropertyKeyframe(layerId, property, frame),

      resetLayerPropertyAnimation: (layerId, property, frame) => {
        if (!Number.isFinite(frame)) throw new Error('Reset animation requires a finite frame.');
        const source = getActiveComposition(get().project, get().activeCompositionId);
        const boundedFrame = Math.max(0, Math.min(getTotalFrames(source), frame));
        const loopSample = getEditorLoopSample(source, layerId, boundedFrame);
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer) throw new Error('The selected object is no longer in this composition.');
          resetPropertyAnimation(layer, property, boundedFrame, {
            composition,
            ...(loopSample ? { loopElapsedFrames: loopSample.elapsedFrames } : {}),
          });
          syncResetShaderParameterDefault(composition, layer, property);
        });
      },

      toggleLayerPropertyKeyframe: (layerId, property, frame) => {
        const state = get();
        const composition = getActiveComposition(state.project, state.activeCompositionId);
        const layer = composition.layers.find((candidate) => candidate.id === layerId);
        if (!layer || layer.isLocked) return null;
        const roundedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
        const key = findLayerPropertyKeyframeAtFrame(layer, property, roundedFrame);
        if (!key) return get().addLayerPropertyKeyframe(layerId, property, roundedFrame);
        set((draft) => {
          const current = getActiveComposition(
            draft.project,
            draft.activeCompositionId,
          ).layers.find((candidate) => candidate.id === layerId);
          if (current) {
            removePropertyKeyframe(current, property, key.id, roundedFrame);
            if (parseShaderAnimationProperty(property))
              syncShaderParameterFields(
                getActiveComposition(draft.project, draft.activeCompositionId),
                current,
              );
          }
        });
        return null;
      },

      moveLayerPropertyKeyframe: (layerId, property, keyframeId, frame) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const track = layer.animationTracks[property] ?? [];
          const keyframe = track.find((candidate) => candidate.id === keyframeId);
          if (!keyframe) return;
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          if (
            track.some(
              (candidate) => candidate.id !== keyframeId && candidate.frame === roundedFrame,
            )
          )
            return;
          const previousFrame = keyframe.frame;
          keyframe.frame = roundedFrame;
          layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
          syncAggregateKeyframe(layer, roundedFrame, keyframe.easing);
          removeAggregateKeyframeIfOrphaned(layer, previousFrame);
        }),

      removeLayerPropertyKeyframe: (layerId, property, keyframeId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          removePropertyKeyframe(layer, property, keyframeId, canvasFrame(composition));
          if (parseShaderAnimationProperty(property)) syncShaderParameterFields(composition, layer);
        }),

      updateLayerPropertyKeyframeValue: (layerId, property, keyframeId, value) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked || !Number.isFinite(value)) return;
          if (
            parseShaderAnimationProperty(property) &&
            !shaderAnimationPropertySpec(layer.element, property)
          )
            return;
          materializeAnimationTracks(layer);
          const key = layer.animationTracks[property]?.find(
            (candidate) => candidate.id === keyframeId,
          );
          if (!key) return;
          key.value = normalizeOffsetProperty(layer, property, value);
          syncAggregateKeyframe(layer, key.frame, key.easing);
        }),

      updateLayerPropertyKeyframeEasing: (layerId, property, keyframeId, easing) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const keyframe = layer.animationTracks[property]?.find(
            (candidate) => candidate.id === keyframeId,
          );
          if (keyframe) {
            keyframe.easing = easing;
            delete keyframe.curve;
          }
        }),

      updateLayerPropertyKeyframeCurve: (layerId, property, keyframeId, curve) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const keyframe = layer.animationTracks[property]?.find(
            (candidate) => candidate.id === keyframeId,
          );
          if (!keyframe) return;
          if (curve) keyframe.curve = { ...curve };
          else delete keyframe.curve;
        }),

      offsetLayerPropertyTrack: (layerId, property, deltaFrames) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const track = layer.animationTracks[property] ?? [];
          const maxFrame = getTotalFrames(composition);
          const min = track[0]?.frame ?? 0;
          const max = track.at(-1)?.frame ?? 0;
          const safeDelta = Math.max(-min, Math.min(maxFrame - max, Math.round(deltaFrames)));
          const previousFrames = track.map((keyframe) => keyframe.frame);
          for (const keyframe of track) keyframe.frame += safeDelta;
          for (const keyframe of track) {
            syncAggregateKeyframe(layer, keyframe.frame, keyframe.easing);
          }
          for (const frame of previousFrames) removeAggregateKeyframeIfOrphaned(layer, frame);
        }),

      scaleLayerPropertyTrack: (layerId, property, scale) =>
        set((state) => {
          if (!(scale > 0)) return;
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const track = sortLayerPropertyKeyframes(layer.animationTracks[property] ?? []);
          if (track.length < 2) return;
          const pivot = track[0]?.frame ?? 0;
          const maxFrame = getTotalFrames(composition);
          const end = track.at(-1)?.frame ?? pivot;
          const maximumScale = end === pivot ? scale : (maxFrame - pivot) / (end - pivot);
          const effectiveScale = Math.min(scale, maximumScale);
          const nextFrames = track.map((keyframe) =>
            Math.round(pivot + (keyframe.frame - pivot) * effectiveScale),
          );
          if (!framesAreUnique(nextFrames)) return;
          const previousFrames = track.map((keyframe) => keyframe.frame);
          track.forEach((keyframe, index) => {
            keyframe.frame = nextFrames[index]!;
          });
          layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
          for (const keyframe of track) {
            syncAggregateKeyframe(layer, keyframe.frame, keyframe.easing);
          }
          for (const frame of previousFrames) removeAggregateKeyframeIfOrphaned(layer, frame);
        }),

      reverseLayerPropertyTrack: (layerId, property) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const track = sortLayerPropertyKeyframes(layer.animationTracks[property] ?? []);
          const start = track[0]?.frame ?? 0;
          const end = track.at(-1)?.frame ?? start;
          const previousFrames = track.map((keyframe) => keyframe.frame);
          for (const keyframe of track) keyframe.frame = start + end - keyframe.frame;
          layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
          for (const keyframe of track) {
            syncAggregateKeyframe(layer, keyframe.frame, keyframe.easing);
          }
          for (const frame of previousFrames) removeAggregateKeyframeIfOrphaned(layer, frame);
        }),

      distributeLayerPropertyTrack: (layerId, property) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          materializeAnimationTracks(layer);
          const track = sortLayerPropertyKeyframes(layer.animationTracks[property] ?? []);
          if (track.length < 3) return;
          const start = track[0]!.frame;
          const end = track.at(-1)!.frame;
          if (end - start < track.length - 1) return;
          const nextFrames = track.map((_, index) =>
            Math.round(start + ((end - start) * index) / (track.length - 1)),
          );
          if (!framesAreUnique(nextFrames)) return;
          const previousFrames = track.map((keyframe) => keyframe.frame);
          track.forEach((keyframe, index) => {
            keyframe.frame = nextFrames[index]!;
          });
          layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
          for (const keyframe of track) {
            syncAggregateKeyframe(layer, keyframe.frame, keyframe.easing);
          }
          for (const frame of previousFrames) removeAggregateKeyframeIfOrphaned(layer, frame);
        }),

      setLayerLighting: (layerId, link) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          for (const id of typeof layerId === 'string' ? [layerId] : layerId)
            setLayerLighting(composition, id, link);
        }),

      setLayerLoop: (layerId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const nextDuration = Math.max(
            1,
            Math.round(patch.durationFrames ?? layer.loop?.durationFrames ?? composition.frameRate),
          );
          if (
            layer.loop &&
            Object.values(layer.loop.tracks).some((track) =>
              track?.some((key) => key.frame > nextDuration),
            )
          ) {
            return;
          }
          layer.loop ??= createLayerLoopClip({ durationFrames: nextDuration });
          if (patch.name !== undefined) layer.loop.name = patch.name.trim() || 'Loop';
          if (patch.activation !== undefined)
            layer.loop.activation = structuredClone(patch.activation);
          if (patch.activation?.type === 'customAction' && patch.repeatCount === undefined) {
            layer.loop.repeatCount = 1;
          }
          layer.loop.durationFrames = nextDuration;
          if (patch.timing !== undefined) {
            if (patch.timing === null) delete layer.loop.timing;
            else layer.loop.timing = structuredClone(patch.timing);
          }
          if (patch.phaseOffsetFrames !== undefined) {
            layer.loop.phaseOffsetFrames = Math.round(patch.phaseOffsetFrames);
          }
          if (patch.repeatCount !== undefined) {
            layer.loop.repeatCount =
              patch.repeatCount === null ? null : Math.max(1, Math.round(patch.repeatCount));
          }
          const lightingErrors = layerLightingErrors(layer, composition.patterns);
          if (lightingErrors.length) throw new Error(lightingErrors.join(' '));
        }),

      setLayerLoopPropertyTrack: (layerId, property, keys) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked || !layer.loop) return;
          const shaderSpec = shaderAnimationPropertySpec(layer.element, property);
          if (parseShaderAnimationProperty(property) && !shaderSpec) return;
          const normalized = sortLayerPropertyKeyframes(
            keys
              .map((key) => ({
                ...key,
                frame: Math.max(0, Math.min(layer.loop!.durationFrames, Math.round(key.frame))),
                ...(shaderSpec
                  ? { value: clampShaderAnimationValue(layer.element, property, key.value) }
                  : {}),
                ...(key.curve ? { curve: { ...key.curve } } : {}),
                ...(shaderSpec?.discrete ? { easing: 'linear' as const, curve: undefined } : {}),
              }))
              .filter(
                (key, index, all) =>
                  all.findIndex((candidate) => candidate.frame === key.frame) === index,
              ),
          );
          if (normalized.length === 0) delete layer.loop.tracks[property];
          else layer.loop.tracks[property] = normalized;
        }),

      removeLayerLoop: (layerId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer && !layer.isLocked) layer.loop = null;
        }),

      editLayerPath: (layerId, edit, frame = 0) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer) throw new Error('The selected layer no longer exists.');
          applyPathEdit(layer, edit, frame);
        }),

      selectChartProvider: (layerId, provider) => {
        const snapshot = selectedChartRendererSnapshot(provider);
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((item) => item.id === layerId);
          if (!layer || layer.isLocked || layer.element.type !== 'chart') return;
          const oldProvider = layer.element.provider;
          layer.element.provider = { ...provider };
          if (!snapshot.manifest.presets.includes(layer.element.preset))
            layer.element.preset = snapshot.manifest.presets[0]!;
          if (oldProvider && rendererPluginKey(oldProvider) !== rendererPluginKey(provider)) {
            const oldKey = rendererPluginKey(oldProvider);
            const stillUsed = [
              ...composition.layers,
              ...composition.components.flatMap((component) => component.layers),
            ].some(
              (candidate) =>
                candidate.element.type === 'chart' &&
                candidate.element.provider &&
                rendererPluginKey(candidate.element.provider) === oldKey,
            );
            if (!stillUsed)
              composition.rendererPlugins = (composition.rendererPlugins ?? []).filter(
                (entry) => rendererPluginKey(rendererPluginReference(entry)) !== oldKey,
              );
          }
          pinChartRendererSnapshot(composition, snapshot);
        });
      },

      upgradeChartRenderer: (from, to) => {
        const snapshot = selectedChartRendererSnapshot(to);
        const session = useProjectSetStore.getState();
        const plan = planChartRendererUpgrade(
          get().project,
          from,
          snapshot,
          session.projectSet,
          session.activeTemplateId,
        );
        if (plan.errors.length) throw new Error(plan.errors.join('\n'));
        const sourceKey = rendererPluginKey(from);
        set((state) => {
          for (const composition of state.project.compositions) {
            let changed = false;
            for (const layer of composition.layers) {
              if (
                layer.element.type === 'chart' &&
                layer.element.provider &&
                rendererPluginKey(layer.element.provider) === sourceKey
              ) {
                // Let the component reconciler carry inherited provider changes. Editing an
                // inherited materialized child here would accidentally create a local override.
                const link = layer.componentLink;
                const source =
                  link &&
                  composition.components
                    .find((component) => component.id === link.componentId)
                    ?.layers.find((item) => item.id === link.sourceLayerId);
                const inheritedFromSource =
                  source?.element.type === 'chart' &&
                  source.element.provider &&
                  rendererPluginKey(source.element.provider) === sourceKey;
                const baseline = link?.baseline?.element;
                const inheritedBeforeEdit =
                  baseline?.type === 'chart' &&
                  baseline.provider &&
                  rendererPluginKey(baseline.provider) === sourceKey;
                const overridden = link?.overridePaths?.some(
                  (path) =>
                    path === '/element' ||
                    path === '/element/provider' ||
                    path.startsWith('/element/provider/'),
                );
                if (inheritedFromSource && inheritedBeforeEdit && !overridden) continue;
                layer.element.provider = { ...to };
                changed = true;
              }
            }
            for (const component of composition.components) {
              let componentChanged = false;
              for (const layer of component.layers) {
                if (
                  layer.element.type === 'chart' &&
                  layer.element.provider &&
                  rendererPluginKey(layer.element.provider) === sourceKey
                ) {
                  layer.element.provider = { ...to };
                  changed = true;
                  componentChanged = true;
                }
              }
              if (componentChanged && component.context)
                pinChartRendererSnapshot(component.context, snapshot);
            }
            if (changed) pinChartRendererSnapshot(composition, snapshot);
          }
        });
      },

      updateLayerElement: (layerId, patch) =>
        designerEdit(layerId, Object.keys(patch), (state, composition, layers) => {
          const layer = layers[0]!;
          if (layer && !layer.isLocked) {
            if (layer.textPath && layer.element.type === 'text') {
              const candidate = { ...layer.element, ...patch } as typeof layer.element;
              candidate.textAnimation = normalizeTextAnimation(candidate.textAnimation);
              const errors = textPathCompatibilityErrors(candidate);
              if (errors.length) throw new Error(errors.join('\n'));
            }
            if (layer.element.type === 'ticker') {
              const ticker = { ...layer.element, ...patch };
              const errors = tickerErrors(ticker);
              if (errors.length) throw new Error(errors.join('\n'));
              Object.assign(patch, normalizeTicker(ticker as TickerElement));
            }
            const shaderPaints = getElementShaderPaints({
              ...layer.element,
              ...patch,
            } as typeof layer.element);
            for (const { paint } of shaderPaints) {
              const inspection = inspectShaderElement(paint);
              if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
            }
            if (layer.element.type === 'text' && patch.textAnimation !== undefined) {
              patch.textAnimation = normalizeTextAnimation({
                ...layer.element.textAnimation,
                ...patch.textAnimation,
              });
            }
            if (layer.element.type === 'text' && patch.clock != null)
              patch.clock = normalizeClockTimerSettings({ ...layer.element.clock, ...patch.clock });
            if (
              layer.element.type === 'text' &&
              patch.content !== undefined &&
              patch.content !== layer.element.content &&
              patch.runs === undefined
            ) {
              layer.element.runs = [];
            }
            Object.assign(layer.element, patch);
            if (
              layer.element.type === 'text' &&
              Object.hasOwn(patch, 'clock') &&
              patch.clock == null
            )
              delete layer.element.clock;
            enforceMediaRuntimeProfile(state.project);
            syncShaderParameterFields(composition, layer);
            pruneInvalidGradientStopTracks(layer);
            if (Object.hasOwn(patch, 'clock') && patch.clock == null)
              pruneVisualRuleReferences(composition);
          }
        }),

      updateLayerShaderParameter: (layerId, frame, slot, name, value) =>
        designerEdit(
          layerId,
          [shaderParameterTarget(name, slot)],
          (_state, composition, layers) => {
            const layer = layers[0]!;
            if (!layer || layer.isLocked || !getElementShaderPaint(layer.element, slot)) return;
            const roundedFrame = Math.max(
              0,
              Math.min(getTotalFrames(composition), Math.round(frame)),
            );
            const incoming = applyElementDataValue(
              layer.element,
              shaderParameterTarget(name, slot),
              value,
            );
            const authoredChanges: Record<string, number> = {};
            for (const property of getShaderAnimatableProperties(layer.element)) {
              const parsed = parseShaderAnimationProperty(property)!;
              if (parsed.slot !== slot || parsed.name !== name) continue;
              const before = getLayerPropertyValueAtFrame(layer, property, roundedFrame);
              const next = getShaderAnimationValue(incoming, property);
              if (Math.abs(next - before) < 1e-9) continue;
              if (!keyPropertyEdit(layer, property, roundedFrame, next, before)) {
                offsetExistingPropertyKeys(layer, property, next - before);
                authoredChanges[property] = next;
              }
            }
            if (Object.keys(authoredChanges).length) {
              layer.element = applyShaderAnimationValues(layer.element, authoredChanges);
              syncShaderParameterFields(composition, layer);
            }
          },
        ),

      createShaderResource: (paint) => {
        let target: StoredShaderResourceTarget | undefined;
        set((state) => {
          const next = shaderPaintWithPatch(
            paint ?? createShaderPaint(),
            {},
            { libraryResource: true },
          );
          if (!next.name) next.name = defaultShaderResourceName(state.project);
          const resource = createStoredShaderResource({ paint: next });
          state.project.shaders.push(resource);
          target = { shaderId: resource.id };
        });
        return target!;
      },

      ensureShaderResource: (paint) => {
        const inspection = inspectShaderResourcePaint(paint);
        if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
        let target: StoredShaderResourceTarget | undefined;
        set((state) => {
          const existing = state.project.shaders.find(
            (resource) =>
              shaderLibraryContentKey(resource.paint) === shaderLibraryContentKey(paint),
          );
          if (existing) {
            target = { shaderId: existing.id };
          } else {
            const resource = createStoredShaderResource({ paint: structuredClone(paint) });
            state.project.shaders.push(resource);
            target = { shaderId: resource.id };
          }
        });
        return target!;
      },

      importShaderPackPreset: (reference, presetId, target) => {
        const paint = resolveShaderPackPresetPaint(
          installedShaderPack(reference),
          presetId,
          target,
        );
        return get().ensureShaderResource(paint);
      },

      applyShaderPackPreset: (layerIds, reference, presetId, target) => {
        const paint = resolveShaderPackPresetPaint(
          installedShaderPack(reference),
          presetId,
          target,
        );
        get().applyShaderPaintToLayers(layerIds, paint, target, { saveResource: true });
      },

      applyShaderPaintToLayers: (layerIds, paint, target, options = {}) => {
        if (!['fill', 'outline', 'effect'].includes(target))
          throw new Error('Unknown shader application target.');
        const validatedPaint = structuredClone(paint);
        if (target === 'effect') delete validatedPaint.inputImage;
        const ids = new Set(typeof layerIds === 'string' ? [layerIds] : layerIds);
        if (!ids.size) throw new Error('Select an object before applying a shader.');
        const active = getActiveComposition(get().project, get().activeCompositionId);
        const selected = active.layers.filter((layer) => ids.has(layer.id));
        if (selected.length !== ids.size)
          throw new Error('A selected shader target no longer exists.');
        const previousGeneratedFields = active.dataFields.filter(
          (field) =>
            field.generatedShaderParameter && ids.has(field.generatedShaderParameter.layerId),
        );
        for (const layer of selected) {
          const reason = shaderPackLayerTargetReason(layer, target);
          if (reason) throw new Error(reason);
        }
        const slot = target === 'outline' ? 'stroke' : 'fill';
        const inspection = inspectShaderElement(validatedPaint, {
          channel0Provided: target === 'effect',
        });
        if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
        if (options.saveResource) {
          const resourceInspection = inspectShaderResourcePaint(paint);
          if (!resourceInspection.valid) throw new Error(resourceInspection.errors.join('\n'));
        }
        const properties =
          target === 'effect'
            ? []
            : [
                target === 'outline' ? 'strokePaint' : 'fill',
                ...(target === 'fill' ? ['color'] : []),
                ...inspection.parameters.map((parameter) =>
                  shaderParameterTarget(parameter.name, slot),
                ),
              ];
        const sharedEffectId = target === 'effect' ? createId('fx') : undefined;
        designerEdit([...ids], properties, (state, composition, layers) => {
          const prepared = layers.map((layer) => structuredClone(current(layer)));
          const byId = new Map(prepared.map((layer) => [layer.id, layer]));
          const scope: Composition = {
            ...current(composition),
            layers: composition.layers.map((layer) => byId.get(layer.id) ?? current(layer)),
            dataFields: structuredClone(current(composition.dataFields)),
          };
          for (const layer of prepared) {
            // Preflight again inside the single transaction, before publishing any target.
            const reason = shaderPackLayerTargetReason(layer, target);
            if (reason) throw new Error(reason);
            const copy = structuredClone(paint);
            if (target === 'effect') {
              delete copy.inputImage;
              addEffect(
                layer,
                'shader',
                {
                  name: copy.name?.trim() || 'Shader',
                  enabled: true,
                  blendMode: 'normal',
                  blendOpacity: 1,
                  shader: copy,
                },
                undefined,
                sharedEffectId,
              );
            } else {
              if (target === 'outline') {
                if (layer.element.type !== 'text') throw new Error('Shader outlines require text.');
                layer.element.strokePaint = copy;
              } else {
                const element = layer.element;
                if (
                  element.type === 'rectangle' ||
                  element.type === 'ellipse' ||
                  element.type === 'path' ||
                  element.type === 'pattern' ||
                  element.type === 'text' ||
                  element.type === 'image' ||
                  element.type === 'image-sequence' ||
                  element.type === 'lottie'
                )
                  element.fill = copy;
                else throw new Error('The selected object does not support a shader fill.');
              }
              syncShaderParameterFields(scope, layer);
              if (target === 'fill') pruneInvalidGradientStopTracks(layer);
            }
          }
          // Applied copies carry attribution, not live references; no pack execution pin is needed.
          layers.forEach((layer, index) => Object.assign(layer, prepared[index]!));
          composition.dataFields = scope.dataFields;
          if (
            options.saveResource &&
            !state.project.shaders.some(
              (resource) =>
                shaderLibraryContentKey(resource.paint) === shaderLibraryContentKey(paint),
            )
          )
            state.project.shaders.push(
              createStoredShaderResource({ paint: structuredClone(paint) }),
            );
        });
        // Removed generated parameters must not regain an old test override if a later shader
        // introduces the same name. Ordinary/shared fields and unrelated preview data stay intact.
        const fields = new Set(
          getActiveComposition(get().project, get().activeCompositionId).dataFields.map(
            (field) => field.id,
          ),
        );
        useTestDataStore
          .getState()
          .clearOverrides(
            previousGeneratedFields
              .filter((field) => !fields.has(field.id))
              .map((field) => ({ fieldId: field.id, sourcePath: [] })),
          );
      },

      updateShaderResource: (target, patch) => {
        const values = useTestDataStore.getState().values;
        const resets: Array<{ fieldId: string; sourcePath: string[] }> = [];
        set((state) => {
          if (isStoredShaderResourceTarget(target)) {
            const { resource, paint } = resolveShaderResource(state.project, target);
            resource.paint = shaderPaintWithPatch(paint, patch, { libraryResource: true });
            return;
          }
          const { composition, component, layer, paint, item } = resolveShaderResource(
            state.project,
            target,
          );
          const before = { element: current(layer.element), effects: current(layer.effects) };
          if (layer.isLocked) throw new Error(`Shader resource object "${layer.name}" is locked.`);
          if (target.tickerBackground) {
            if (layer.element.type !== 'ticker') throw new Error('Expected a ticker.');
            layer.element.background = shaderPaintWithPatch(paint, patch);
            return;
          }
          if (item) {
            const next = shaderPaintWithPatch(paint, patch, {
              channel0Provided: target.slot === 'effect',
            });
            if (target.slot === 'effect') {
              const effect =
                item.effects &&
                getEffectStack(item.effects).find(
                  (entry) => entry.id === target.effectId && entry.type === 'shader',
                );
              if (!effect) throw new Error('The ticker shader effect no longer exists.');
              effect.shader = next;
              return;
            }
            if (target.slot === 'stroke') {
              if (item.element.type !== 'text') throw new Error('Shader outlines require text.');
              item.element.strokePaint = next;
            } else if (item.element.type === 'shader') item.element = next;
            else if ('fill' in item.element) item.element.fill = next;
            else throw new Error('The ticker item cannot use this shader paint.');
            const prefix = `items.${item.id}.${shaderParameterTarget('', target.slot)}`;
            const parameters = new Set(
              inspectShaderSource(next.fragmentSource).parameters.map(
                (parameter) => parameter.name,
              ),
            );
            layer.bindings = layer.bindings.filter(
              (binding) =>
                !binding.targetProperty.startsWith(prefix) ||
                parameters.has(binding.targetProperty.slice(prefix.length)),
            );
            const scope = component
              ? {
                  ...composition,
                  layers: component.layers,
                  dataFields: component.dataFields,
                  runtimeCollections: [],
                  components: [],
                }
              : composition;
            resets.push(
              ...syncDesignerBindingDefaults(
                scope,
                layer,
                before,
                Object.keys(patch.parameters ?? {}).map((name) => `${prefix}${name}`),
                Object.fromEntries(
                  scope.dataFields.map((field) => [
                    field.id,
                    resolvePreviewFieldValue(field, values[field.id])!,
                  ]),
                ),
              ),
            );
            if (component) component.dataFields = scope.dataFields;
            return;
          }
          if (target.slot === 'effect') {
            const next = shaderPaintWithPatch(paint, patch, { channel0Provided: true });
            updateEffect(layer, target.effectId, { shader: next });
            return;
          }
          const next = shaderPaintWithPatch(paint, patch);
          if (target.slot === 'stroke') {
            if (layer.element.type !== 'text')
              throw new Error('Shader outlines are supported only on text.');
            layer.element.strokePaint = next;
          } else if (layer.element.type === 'shader') {
            layer.element = next;
          } else if ('fill' in layer.element) {
            layer.element.fill = next;
          } else {
            throw new Error('The selected object cannot use a shader paint.');
          }
          if (component) {
            const scope: Composition = {
              ...composition,
              layers: component.layers,
              dataFields: component.dataFields,
              runtimeCollections: [],
              components: [],
            };
            syncShaderParameterFields(scope, layer);
            resets.push(
              ...syncDesignerBindingDefaults(
                scope,
                layer,
                before,
                Object.keys(patch.parameters ?? {}).map((name) =>
                  shaderParameterTarget(name, target.slot),
                ),
                Object.fromEntries(
                  scope.dataFields.map((field) => [
                    field.id,
                    resolvePreviewFieldValue(field, values[field.id])!,
                  ]),
                ),
              ),
            );
            component.dataFields = scope.dataFields;
          } else {
            syncShaderParameterFields(composition, layer);
            resets.push(
              ...syncDesignerBindingDefaults(
                composition,
                layer,
                before,
                Object.keys(patch.parameters ?? {}).map((name) =>
                  shaderParameterTarget(name, target.slot),
                ),
                Object.fromEntries(
                  composition.dataFields.map((field) => [
                    field.id,
                    resolvePreviewFieldValue(field, values[field.id])!,
                  ]),
                ),
              ),
            );
          }
        });
        useTestDataStore.getState().clearOverrides(resets);
      },

      removeShaderResource: (target) =>
        set((state) => {
          if (isStoredShaderResourceTarget(target)) {
            resolveShaderResource(state.project, target);
            state.project.shaders = state.project.shaders.filter(
              (resource) => resource.id !== target.shaderId,
            );
            return;
          }
          const { composition, component, layer, item } = resolveShaderResource(
            state.project,
            target,
          );
          if (layer.isLocked) throw new Error(`Shader resource object "${layer.name}" is locked.`);
          if (target.tickerBackground) {
            if (layer.element.type !== 'ticker') throw new Error('Expected a ticker.');
            delete layer.element.background;
            return;
          }
          if (item) {
            if (target.slot === 'effect') {
              if (item.effects)
                item.effects.stack = getEffectStack(item.effects).filter(
                  (entry) => entry.id !== target.effectId,
                );
            } else if (target.slot === 'stroke' && item.element.type === 'text')
              delete item.element.strokePaint;
            else if (item.element.type === 'shader')
              item.element = createRectangleElement({ fill: '#3b3f4a' });
            else if (['text', 'image', 'image-sequence', 'lottie'].includes(item.element.type))
              delete (item.element as { fill?: Paint }).fill;
            else if ('fill' in item.element) item.element.fill = '#3b3f4a';
            const prefix = `items.${item.id}.${target.slot === 'effect' ? `effects.${target.effectId}.` : shaderParameterTarget('', target.slot)}`;
            layer.bindings = layer.bindings.filter(
              (binding) => !binding.targetProperty.startsWith(prefix),
            );
            return;
          }
          if (target.slot === 'effect') {
            removeEffect(layer, target.effectId);
            return;
          }
          if (target.slot === 'stroke') {
            if (layer.element.type !== 'text')
              throw new Error('Shader outlines are supported only on text.');
            delete layer.element.strokePaint;
          } else if (layer.element.type === 'shader') {
            // Legacy shader objects become ordinary rectangles; layer identity/animation stay intact.
            layer.element = createRectangleElement({ fill: '#3b3f4a' });
          } else if (
            layer.element.type === 'text' ||
            layer.element.type === 'image' ||
            layer.element.type === 'image-sequence' ||
            layer.element.type === 'chart' ||
            layer.element.type === 'lottie'
          ) {
            delete layer.element.fill;
          } else if ('fill' in layer.element) {
            layer.element.fill = '#3b3f4a';
          } else {
            throw new Error('The selected object cannot use a shader paint.');
          }
          const prefix = shaderParameterTarget('', target.slot);
          for (const tracks of [layer.animationTracks, layer.loop?.tracks]) {
            if (!tracks) continue;
            for (const property of Object.keys(tracks)) {
              if (parseShaderAnimationProperty(property)?.slot === target.slot)
                delete tracks[property as AnimatableLayerProperty];
            }
          }
          layer.bindings = layer.bindings.filter(
            (binding) =>
              !binding.targetProperty.startsWith(prefix) &&
              !(target.slot === 'fill' && binding.targetProperty.startsWith('parameters.')),
          );
          const layers = component?.layers ?? composition.layers;
          const used = new Set(
            layers.flatMap((item) => item.bindings.map((binding) => binding.fieldId)),
          );
          if (!component)
            for (const collection of composition.runtimeCollections) used.add(collection.fieldId);
          const fields = (component?.dataFields ?? composition.dataFields).filter((field) => {
            const owner = field.generatedShaderParameter;
            return (
              !owner ||
              owner.layerId !== layer.id ||
              (owner.paintSlot ?? 'fill') !== target.slot ||
              used.has(field.id)
            );
          });
          if (component) component.dataFields = fields;
          else composition.dataFields = fields;
          if (target.slot === 'fill') pruneInvalidGradientStopTracks(layer);
          // Do not reconcile either source here: removal must work even if GLSL is currently invalid.
        }),

      updateLayerTextStroke: (layerId, frame, patch) =>
        designerEdit(layerId, Object.keys(patch), (_state, composition, layers) => {
          const layer = layers[0]!;
          if (!layer || layer.isLocked || layer.element.type !== 'text') return;
          if (patch.strokeColor !== undefined) {
            layer.element.strokeColor = patch.strokeColor;
            delete layer.element.strokePaint;
          }
          if ('strokePaint' in patch) {
            if (patch.strokePaint) {
              const inspection = inspectShaderElement(patch.strokePaint);
              if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
              layer.element.strokePaint = patch.strokePaint;
            } else delete layer.element.strokePaint;
          }
          syncShaderParameterFields(composition, layer);
          if (patch.strokeWidth === undefined) return;
          const numeric = Number(patch.strokeWidth);
          const strokeWidth = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
          const before = getLayerPropertyValueAtFrame(layer, 'strokeWidth', frame);
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          if (!keyPropertyEdit(layer, 'strokeWidth', roundedFrame, strokeWidth, before)) {
            offsetExistingPropertyKeys(layer, 'strokeWidth', strokeWidth - before);
          }
          layer.element.strokeWidth = strokeWidth;
        }),

      updateLayerPaint: (layerId, frame, paint) =>
        designerEdit(layerId, ['fill', 'color'], (state, composition, layers) => {
          const layer = layers[0]!;
          if (
            !layer ||
            layer.isLocked ||
            (layer.element.type !== 'rectangle' &&
              layer.element.type !== 'ellipse' &&
              layer.element.type !== 'path' &&
              layer.element.type !== 'pattern' &&
              layer.element.type !== 'text' &&
              layer.element.type !== 'image' &&
              layer.element.type !== 'image-sequence' &&
              layer.element.type !== 'chart' &&
              layer.element.type !== 'lottie')
          ) {
            return;
          }
          const element = layer.element;
          if (isMediaPaint(paint)) {
            state.project.supportsRealTime = true;
            state.project.supportsNonRealTime = false;
          }
          if (
            element.type === 'image' ||
            element.type === 'image-sequence' ||
            element.type === 'lottie'
          ) {
            if (paint !== undefined && !isShaderPaint(paint) && !isMediaPaint(paint))
              throw new Error('Media fill must be a shader, media paint, or original pixels.');
            if (isShaderPaint(paint)) {
              const inspection = inspectShaderElement(paint);
              if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
              element.fill = paint;
            } else if (isMediaPaint(paint)) element.fill = normalizeMediaPaint(paint);
            else delete element.fill;
            syncShaderParameterFields(composition, layer);
            return;
          }
          if (element.type === 'chart') {
            // Editing the standard Fill replaces the legacy presentation-only gradient.
            if (element.presentation) delete element.presentation.gradient;
            if (paint === undefined) {
              delete element.fill;
              syncShaderParameterFields(composition, layer);
              pruneInvalidGradientStopTracks(layer);
              return;
            }
          }
          if (paint === undefined) return;
          if (isShaderPaint(paint)) {
            const inspection = inspectShaderElement(paint);
            if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
          }
          if (isMediaPaint(paint)) paint = normalizeMediaPaint(paint);
          if (element.type === 'text') {
            if (typeof paint === 'string') {
              element.color = paint;
              delete element.fill;
            } else element.fill = paint;
            syncShaderParameterFields(composition, layer);
            pruneInvalidGradientStopTracks(layer);
            return;
          }
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const previous = element.fill ?? paint;
          const previousEvaluated = getPaintAtFrame(
            previous,
            getResolvedLayerAnimationTracks(layer),
            roundedFrame,
          );
          if (
            isGradientPaint(paint) &&
            isGradientPaint(previous) &&
            isGradientPaint(previousEvaluated)
          ) {
            element.fill = {
              ...paint,
              stops: paint.stops.map((stop, index) => {
                const before = previousEvaluated.stops[index]?.offset;
                if (before === undefined || Math.abs(stop.offset - before) < 1e-9) return stop;
                const property = `fill.stops[${index}].offset` as const;
                if (keyPropertyEdit(layer, property, roundedFrame, stop.offset, before))
                  return { ...stop, offset: previous.stops[index]?.offset ?? stop.offset };
                offsetExistingPropertyKeys(layer, property, stop.offset - before);
                return stop;
              }),
            };
          } else {
            element.fill = paint;
          }
          syncShaderParameterFields(composition, layer);
          pruneInvalidGradientStopTracks(layer);
        }),

      addLayerEffect: (layerId, type, patch) =>
        set((state) => {
          const layer = getActiveComposition(state.project, state.activeCompositionId).layers.find(
            (l) => l.id === layerId,
          );
          if (layer && !layer.isLocked) addEffect(layer, type, patch);
        }),
      updateLayerEffect: (layerId, effectId, patch, frame) =>
        designerEdit(
          layerId,
          (layer) => {
            const effect = getEffectStack(layer.effects).find((entry) => entry.id === effectId);
            return effect
              ? Object.keys(patch.params ?? {}).map((name) => effectProperty(effect, name))
              : [];
          },
          (_state, composition, layers) => {
            const layer = layers[0]!;
            updateEffectAtFrame(composition, layer, effectId, patch, frame);
          },
        ),
      removeLayerEffect: (layerId, effectId) =>
        set((state) => {
          const layer = getActiveComposition(state.project, state.activeCompositionId).layers.find(
            (l) => l.id === layerId,
          );
          if (layer && !layer.isLocked) removeEffect(layer, effectId);
        }),
      duplicateLayerEffect: (layerId, effectId) =>
        set((state) => {
          const layer = getActiveComposition(state.project, state.activeCompositionId).layers.find(
            (l) => l.id === layerId,
          );
          if (layer && !layer.isLocked) duplicateEffect(layer, effectId);
        }),
      reorderLayerEffects: (layerId, effectIds) =>
        set((state) => {
          const layer = getActiveComposition(state.project, state.activeCompositionId).layers.find(
            (l) => l.id === layerId,
          );
          if (layer && !layer.isLocked) reorderEffects(layer, effectIds);
        }),
      addGroupEffect: (layerIds, type, patch) => {
        const effectId = createId('fx');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId),
            wanted = new Set(layerIds),
            layers = composition.layers.filter((layer) => wanted.has(layer.id));
          if (layers.length !== wanted.size || layers.some((layer) => layer.isLocked)) return;
          for (const layer of layers) addEffect(layer, type, patch, undefined, effectId);
        });
      },
      updateGroupEffect: (layerIds, effectId, patch, frame) =>
        designerEdit(
          layerIds,
          (layer) => {
            const effect = getEffectStack(layer.effects).find((entry) => entry.id === effectId);
            return effect
              ? Object.keys(patch.params ?? {}).map((name) => effectProperty(effect, name))
              : [];
          },
          (_state, composition, layers) => {
            const wanted = new Set(layerIds);
            if (
              layers.length !== wanted.size ||
              layers.some(
                (layer) =>
                  layer.isLocked ||
                  !getEffectStack(layer.effects).some((effect) => effect.id === effectId),
              )
            )
              return false;
            for (const layer of layers)
              updateEffectAtFrame(composition, layer, effectId, patch, frame);
          },
        ),
      removeGroupEffect: (layerIds, effectId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId),
            wanted = new Set(layerIds),
            layers = composition.layers.filter((layer) => wanted.has(layer.id));
          if (
            layers.length !== wanted.size ||
            layers.some(
              (layer) =>
                layer.isLocked ||
                !getEffectStack(layer.effects).some((effect) => effect.id === effectId),
            )
          )
            return;
          for (const layer of layers) removeEffect(layer, effectId);
        }),
      duplicateGroupEffect: (layerIds, effectId) => {
        const duplicateId = createId('fx');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId),
            wanted = new Set(layerIds),
            layers = composition.layers.filter((layer) => wanted.has(layer.id));
          if (
            layers.length !== wanted.size ||
            layers.some(
              (layer) =>
                layer.isLocked ||
                !getEffectStack(layer.effects).some((effect) => effect.id === effectId),
            )
          )
            return;
          for (const layer of layers) duplicateEffect(layer, effectId, duplicateId);
        });
      },
      reorderGroupEffects: (layerIds, effectIds) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId),
            wanted = new Set(layerIds),
            shared = new Set(effectIds),
            layers = composition.layers.filter((layer) => wanted.has(layer.id));
          if (
            layers.length !== wanted.size ||
            layers.some(
              (layer) =>
                layer.isLocked ||
                effectIds.some(
                  (effectId) =>
                    !getEffectStack(layer.effects).some((effect) => effect.id === effectId),
                ),
            )
          )
            return;
          for (const layer of layers) {
            const stack = getEffectStack(layer.effects),
              queue = effectIds.map((id) => stack.find((effect) => effect.id === id)!),
              reordered = stack.map((effect) => (shared.has(effect.id) ? queue.shift()! : effect));
            reorderEffects(
              layer,
              reordered.map((effect) => effect.id),
            );
          }
        }),
      updateLayerEffects: (layerId, frame, patch) =>
        designerEdit(layerId, Object.keys(patch), (_state, composition, layers) => {
          const layer = layers[0]!;
          if (!layer || layer.isLocked) return;
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const normalized = ensureLegacyEffects(
            normalizeLayerEffects({ ...layer.effects, ...patch }),
            patch,
          );
          for (const property of EFFECT_ANIMATION_PROPERTIES) {
            if (patch[property] !== undefined) {
              const before = getLayerPropertyValueAtFrame(layer, property, roundedFrame);
              if (!keyPropertyEdit(layer, property, roundedFrame, normalized[property], before))
                offsetExistingPropertyKeys(layer, property, normalized[property] - before);
            }
          }
          layer.effects = normalized;
        }),

      renameLayer: (layerId, name) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer) layer.name = name;
        }),

      setLayerExportKey: (layerId, input) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer) throw new Error('The layer is no longer in this template.');
          if (layer.isLocked) throw new Error('Unlock the layer before changing its export key.');
          const key = input.trim() || undefined;
          const error = layerExportKeyError(key);
          if (error) throw new Error(error);
          if (key !== undefined) {
            if (
              composition.layers.some(
                (candidate) => candidate.id !== layerId && candidate.exportKey === key,
              )
            )
              throw new Error(`Export key "${key}" is already used in this template.`);
            layer.exportKey = key;
          } else delete layer.exportKey;
        }),

      toggleLayerVisibility: (layerId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer) layer.isVisible = !layer.isVisible;
        }),

      toggleLayerGuide: (layerId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer) {
            layer.isGuide = !layer.isGuide;
            if (layer.isGuide) pruneVisualRuleReferences(composition);
          }
        }),

      setLayerBlendMode: (layerId, blendMode) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer && !layer.isLocked) layer.blendMode = blendMode;
        }),

      toggleLayerLock: (layerId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer) layer.isLocked = !layer.isLocked;
        }),

      groupLayers: (layerIds) => {
        const unique = [...new Set(layerIds)];
        if (unique.length < 2) return null;
        const groupId = createId('group');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          applyModifierSafeGroupChanges(
            composition.layers,
            new Map(unique.map((id) => [id, groupId])),
          );
        });
        return groupId;
      },

      ungroupLayers: (layerIds) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          if (
            composition.runtimeCollections.some((collection) =>
              collection.prototypeLayerIds.some((layerId) => layerIds.includes(layerId)),
            )
          ) {
            return;
          }
          const groupIds = new Set(
            composition.layers
              .filter((layer) => layerIds.includes(layer.id))
              .map((layer) => layer.groupId)
              .filter((groupId): groupId is string => Boolean(groupId)),
          );
          applyModifierSafeGroupChanges(
            composition.layers,
            new Map(
              composition.layers
                .filter((layer) => layer.groupId && groupIds.has(layer.groupId))
                .map((layer) => [layer.id, null]),
            ),
          );
        }),

      createComponent: (layerIds, name) => {
        const snapshot = useProjectStore.getState();
        const composition = getActiveComposition(snapshot.project, snapshot.activeCompositionId);
        if (layerIds.length === 0) return null;
        let definition: ComponentDefinition;
        try {
          definition = buildComponentDefinition(
            composition,
            layerIds,
            name ?? `Component ${composition.components.length + 1}`,
          );
          definition.scope = useProjectSetStore.getState().projectSet ? 'set' : 'local';
        } catch {
          return null;
        }
        set((state) => {
          getActiveComposition(state.project, state.activeCompositionId).components.push(
            definition,
          );
          linkExistingComponentLayers(
            getActiveComposition(state.project, state.activeCompositionId),
            definition,
            layerIds,
          );
        });
        return definition.id;
      },

      instantiateComponent: (componentId, offset = { x: 40, y: 40 }, linked = true) => {
        const snapshot = useProjectStore.getState();
        const composition = getActiveComposition(snapshot.project, snapshot.activeCompositionId);
        const definition = composition.components.find((candidate) => candidate.id === componentId);
        if (!definition) return [];
        let layerIds: string[] = [];
        set((state) => {
          const target = getActiveComposition(state.project, state.activeCompositionId);
          const instance = instantiateComponentDefinition(target, definition, offset, linked);
          target.dataFields.push(...instance.dataFields);
          target.layers.push(...instance.layers);
          layerIds = instance.layers.map((layer) => layer.id);
        });
        return layerIds;
      },

      updateComponentFromLayers: (componentId, layerIds) => {
        const snapshot = useProjectStore.getState();
        const composition = getActiveComposition(snapshot.project, snapshot.activeCompositionId);
        const index = composition.components.findIndex((candidate) => candidate.id === componentId);
        const existing = composition.components[index];
        if (!existing || layerIds.length === 0) return false;
        set((state) => {
          const target = getActiveComposition(state.project, state.activeCompositionId);
          updateComponentDefinitionFromLayers(target, componentId, layerIds);
        });
        return true;
      },

      updateComponentLayer: (componentId, sourceLayerId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const definition = composition.components.find((item) => item.id === componentId);
          const layer = definition?.layers.find((item) => item.id === sourceLayerId);
          if (!definition || !layer) throw new Error('The component source no longer exists.');
          const before = {
            element: structuredClone(
              isDraft(layer.element) ? current(layer.element) : layer.element,
            ),
            effects: structuredClone(
              isDraft(layer.effects) ? current(layer.effects) : layer.effects,
            ),
          };
          const { element, effects, ...rest } = patch;
          Object.assign(layer, structuredClone(rest));
          if (element) {
            if (element.type !== layer.element.type)
              throw new Error('A component source edit must retain the element type.');
            layer.element = structuredClone(element);
          }
          if (effects) layer.effects = normalizeLayerEffects({ ...layer.effects, ...effects });
          const properties = [
            ...[...new Set([...Object.keys(before.element), ...Object.keys(layer.element)])].filter(
              (key) =>
                JSON.stringify((before.element as unknown as Record<string, unknown>)[key]) !==
                JSON.stringify((layer.element as unknown as Record<string, unknown>)[key]),
            ),
            ...Object.keys(effects ?? {}).filter(
              (key) =>
                JSON.stringify((before.effects as unknown as Record<string, unknown>)[key]) !==
                JSON.stringify((layer.effects as unknown as Record<string, unknown>)[key]),
            ),
          ];
          if (effects) {
            const previousEffects = new Map(
              getEffectStack(before.effects).map((effect) => [effect.id, effect]),
            );
            for (const effect of getEffectStack(layer.effects)) {
              const previous = previousEffects.get(effect.id);
              const previousParams = previous ? effectParams(previous, before.effects) : {};
              for (const [parameter, value] of Object.entries(effectParams(effect, layer.effects)))
                if (JSON.stringify(previousParams[parameter]) !== JSON.stringify(value))
                  properties.push(`effects.${effect.id}.${parameter}`);
            }
          }
          const sourceContext = {
            ...composition,
            layers: definition.layers,
            dataFields: definition.dataFields,
          };
          syncShaderParameterFields(sourceContext, layer);
          syncDesignerBindingDefaults(sourceContext, layer, before, properties);
          definition.dataFields = sourceContext.dataFields;
          refreshComponentDependencies(composition, definition);
        }),

      bindComponentClockValue: (componentId, sourceLayerId, fieldId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const definition = composition.components.find((item) => item.id === componentId);
          const source = definition?.layers.find((item) => item.id === sourceLayerId);
          if (!definition || !source || source.element.type !== 'text' || !source.element.clock)
            throw new Error('Clock component source not found.');
          if (fieldId === undefined) {
            const created = createPlayoutBinding(source, definition.dataFields);
            if (!created) return;
            definition.dataFields.push(created.field);
            fieldId = created.field.id;
          } else if (fieldId && !definition.dataFields.some((field) => field.id === fieldId)) {
            throw new Error('The selected component field no longer exists.');
          }
          source.bindings = source.bindings.filter(
            (binding) => binding.targetProperty !== 'clock.manualValue',
          );
          if (fieldId) source.bindings.push({ fieldId, targetProperty: 'clock.manualValue' });
          refreshComponentDependencies(composition, definition);
        }),

      updateComponentField: (componentId, sourceFieldId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const definition = composition.components.find((item) => item.id === componentId);
          const field = definition?.dataFields.find((item) => item.id === sourceFieldId);
          if (!definition || !field) throw new Error('The component parameter no longer exists.');
          if (patch.id !== undefined && patch.id !== field.id)
            throw new Error('A component parameter edit cannot change its identity.');
          if (patch.key !== undefined) {
            const key = patch.key.trim();
            if (
              !key ||
              definition.dataFields.some((item) => item.id !== field.id && item.key === key)
            )
              throw new Error('Use a unique, nonempty component parameter key.');
          }
          Object.assign(field, structuredClone(patch));
          refreshComponentDependencies(composition, definition);
        }),

      resetComponentOverrides: (layerIds, paths) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          resetComponentInstanceOverrides(composition, layerIds, paths);
        }),

      makeComponentInstanceUnique: (instanceId) => {
        let componentId: string | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          componentId = makeUniqueComponentInstance(composition, instanceId).id;
        });
        return componentId;
      },

      refreshLinkedComponentInstances: (componentId) => {
        const snapshot = get();
        const sourceComposition = getActiveComposition(
          snapshot.project,
          snapshot.activeCompositionId,
        );
        const sourceDefinition = sourceComposition.components.find(
          (candidate) => candidate.id === componentId,
        );
        if (!sourceDefinition) return [];
        const definition = structuredClone(sourceDefinition);
        let newLayerIds: string[] = [];
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const refreshed = refreshComponentInstances(composition, definition);
          newLayerIds = refreshed.flatMap((entry) =>
            entry.instance.layers.map((layer) => layer.id),
          );
        });
        return newLayerIds;
      },

      renameComponent: (componentId, name) =>
        set((state) => {
          const definition = getActiveComposition(
            state.project,
            state.activeCompositionId,
          ).components.find((candidate) => candidate.id === componentId);
          const trimmed = name.trim();
          if (definition && trimmed) definition.name = trimmed;
        }),

      removeComponent: (componentId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const session = useProjectSetStore.getState();
          const set = session.projectSet;
          const definition = composition.components.find(
            (candidate) => candidate.id === componentId,
          );
          if (
            composition.layers.some((layer) => layer.componentLink?.componentId === componentId) ||
            (definition?.scope === 'set' &&
              set?.templates.some((template) =>
                (template.id === session.activeTemplateId
                  ? state.project
                  : template.project
                ).compositions.some((scope) =>
                  scope.layers.some((layer) => layer.componentLink?.componentId === componentId),
                ),
              ))
          )
            throw new Error(
              'Remove the component instances or make them unique before deleting their source.',
            );
          for (const scope of definition?.scope === 'set'
            ? state.project.compositions
            : [composition])
            scope.components = scope.components.filter((candidate) => candidate.id !== componentId);
        }),

      createTimelineFolder: (layerIds) => {
        const unique = [...new Set(layerIds)];
        if (unique.length < 2) return null;
        const folderId = createId('timeline-group');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const existingLayerIds = new Set(composition.layers.map((layer) => layer.id));
          const members = unique.filter((layerId) => existingLayerIds.has(layerId));
          if (members.length < 2) return;
          for (const folder of composition.layout.timelineFolders) {
            folder.layerIds = folder.layerIds.filter((layerId) => !members.includes(layerId));
          }
          composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
            (folder) => folder.layerIds.length > 0,
          );
          const index = composition.layout.timelineFolders.length;
          const colors = ['#7c6cff', '#31b7d4', '#f09a3e', '#4fc47a', '#d96bb3', '#d3b84a'];
          composition.layout.timelineFolders.push({
            id: folderId,
            name: `Group ${index + 1}`,
            color: colors[index % colors.length]!,
            layerIds: members,
          });
        });
        return folderId;
      },

      renameTimelineFolder: (folderId, name) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const folder = composition.layout.timelineFolders.find(
            (candidate) => candidate.id === folderId,
          );
          const trimmed = name.trim();
          if (folder && trimmed) folder.name = trimmed;
        }),

      setTimelineFolderColor: (folderId, color) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const folder = composition.layout.timelineFolders.find(
            (candidate) => candidate.id === folderId,
          );
          if (folder && /^#[0-9a-f]{6}$/i.test(color)) folder.color = color;
        }),

      removeTimelineFolder: (folderId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
            (folder) => folder.id !== folderId,
          );
        }),

      setLayerParent: (layerId, parentId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked || parentId === layerId) return;
          if (parentId && !composition.layers.some((candidate) => candidate.id === parentId))
            return;
          if (
            parentId &&
            descendantLayers(composition, layerId).some((item) => item.id === parentId)
          )
            return;
          layer.parentId = parentId;
          const errors = layerModifiersErrors(composition.layers, composition.dataFields);
          if (errors.length) throw new Error(errors.join('\n'));
        }, true),

      setLayerClipChildren: (layerId, clipChildren) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer) layer.clipChildren = clipChildren;
        }),
      setLayerCrops: (crops) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layers = composition.layers.filter((layer) => Object.hasOwn(crops, layer.id));
          if (layers.some((layer) => layer.isLocked))
            throw new Error('Unlock the selected layers before cropping.');
          for (const layer of layers) {
            const crop = crops[layer.id];
            if (crop) {
              const errors = layerCropErrors(crop);
              if (errors.length) throw new Error(errors.join(' '));
              layer.crop = structuredClone(crop);
            } else delete layer.crop;
          }
        }),
      setLayerMask: (layerId, mask, hideSource = true) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          layer.mask = mask;
          const errors = layerMaskErrors(composition);
          if (errors.length) throw new Error(errors.join(' '));
          if (mask && hideSource) {
            const source = composition.layers.find(
              (candidate) => candidate.id === mask.sourceLayerId,
            )!;
            if (source.isLocked) throw new Error(`Unlock mask source "${source.name}" first.`);
            source.isMaskOnly = true;
          }
        }),
      setLayerMaskOnly: (layerId, value) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer && !layer.isLocked) layer.isMaskOnly = value;
        }),

      setLayerConstraints: (layerId, constraints) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer) Object.assign(layer.constraints, constraints);
        }),

      setLayerAutoLayout: (layerId, layout) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          layer.autoLayout ??= structuredClone(DEFAULT_LAYER_AUTO_LAYOUT);
          Object.assign(layer.autoLayout, layout);
          layer.autoLayout.gap = Math.max(0, Math.round(layer.autoLayout.gap));
          for (const key of [
            'paddingTop',
            'paddingRight',
            'paddingBottom',
            'paddingLeft',
          ] as const) {
            layer.autoLayout[key] = Math.max(0, Math.round(layer.autoLayout[key]));
          }
          layer.autoLayout.minWidth = Math.max(0, Math.round(layer.autoLayout.minWidth));
          layer.autoLayout.maxWidth = Math.max(0, Math.round(layer.autoLayout.maxWidth));
          const errors = layerModifiersErrors(composition.layers, composition.dataFields);
          if (errors.length) throw new Error(errors.join('\n'));
        }, true),

      setLayerUpdateTransition: (layerId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          layer.updateTransition ??= { style: 'inherit', durationFrames: 0, distance: 24 };
          Object.assign(layer.updateTransition, patch);
          layer.updateTransition.durationFrames = Math.max(
            0,
            Math.round(layer.updateTransition.durationFrames),
          );
          layer.updateTransition.distance = Math.max(0, layer.updateTransition.distance);
        }),

      setLayerMotionBlur: (layerId, value) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((item) => item.id === layerId);
          if (!layer || layer.isLocked) return;
          if (
            !Number.isFinite(value.shutterAngle) ||
            value.shutterAngle < 0 ||
            value.shutterAngle > 360
          )
            throw new Error('Shutter angle must be between 0 and 360 degrees.');
          layer.motionBlur = { enabled: !!value.enabled, shutterAngle: value.shutterAngle };
        }),

      setLayerMotionPath: (layerId, link) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked || link?.sourceLayerId === layerId) return;
          if (
            link &&
            !composition.layers.some(
              (candidate) =>
                candidate.id === link.sourceLayerId && candidate.element.type === 'path',
            )
          )
            return;
          if (
            link &&
            (!Number.isFinite(link.progress) ||
              link.progress < 0 ||
              link.progress > 1 ||
              typeof link.orientToPath !== 'boolean' ||
              !Number.isFinite(link.offsetX) ||
              !Number.isFinite(link.offsetY) ||
              (link.rotationOffset !== undefined &&
                (!Number.isFinite(link.rotationOffset) || Math.abs(link.rotationOffset) > 360)))
          )
            throw new Error('Enter valid Spline Path progress, offsets and orientation settings.');
          layer.motionPath = link ? structuredClone(link) : null;
          const errors = layerModifiersErrors(composition.layers, composition.dataFields);
          if (errors.length) throw new Error(errors.join('\n'));
        }, true),

      setLayerTextPath: (layerId, link) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          if (link) {
            const errors = textPathReferenceErrors(layer, link, composition.layers);
            if (layer.element.type === 'text')
              errors.push(...textPathCompatibilityErrors(layer.element));
            if (errors.length) throw new Error(errors.join('\n'));
          }
          layer.textPath = link ? structuredClone(link) : null;
        }, true),

      addClockTimerAlarm: (layerId) => {
        let id: string | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (
            !layer ||
            layer.isLocked ||
            layer.isGuide ||
            layer.element.type !== 'text' ||
            !layer.element.clock
          )
            return;
          const rule = createLayerVisualRule({
            name: nextVisualRuleName(composition),
            trigger: 'timer-alarm',
            timerAlarm: nextTimerAlarm(composition.layers, layer.id, layer.element.clock),
            actions: [],
          });
          (layer.visualRules ??= []).push(rule);
          id = rule.id;
        });
        return id;
      },

      addLayerVisualRule: (layerId, trigger = 'data') => {
        let id: string | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const alarmSource =
            trigger === 'timer-alarm'
              ? layer.element.type === 'text' && layer.element.clock
                ? layer
                : composition.layers.find(
                    (candidate) =>
                      !candidate.isGuide &&
                      candidate.element.type === 'text' &&
                      candidate.element.clock,
                  )
              : null;
          if (trigger === 'timer-alarm' && !alarmSource) return;
          const createdField = trigger === 'data' && composition.dataFields.length === 0;
          const field =
            trigger === 'data'
              ? (composition.dataFields[0] ?? createRuleConditionField(composition, layer))
              : null;
          const rule = createLayerVisualRule({
            name: nextVisualRuleName(composition),
            trigger,
            fieldId: field?.id ?? '',
            ...(alarmSource?.element.type === 'text' && alarmSource.element.clock
              ? {
                  timerAlarm: nextTimerAlarm(
                    composition.layers,
                    alarmSource.id,
                    alarmSource.element.clock,
                  ),
                  actions: [],
                }
              : {}),
            ...(createdField ? { operator: 'not-empty' as const } : {}),
          });
          layer.visualRules ??= [];
          layer.visualRules.push(rule);
          id = rule.id;
        });
        return id;
      },

      updateLayerVisualRule: (layerId, ruleId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          const rule = layer?.visualRules?.find((candidate) => candidate.id === ruleId);
          if (!layer || layer.isLocked || !rule) return;
          Object.assign(rule, structuredClone(patch));
          if (
            rule.trigger === 'data' &&
            !isVisualRuleMouseFieldId(rule.fieldId) &&
            !composition.dataFields.some((field) => field.id === rule.fieldId)
          ) {
            const createdField = composition.dataFields.length === 0;
            rule.fieldId = (
              composition.dataFields[0] ?? createRuleConditionField(composition, layer)
            ).id;
            if (createdField) rule.operator = 'not-empty';
          }
        }),

      retargetLayerVisualRule: (sourceLayerId, ruleId, targetLayerId, hostGroupId) => {
        let retargeted = false;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const source = composition.layers.find((layer) => layer.id === sourceLayerId);
          const target = composition.layers.find((layer) => layer.id === targetLayerId);
          if (
            !source ||
            !target ||
            source.isLocked ||
            target.isLocked ||
            source.isGuide ||
            target.isGuide
          )
            return;
          if (hostGroupId && target.groupId !== hostGroupId) return;
          const index = (source.visualRules ?? []).findIndex((rule) => rule.id === ruleId);
          if (index < 0) return;
          retargeted = true;
          // Explicit action targets remain unchanged; implicit "this object" actions follow the owner.
          const rule = structuredClone(current(source.visualRules[index]!));
          if (hostGroupId) rule.hostGroupId = hostGroupId;
          else delete rule.hostGroupId;
          if (source === target) {
            source.visualRules[index] = rule;
            return;
          }
          source.visualRules.splice(index, 1);
          (target.visualRules ??= []).push(rule);
        });
        return retargeted;
      },

      moveLayerVisualRule: (layerId, ruleId, direction) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const index = (layer.visualRules ?? []).findIndex((rule) => rule.id === ruleId);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= layer.visualRules.length) return;
          const [rule] = layer.visualRules.splice(index, 1);
          layer.visualRules.splice(target, 0, rule!);
        }),

      duplicateLayerVisualRule: (layerId, ruleId) => {
        let duplicatedId: string | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const index = (layer.visualRules ?? []).findIndex((rule) => rule.id === ruleId);
          const source = layer.visualRules[index];
          if (!source) return;
          duplicatedId = createId('visual-rule');
          layer.visualRules.splice(index + 1, 0, {
            ...structuredClone(current(source)),
            id: duplicatedId,
            name: nextVisualRuleName(composition, source.name),
          });
        });
        return duplicatedId;
      },

      applyLayerAnimationPreset: (layerIds, reference, presetId, side, options) => {
        const referenceErrors = validateRendererPluginReference(reference);
        if (referenceErrors.length) throw new Error(referenceErrors.join(' '));
        const entry = useRendererPluginSettingsStore
          .getState()
          .installed.find(
            (item) =>
              item.enabled &&
              item.trusted &&
              isAnimationPresetPluginSnapshot(item.snapshot) &&
              rendererPluginKey(studioPluginReference(item.snapshot)) ===
                rendererPluginKey(reference),
          );
        if (!entry || !isAnimationPresetPluginSnapshot(entry.snapshot))
          throw new Error(
            'Install, review and enable this exact animation preset pack in Plugins first.',
          );
        assertStudioPluginsAllowed([entry.snapshot]);
        const snapshot = structuredClone(entry.snapshot);
        const request = structuredClone(options);
        const ids = new Set(typeof layerIds === 'string' ? [layerIds] : layerIds);
        if (!ids.size)
          throw new Error('Select an unlocked object before applying an animation preset.');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const selected = composition.layers.filter((layer) => ids.has(layer.id));
          if (selected.length !== ids.size)
            throw new Error('A selected animation target no longer exists.');
          const layers = selected.filter((layer) => !layer.isLocked);
          if (!layers.length)
            throw new Error('Select an unlocked object before applying an animation preset.');
          const prepared = layers.map((layer) => structuredClone(current(layer)));
          const scope: Composition = {
            ...current(composition),
            layers: prepared,
            animationPresetPlugins: [
              ...(composition.animationPresetPlugins
                ? current(composition.animationPresetPlugins)
                : []),
            ],
          };
          // Every target is prepared before publishing anything, so incompatible group members,
          // parameter/frame errors or pinning limits cannot leave a partially animated selection.
          for (const layer of prepared)
            applyAnimationPreset(scope, layer, snapshot, presetId, side, request);
          layers.forEach((layer, index) => {
            const next = prepared[index]!;
            layer.animationTracks = next.animationTracks;
            layer.keyframes = next.keyframes;
            layer.animationPresets = next.animationPresets;
            layer.motion = next.motion;
          });
          composition.animationPresetPlugins = scope.animationPresetPlugins;
        });
      },

      applyChartMarkPreset: (layerId, reference, presetId, side, options) => {
        const referenceErrors = validateRendererPluginReference(reference);
        if (referenceErrors.length) throw new Error(referenceErrors.join(' '));
        const key = rendererPluginKey(reference);
        const installed = useRendererPluginSettingsStore
          .getState()
          .installed.find(
            (entry) =>
              entry.enabled &&
              entry.trusted &&
              isAnimationPresetPluginSnapshot(entry.snapshot) &&
              rendererPluginKey(studioPluginReference(entry.snapshot)) === key,
          );
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((entry) => entry.id === layerId);
          if (!layer || layer.element.type !== 'chart' || layer.isLocked)
            throw new Error('Select an unlocked chart before applying a mark animation.');
          const retained = composition.animationPresetPlugins?.find(
            (snapshot) => rendererPluginKey(studioPluginReference(snapshot)) === key,
          );
          const snapshot = installed?.snapshot ?? (retained ? current(retained) : undefined);
          if (!snapshot || !isAnimationPresetPluginSnapshot(snapshot))
            throw new Error(
              'Install and enable the exact animation pack, or use one retained in this template.',
            );
          const prepared = structuredClone(current(layer));
          const scope: Composition = {
            ...current(composition),
            layers: [prepared],
            animationPresetPlugins: structuredClone(
              composition.animationPresetPlugins ? current(composition.animationPresetPlugins) : [],
            ),
          };
          applyChartMarkAnimationPreset(
            scope,
            prepared,
            snapshot,
            presetId,
            side,
            structuredClone(options),
          );
          if (prepared.element.type !== 'chart') throw new Error('Chart target changed.');
          const provider = composition.rendererPlugins?.find(
            (entry) =>
              prepared.element.type === 'chart' &&
              prepared.element.provider &&
              rendererPluginKey({ ...entry.manifest, sha256: entry.sha256 }) ===
                rendererPluginKey(prepared.element.provider),
          );
          if (!provider)
            throw new Error('Choose a chart renderer supporting mark animations first.');
          const errors = chartRendererFeatureErrors(prepared.element, provider.manifest);
          if (errors.length) throw new Error(errors.join(' '));
          layer.element = prepared.element;
          composition.animationPresetPlugins = scope.animationPresetPlugins;
        });
      },

      clearChartMarkPreset: (layerId, side) =>
        set((state) => {
          if (side !== 'in' && side !== 'out')
            throw new Error('Mark animation side must be In or Out.');
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((entry) => entry.id === layerId);
          if (!layer || layer.element.type !== 'chart' || layer.isLocked)
            throw new Error('Select an unlocked chart before clearing its mark animation.');
          if (!layer.element.markAnimations) return;
          delete layer.element.markAnimations[side];
          if (!layer.element.markAnimations.in && !layer.element.markAnimations.out)
            delete layer.element.markAnimations;
        }),

      setLayerMotion: (layerIds, side, spec, stagger) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const ids = new Set(Array.isArray(layerIds) ? layerIds : [layerIds]);
          const layers = composition.layers.filter((layer) => ids.has(layer.id) && !layer.isLocked);
          const offsets =
            spec && stagger ? layerMotionStaggerOffsets(composition, layers, side, stagger) : null;
          // A stagger needs room in the span: shorten the motion rather than collapse the cascade.
          const windows = layerMotionWindows(composition);
          const available = windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0;
          const spread = Math.max(0, ...(offsets?.values() ?? []));
          const durationFrames =
            spec && offsets
              ? Math.max(1, Math.min(spec.durationFrames, available - spread))
              : spec?.durationFrames;
          for (const layer of layers)
            applyLayerMotion(
              composition,
              layer,
              side,
              spec && offsets
                ? {
                    ...spec,
                    durationFrames: durationFrames!,
                    offsetFrames: offsets.get(layer.id) ?? 0,
                  }
                : spec,
            );
        }),

      replaceLayerVisualRule: (layerId, ruleId, next) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          const index = layer?.visualRules?.findIndex((candidate) => candidate.id === ruleId) ?? -1;
          if (!layer || layer.isLocked || index < 0) return;
          const rule = { ...structuredClone(next), id: ruleId };
          if (
            (rule.trigger ?? 'data') === 'data' &&
            !isVisualRuleMouseFieldId(rule.fieldId) &&
            !composition.dataFields.some((field) => field.id === rule.fieldId)
          ) {
            const createdField = composition.dataFields.length === 0;
            rule.fieldId = (
              composition.dataFields[0] ?? createRuleConditionField(composition, layer)
            ).id;
            if (createdField) rule.operator = 'not-empty';
          }
          layer.visualRules[index] = rule;
        }),

      removeLayerVisualRule: (layerId, ruleId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          layer.visualRules = (layer.visualRules ?? []).filter((rule) => rule.id !== ruleId);
        }),

      addDataConnection: () => {
        const id = createId('data-connection');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.dataConnections ??= [];
          if (composition.dataConnections.length >= MAX_DATA_CONNECTIONS)
            throw new Error(
              `A composition supports at most ${MAX_DATA_CONNECTIONS} data connections.`,
            );
          composition.dataConnections.push(
            normalizeDataConnection({
              id,
              name: `Data connection ${composition.dataConnections.length + 1}`,
              format: 'json',
              source: 'url',
              url: '',
              embeddedText: '',
              refreshMs: 0,
              missing: 'default',
              enabled: true,
              mappings: composition.dataFields.map((field) => ({
                fieldId: field.id,
                sourcePath: field.key,
              })),
            }),
          );
        });
        return id;
      },

      updateDataConnection: (connectionId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const connection = (composition.dataConnections ?? []).find(
            (candidate) => candidate.id === connectionId,
          );
          if (!connection) return;
          Object.assign(connection, structuredClone(patch));
          connection.refreshMs = Number.isFinite(connection.refreshMs)
            ? Math.min(86400000, Math.max(0, Math.round(connection.refreshMs)))
            : 0;
        }),

      removeDataConnection: (connectionId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.dataConnections = (composition.dataConnections ?? []).filter(
            (connection) => connection.id !== connectionId,
          );
        }),

      setLayerSemantics: (layerId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          if (patch.role !== undefined) layer.semantics.role = patch.role;
          if (patch.description !== undefined) layer.semantics.description = patch.description;
          if (patch.tags !== undefined) {
            layer.semantics.tags = [
              ...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean)),
            ];
          }
        }),

      setDesignSystemName: (name) =>
        set((state) => {
          const trimmed = name.trim();
          if (trimmed) {
            getActiveComposition(state.project, state.activeCompositionId).designSystem.name =
              trimmed;
          }
        }),

      applyStylePack: (stylePack) => {
        let result!: AppliedStylePack;
        set((state) => {
          result = applyStylePack(
            getActiveComposition(state.project, state.activeCompositionId),
            stylePack,
          );
        });
        return result;
      },
      removeStylePack: () =>
        set((state) => {
          removeStylePack(getActiveComposition(state.project, state.activeCompositionId));
        }),

      addDesignToken: (type = 'color') => {
        const tokenId = createId('design-token');
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const index = composition.designSystem.tokens.length + 1;
          composition.designSystem.tokens.push({
            id: tokenId,
            key: `token_${index}`,
            name: `Token ${index}`,
            type,
            value:
              type === 'number' || type === 'font-weight'
                ? type === 'font-weight'
                  ? 700
                  : 16
                : type === 'color'
                  ? '#ffffff'
                  : type === 'font-family'
                    ? 'Arial'
                    : '',
            description: '',
          });
        });
        return tokenId;
      },

      updateDesignToken: (tokenId, patch) => {
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const token = composition.designSystem.tokens.find(
            (candidate) => candidate.id === tokenId,
          );
          if (!token) return;
          const next = { ...token, ...patch };
          next.key = next.key.trim();
          next.name = next.name.trim() || next.key;
          next.description = next.description.trim();
          next.value = normalizeDesignTokenValue(next.type, next.value);
          Object.assign(token, next);
          syncDesignToken(composition, token.id);
          if (
            useProjectSetStore
              .getState()
              .projectSet?.brandKit?.tokens.some((item) => item.id === tokenId)
          ) {
            for (const other of state.project.compositions) {
              if (other.id === composition.id) continue;
              const linked = other.designSystem.tokens.find((item) => item.id === tokenId);
              if (linked) {
                linked.value = next.value;
                syncDesignToken(other, tokenId);
              }
            }
          }
        });
        const session = useProjectSetStore.getState();
        if (
          patch.value !== undefined &&
          session.projectSet?.brandKit?.tokens.some((item) => item.id === tokenId)
        ) {
          session.setProjectSet({
            ...session.projectSet,
            templates: session.projectSet.templates.map((template) =>
              template.id === session.activeTemplateId
                ? {
                    ...template,
                    brandKitOverrides: [
                      ...new Set([...(template.brandKitOverrides ?? []), tokenId]),
                    ],
                  }
                : template,
            ),
          });
        }
      },

      removeDesignToken: (tokenId) =>
        set((state) => {
          if (
            useProjectSetStore
              .getState()
              .projectSet?.brandKit?.tokens.some((token) => token.id === tokenId)
          )
            return;
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          if (
            stylePackColorUsesToken(composition, tokenId) ||
            composition.dataFields.some((field) => field.defaultTokenId === tokenId) ||
            composition.layers.some((layer) =>
              layer.designTokenBindings.some((binding) => binding.tokenId === tokenId),
            )
          )
            return;
          composition.designSystem.tokens = composition.designSystem.tokens.filter(
            (token) => token.id !== tokenId,
          );
        }),

      bindDesignToken: (layerId, tokenId, targetProperty) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          const token = composition.designSystem.tokens.find(
            (candidate) => candidate.id === tokenId,
          );
          if (!layer || !token || layer.isLocked) return;
          const binding = { tokenId, targetProperty };
          markTypographyOverrides(layer, [targetProperty]);
          applyDesignTokenBinding(layer, binding, token);
          layer.designTokenBindings = [
            ...layer.designTokenBindings.filter(
              (candidate) => candidate.targetProperty !== targetProperty,
            ),
            binding,
          ];
        }),

      unbindDesignToken: (layerId, targetProperty) =>
        set((state) => {
          const layer = getActiveComposition(state.project, state.activeCompositionId).layers.find(
            (candidate) => candidate.id === layerId,
          );
          if (!layer || layer.isLocked) return;
          layer.designTokenBindings = layer.designTokenBindings.filter(
            (binding) => binding.targetProperty !== targetProperty,
          );
        }),

      alignLayers: (layerIds, frame, mode) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const items = composition.layers
            .filter((layer) => layerIds.includes(layer.id) && !layer.isLocked)
            .map((layer) => ({ id: layer.id, pose: getLayerTransformAtFrame(layer, frame) }));
          for (const [layerId, patch] of alignedPatches(items, mode)) {
            const layer = composition.layers.find((candidate) => candidate.id === layerId);
            if (layer) {
              writeUiLayerTransform(composition, layer, frame, patch);
            }
          }
        }),

      distributeLayers: (layerIds, frame, mode) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const items = composition.layers
            .filter((layer) => layerIds.includes(layer.id) && !layer.isLocked)
            .map((layer) => ({ id: layer.id, pose: getLayerTransformAtFrame(layer, frame) }));
          for (const [layerId, patch] of distributedPatches(items, mode)) {
            const layer = composition.layers.find((candidate) => candidate.id === layerId);
            if (layer) {
              writeUiLayerTransform(composition, layer, frame, patch);
            }
          }
        }),

      reorderLayers: (orderedLayerIds) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const byId = new Map(composition.layers.map((l) => [l.id, l]));
          const reordered = orderedLayerIds
            .map((id) => byId.get(id))
            .filter((l) => l !== undefined);
          if (reordered.length === composition.layers.length) {
            composition.layers = reordered;
          }
        }),

      setActiveKeyframe: (keyframeId) =>
        set((state) => {
          state.activeKeyframeId = keyframeId;
        }),

      addKeyframe: () => {
        let newKeyframe!: ReturnType<typeof createKeyframe>;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const stepNumber =
            composition.keyframes.filter((keyframe) => keyframe.role === 'step').length + 1;
          newKeyframe = createKeyframe({ name: `Step ${stepNumber}`, role: 'step' });
          const endIndex = composition.keyframes.findIndex((keyframe) => keyframe.role === 'end');
          const insertionIndex = endIndex >= 0 ? endIndex : composition.keyframes.length;
          const previousKeyframe = composition.keyframes[insertionIndex - 1];
          const nextKeyframe = composition.keyframes[insertionIndex];
          const replacedTransition =
            previousKeyframe && nextKeyframe
              ? composition.transitions.find(
                  (transition) =>
                    transition.fromKeyframeId === previousKeyframe.id &&
                    transition.toKeyframeId === nextKeyframe.id,
                )
              : undefined;
          composition.keyframes.splice(insertionIndex, 0, newKeyframe);
          if (replacedTransition) {
            composition.transitions = composition.transitions.filter(
              (transition) => transition.id !== replacedTransition.id,
            );
          }
          if (previousKeyframe) {
            composition.transitions.push(
              replacedTransition
                ? createTransition(previousKeyframe.id, newKeyframe.id, {
                    durationFrames: replacedTransition.durationFrames,
                    easing: replacedTransition.easing,
                  })
                : createTransition(previousKeyframe.id, newKeyframe.id),
            );
          }
          if (nextKeyframe) {
            composition.transitions.push(createTransition(newKeyframe.id, nextKeyframe.id));
          }
          state.activeKeyframeId = newKeyframe.id;
        });
        return newKeyframe.id;
      },

      removeKeyframe: (keyframeId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const index = composition.keyframes.findIndex((keyframe) => keyframe.id === keyframeId);
          const keyframe = composition.keyframes[index];
          if (!keyframe || keyframe.role !== 'step') return;
          const previousKeyframe = composition.keyframes[index - 1];
          const nextKeyframe = composition.keyframes[index + 1];
          const inbound = composition.transitions.find(
            (transition) => transition.toKeyframeId === keyframeId,
          );
          const outbound = composition.transitions.find(
            (transition) => transition.fromKeyframeId === keyframeId,
          );
          composition.keyframes.splice(index, 1);
          composition.transitions = composition.transitions.filter(
            (t) => t.fromKeyframeId !== keyframeId && t.toKeyframeId !== keyframeId,
          );
          pruneVisualRuleReferences(composition);
          if (previousKeyframe && nextKeyframe) {
            composition.transitions.push(
              createTransition(previousKeyframe.id, nextKeyframe.id, {
                durationFrames: (inbound?.durationFrames ?? 0) + (outbound?.durationFrames ?? 0),
                easing: outbound?.easing ?? inbound?.easing ?? 'linear',
              }),
            );
          }
          if (state.activeKeyframeId === keyframeId) {
            state.activeKeyframeId =
              nextKeyframe?.role === 'step'
                ? nextKeyframe.id
                : previousKeyframe?.role === 'step'
                  ? previousKeyframe.id
                  : getDefaultAuthoringKeyframeId(composition);
          }
        }),

      renameKeyframe: (keyframeId, name) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const keyframe = composition.keyframes.find((k) => k.id === keyframeId);
          if (keyframe) keyframe.name = name;
        }),

      updateTransition: (transitionId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const transition = composition.transitions.find((t) => t.id === transitionId);
          if (transition) Object.assign(transition, patch);
        }),

      moveLifecycleKeyframe: (keyframeId, targetFrame) => {
        let result: LifecycleRetimePlan | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const plan = planLifecycleRetime(composition, keyframeId, targetFrame);
          if (!plan) return;
          result = plan;
          if (plan.targetFrame === plan.currentFrame) return;
          for (const update of plan.transitionUpdates) {
            const transition = composition.transitions.find(
              (candidate) => candidate.id === update.transitionId,
            );
            if (transition) transition.durationFrames = update.durationFrames;
          }
        });
        return result;
      },

      retimeAnimationPhase: (phase, targetFrames) => {
        let result!: AnimationRetimeResult;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          result = retimeAnimationPhaseModel(composition, phase, targetFrames);
        });
        return result;
      },

      addDataField: (type) => {
        let newField!: ReturnType<typeof createFieldDefinition>;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const key = generateUniqueKey(
            composition.dataFields.map((f) => f.key),
            'field',
          );
          newField = createFieldDefinition(type, { key, label: key });
          composition.dataFields.push(newField);
        });
        return newField.id;
      },

      setLogicFunctions: (functions, compositionId) =>
        set((state) => {
          const composition = compositionId
            ? state.project.compositions.find((candidate) => candidate.id === compositionId)
            : getActiveComposition(state.project, state.activeCompositionId);
          if (!composition) throw new Error('Composition not found.');
          const errors = validateLogicFunctionDefinitions(functions, composition);
          if (errors.length) throw new Error(errors.join('\n'));
          if (functions.length) composition.functions = structuredClone(functions);
          else delete composition.functions;
          enforceMediaRuntimeProfile(state.project);
        }),

      removeDataField: (fieldId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          assertLogicFunctionReferenceRemovable(composition, 'field', fieldId);
          if (composition.layers.some((layer) => layer.loop?.timing?.holdFieldId === fieldId))
            throw new Error('Unlink loop hold timing before deleting its data field.');
          if (
            composition.dataFields.find((field) => field.id === fieldId)?.generatedShaderParameter
          )
            return;
          if (composition.layers.some((layer) => layerModifierFieldIds(layer).includes(fieldId)))
            throw new Error(
              'Retarget or remove Hide on Empty modifiers before deleting their data field.',
            );
          composition.dataFields = composition.dataFields.filter((f) => f.id !== fieldId);
          for (const connection of composition.dataConnections ?? [])
            connection.mappings = connection.mappings.filter(
              (mapping) => mapping.fieldId !== fieldId,
            );
          composition.runtimeCollections = composition.runtimeCollections.filter(
            (collection) => collection.fieldId !== fieldId,
          );
          for (const layer of composition.layers) {
            layer.bindings = layer.bindings.filter((binding) => binding.fieldId !== fieldId);
          }
          pruneVisualRuleReferences(composition);
        }),

      updateDataField: (fieldId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const field = composition.dataFields.find((f) => f.id === fieldId);
          if (!field) return;
          const nextPatch = { ...patch };
          if (nextPatch.key !== undefined) {
            const trimmed = nextPatch.key.trim();
            const isDuplicate =
              trimmed.length === 0 ||
              composition.dataFields.some((f) => f.id !== fieldId && f.key === trimmed);
            if (isDuplicate) delete nextPatch.key;
            else nextPatch.key = trimmed;
          }
          Object.assign(field, nextPatch);
          // Choosing a native field type clears a previous engine-specific identity.
          if (
            ('type' in nextPatch || 'nodosType' in nextPatch) &&
            nextPatch.nodosType === undefined
          )
            delete field.nodosType;
          if (nextPatch.defaultTokenId !== undefined)
            bindFieldDefaultToken(composition, field, nextPatch.defaultTokenId);
          else if (nextPatch.defaultValue !== undefined || nextPatch.type !== undefined)
            delete field.defaultTokenId;
          if (nextPatch.type !== undefined && nextPatch.type !== 'array') {
            composition.runtimeCollections = composition.runtimeCollections.filter(
              (collection) => collection.fieldId !== field.id,
            );
          }
          const collection = composition.runtimeCollections.find(
            (candidate) => candidate.fieldId === field.id,
          );
          const maxItems = nextPatch.constraints?.maxItems;
          if (
            collection &&
            maxItems !== undefined &&
            Number.isInteger(maxItems) &&
            maxItems >= 1 &&
            maxItems <= 100
          ) {
            collection.capacity = maxItems;
          }
          if (field.generatedShaderParameter) syncCompositionShaderParameterFields(composition);
        }),

      setDataFieldsExposure: (fieldIds, exposed) => {
        const selected = new Set(fieldIds);
        if (!selected.size) return;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const apply = (field: FieldDefinition) => {
            if ((field.exposeToOgraf !== false) !== exposed) field.exposeToOgraf = exposed;
            for (const property of field.properties) apply(property);
            if (field.items) apply(field.items);
          };
          for (const field of composition.dataFields) if (selected.has(field.id)) apply(field);
        });
      },

      setNodosInputFields: (fieldIds) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const selected = new Set(fieldIds);
          composition.nodosInputFieldIds = composition.dataFields
            .filter((field) => selected.has(field.id))
            .map((field) => field.id);
        }),

      setLayerBindings: (layerId, bindings) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer && !layer.isLocked) {
            layer.bindings = bindings;
            syncShaderParameterFields(composition, layer);
          }
        }),

      setLayerPlayoutEditable: (layerId, editable) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          const property = layer ? playoutProperty(layer) : null;
          if (!layer || layer.isLocked || !property) return;
          const bound = layer.bindings.filter(
            (binding) => binding.targetProperty === property.value,
          );
          if (editable) {
            if (bound.length > 0) return;
            const created = createPlayoutBinding(layer, composition.dataFields);
            if (!created) return;
            composition.dataFields.push(created.field);
            layer.bindings.push(created.binding);
            return;
          }
          layer.bindings = layer.bindings.filter(
            (binding) => binding.targetProperty !== property.value,
          );
          // A field nothing else reads goes with the switch, so toggling doesn't pile up fields.
          for (const { fieldId } of bound) {
            const stillUsed =
              composition.layers.some(
                (candidate) =>
                  candidate.bindings.some((binding) => binding.fieldId === fieldId) ||
                  (candidate.visualRules ?? []).some((rule) =>
                    visualRuleFieldIds(rule).includes(fieldId),
                  ),
              ) || composition.runtimeCollections.some((item) => item.fieldId === fieldId);
            const field = composition.dataFields.find((candidate) => candidate.id === fieldId);
            if (!stillUsed && field && !field.generatedShaderParameter)
              composition.dataFields = composition.dataFields.filter(
                (candidate) => candidate.id !== fieldId,
              );
          }
        }),

      addLayerBinding: (layerId) => {
        let fieldId: string | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const created = createNextBinding(
            layer,
            composition.dataFields,
            useTimelineStore.getState().currentFrame,
          );
          if (!created) return;
          composition.dataFields.push(created.field);
          layer.bindings.push(created.binding);
          syncShaderParameterFields(composition, layer);
          fieldId = created.field.id;
        });
        return fieldId;
      },

      addRuntimeCollection: (fieldId, prototypeLayerIds, offsetPerItem, capacity) => {
        let id = '';
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const field = composition.dataFields.find((candidate) => candidate.id === fieldId);
          if (!field || field.type !== 'array' || field.items?.type !== 'object') return;
          if (composition.runtimeCollections.some((collection) => collection.fieldId === fieldId)) {
            return;
          }
          const normalizedCapacity = Math.max(1, Math.min(100, Math.round(capacity)));
          id = createId('runtime-collection');
          field.constraints = { ...field.constraints, maxItems: normalizedCapacity };
          composition.runtimeCollections.push({
            id,
            name: field.label || field.key,
            fieldId,
            prototypeLayerIds: [...new Set(prototypeLayerIds)],
            offsetPerItem: { ...offsetPerItem },
            capacity: normalizedCapacity,
            overflow: 'truncate',
            itemKeyPath: [],
            sortPath: [],
            sortDirection: 'none',
            pageSize: 0,
            page: 0,
          });
        });
        return id;
      },

      updateRuntimeCollection: (collectionId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const collection = composition.runtimeCollections.find(
            (candidate) => candidate.id === collectionId,
          );
          if (!collection) return;
          Object.assign(collection, patch);
          collection.capacity = Math.max(1, Math.min(100, Math.round(collection.capacity)));
          collection.prototypeLayerIds = [...new Set(collection.prototypeLayerIds)];
          collection.pageSize = Math.max(
            0,
            Math.min(collection.capacity, Math.round(collection.pageSize ?? 0)),
          );
          collection.page = Math.max(0, Math.round(collection.page ?? 0));
          const field = composition.dataFields.find(
            (candidate) => candidate.id === collection.fieldId,
          );
          if (field) field.constraints = { ...field.constraints, maxItems: collection.capacity };
        }),

      removeRuntimeCollection: (collectionId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.runtimeCollections = composition.runtimeCollections.filter(
            (collection) => collection.id !== collectionId,
          );
        }),

      addCustomAction: () => {
        let newAction!: ReturnType<typeof createCustomActionDefinition>;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const actionId = generateUniqueKey(
            composition.customActions.map((a) => a.actionId),
            'action',
          );
          newAction = createCustomActionDefinition({ actionId, name: actionId });
          composition.customActions.push(newAction);
        });
        return newAction.id;
      },

      removeCustomAction: (actionDefId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const removed = composition.customActions.find((action) => action.id === actionDefId);
          if (removed)
            assertLogicFunctionReferenceRemovable(composition, 'action', removed.actionId);
          composition.customActions = composition.customActions.filter((a) => a.id !== actionDefId);
          if (removed) {
            for (const layer of composition.layers) {
              if (
                layer.loop?.activation.type === 'customAction' &&
                layer.loop.activation.customActionId === removed.actionId
              ) {
                layer.loop = null;
              }
              if (
                layer.element.type === 'text' &&
                layer.element.textAnimation.customActionId === removed.actionId
              ) {
                layer.element.textAnimation.customActionId = null;
              }
            }
            pruneVisualRuleReferences(composition);
          }
        }),

      updateCustomAction: (actionDefId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const action = composition.customActions.find((a) => a.id === actionDefId);
          if (!action) return;
          const nextPatch = { ...patch };
          if (nextPatch.actionId !== undefined) {
            const previousActionId = action.actionId;
            const trimmed = nextPatch.actionId.trim();
            if (trimmed !== previousActionId)
              assertLogicFunctionReferenceRemovable(composition, 'action', previousActionId);
            const isDuplicate =
              trimmed.length === 0 ||
              composition.customActions.some((a) => a.id !== actionDefId && a.actionId === trimmed);
            if (isDuplicate) delete nextPatch.actionId;
            else {
              nextPatch.actionId = trimmed;
              for (const layer of composition.layers) {
                if (
                  layer.loop?.activation.type === 'customAction' &&
                  layer.loop.activation.customActionId === previousActionId
                ) {
                  layer.loop.activation.customActionId = trimmed;
                }
                if (
                  layer.element.type === 'text' &&
                  layer.element.textAnimation.customActionId === previousActionId
                ) {
                  layer.element.textAnimation.customActionId = trimmed;
                }
              }
              renameVisualRuleCustomAction(composition.layers, previousActionId, trimmed);
            }
          }
          Object.assign(action, nextPatch);
        }),

      placeImageSource: async (source, options = {}) => {
        const initial = get();
        const generation = projectLoadGeneration;
        const composition = getActiveComposition(initial.project, initial.activeCompositionId);
        const originalSource = composition.layers.find(
          (l) => l.id === options.replaceLayerId,
        )?.element;
        let changedDocument = false;
        const unsubscribe = useProjectStore.subscribe((state) => {
          if (
            state.project.id !== initial.project.id ||
            state.activeCompositionId !== composition.id
          )
            changedDocument = true;
        });
        try {
          const images = Array.isArray(source)
            ? await Promise.all(source.map(prepareImage))
            : await (async () => {
                const asset = composition.assets.find(
                  (a) => a.id === source.assetId && a.kind === 'image',
                );
                if (!asset) throw new Error('This image is no longer in Resources.');
                return [{ asset, companions: [], ...(await readImageSize(asset.dataUri)) }];
              })();
          if (options.signal?.aborted) return [];
          if (changedDocument || generation !== projectLoadGeneration)
            throw new Error(
              'The document changed. Choose the image again in the current document.',
            );
          let ids: string[] = [];
          const resets: Array<{ fieldId: string; sourcePath: string[] }> = [];
          const previewValues = useTestDataStore.getState().values;
          const commitImage = () =>
            set((state) => {
              const current = getActiveComposition(state.project, state.activeCompositionId);
              if (
                !Array.isArray(source) &&
                !current.assets.some(
                  (a) =>
                    a.id === source.assetId &&
                    a.kind === 'image' &&
                    a.dataUri === images[0]?.asset.dataUri,
                )
              ) {
                throw new Error('This resource changed while loading. Choose it again.');
              }
              const currentSource = current.layers.find(
                (l) => l.id === options.replaceLayerId,
              )?.element;
              const replacement = current.layers.find(
                (layer) => layer.id === options.replaceLayerId,
              );
              const before = replacement
                ? { element: { ...replacement.element }, effects: replacement.effects }
                : undefined;
              if (
                options.replaceLayerId &&
                originalSource?.type === 'image' &&
                currentSource?.type === 'image' &&
                originalSource.src !== currentSource.src
              ) {
                throw new Error(
                  'This image was changed while loading. Choose the replacement again.',
                );
              }
              ids = placeImages(current, images, options);
              for (const id of ids) {
                const layer = current.layers.find((l) => l.id === id)!;
                if (!options.replaceLayerId) materializeAnimationTracks(layer);
                else if (before)
                  resets.push(
                    ...syncDesignerBindingDefaults(
                      current,
                      layer,
                      before,
                      ['src'],
                      Object.fromEntries(
                        current.dataFields.map((field) => [
                          field.id,
                          resolvePreviewFieldValue(field, previewValues[field.id])!,
                        ]),
                      ),
                    ),
                  );
              }
            });
          if (options.commit) options.commit(commitImage);
          else commitImage();
          useTestDataStore.getState().clearOverrides(resets);
          return ids;
        } finally {
          unsubscribe();
        }
      },

      setTestRundowns: (rundowns) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const errors = testRundownErrors(composition, rundowns);
          if (errors.length) throw new Error(errors.join('\n'));
          composition.testRundowns = structuredClone(rundowns);
        }),

      importAsset: async (file) => {
        const { asset } = await prepareAssetImport(file);
        return get().addPreparedAsset(asset);
      },

      addPreparedAsset: (asset) => {
        let assetId = asset.id;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const duplicate = composition.assets.find(
            (candidate) =>
              candidate.dataUri === asset.dataUri && candidate.mimeType === asset.mimeType,
          );
          if (duplicate) assetId = duplicate.id;
          else composition.assets.push(asset);
        });
        return assetId;
      },

      importSvgBundle: async (files) => {
        const result = await buildSvgBundle(files);
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          composition.assets.push(result.svgAsset, ...result.fontAssets);
        });
        return { assetId: result.svgAsset.id, warnings: result.warnings };
      },

      updateAsset: (assetId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const asset = composition.assets.find((candidate) => candidate.id === assetId);
          if (!asset) return;
          Object.assign(asset, patch);
        }),

      removeAsset: (assetId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const asset = composition.assets.find((candidate) => candidate.id === assetId);
          if (!asset) return;
          const consumers = findAssetConsumers(composition, asset);
          if (
            consumers.layerIds.length > 0 ||
            consumers.fieldIds.length > 0 ||
            consumers.fontLayerIds.length > 0 ||
            consumers.mediaCueIds.length > 0 ||
            (consumers.componentIds?.length ?? 0) > 0 ||
            consumers.compositionBackground ||
            (consumers.backgroundStyleIds?.length ?? 0) > 0 ||
            (consumers.typographyStyleIds?.length ?? 0) > 0
          ) {
            return;
          }
          composition.assets = composition.assets.filter((a) => a.id !== assetId);
        }),
    };
  }),
);

export function useActiveComposition(): Composition {
  return useProjectStore((state) => getActiveComposition(state.project, state.activeCompositionId));
}

export { getLayerTransformAtFrame };
