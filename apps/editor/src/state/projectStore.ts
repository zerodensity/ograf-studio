import { create } from 'zustand';
import { current } from 'immer';
import { immer } from 'zustand/middleware/immer';
import {
  applyPathEdit,
  type PathEdit,
  assertMaskSourcesRemovable,
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
  createAsset,
  applyDesignTokenBinding,
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
  dataUriByteSize,
  findAssetConsumers,
  buildComponentDefinition,
  createCustomActionDefinition,
  computeKeyframeFrames,
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
  pruneVisualRuleReferences,
  remapVisualRule,
  renameVisualRuleCustomAction,
  visualRuleFieldIds,
  createProject,
  createShaderPaint,
  createShaderResource as createStoredShaderResource,
  createRectangleElement,
  inspectShaderElement,
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
  syncShaderParameterFields,
  syncCompositionShaderParameterFields,
  syncDesignerBindingDefaults,
  createTransition,
  defaultTransformForRole,
  findLayerKeyframeAtFrame,
  findLayerPropertyKeyframeAtFrame,
  getLayerEffectsAtFrame,
  getPaintAtFrame,
  getLayerPropertyValueAtFrame,
  getResolvedLayerAnimationTracks,
  getLayerTransformAtFrame,
  getTotalFrames,
  migrateProject,
  materializeLowerThird,
  materializeBug,
  materializeClock,
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
  type AudioElement,
  type ChartElement,
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
} from '@ograf-editor/scene-model';
import {
  alignedPatches,
  distributedPatches,
  resizeConstrainedTransform,
  type AlignmentMode,
  type DistributionMode,
} from '../canvas/layoutGeometry';
import { useTimelineStore } from './timelineStore';
import { useLayerClipboardStore } from './layerClipboardStore';
import { planLifecycleRetime, type LifecycleRetimePlan } from './lifecycleRetime';
import { buildSvgBundle } from './svgBundleImport';
import { placeImages, prepareImage, readImageSize, type ImagePlacement } from './imageImport';
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

export type { NewLayerKind } from '@ograf-editor/scene-model';

export type ElementFields = { fill: Paint } & Omit<RectangleElement, 'type' | 'fill'> & {
    patternId: string;
  } & Omit<EllipseElement, 'type' | 'fill'> &
  Omit<TextElement, 'type' | 'fill'> &
  Omit<ImageElement, 'type' | 'fill'> &
  Omit<AudioElement, 'type'> &
  Omit<PathElement, 'type' | 'fill'> &
  Omit<ImageSequenceElement, 'type' | 'fill'> &
  Omit<LottieElement, 'type' | 'fill'> &
  Omit<ChartElement, 'type'> &
  Omit<ShaderElement, 'type'>;

interface ProjectState {
  project: Project;
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
  loadProject: (project: Project) => void;
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

  addLayer: (kind: NewLayerKind) => string;
  setTilingPattern: (patch: TilingPatternPatch, patternId?: string) => string;
  removeTilingPattern: (patternId: string) => void;
  addPatternInstance: (patternId: string) => string;
  createPatternResource: (
    patch: TilingPatternPatch,
    addToCanvas?: boolean,
  ) => { patternId: string; layerId?: string };
  duplicatePatternResource: (patternId: string) => string;
  makePatternIndependent: (layerId: string) => string;
  addLowerThird: () => MaterializedLowerThird;
  addBug: () => MaterializedBroadcastRecipe;
  addTicker: () => MaterializedBroadcastRecipe;
  addScoreboard: () => MaterializedBroadcastRecipe;
  addClock: () => MaterializedBroadcastRecipe;
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
  addLayerKeyframe: (layerId: string, frame: number) => string;
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
    }>,
  ) => void;
  setLayerLoopPropertyTrack: (
    layerId: string,
    property: AnimatableLayerProperty,
    keys: LayerPropertyKeyframe[],
  ) => void;
  removeLayerLoop: (layerId: string) => void;
  updateLayerElement: (layerId: string, patch: Partial<ElementFields>) => void;
  editLayerPath: (layerId: string, edit: PathEdit, frame?: number) => void;
  updateLayerTextStroke: (
    layerId: string,
    frame: number,
    patch: Partial<Pick<TextElement, 'strokeColor' | 'strokeWidth' | 'strokePaint'>>,
  ) => void;
  updateLayerPaint: (layerId: string, frame: number, paint: Paint | undefined) => void;
  createShaderResource: (paint?: ShaderPaint) => StoredShaderResourceTarget;
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
  /** Renames the template; blank or unchanged names are ignored. */
  renameProject: (name: string) => void;
  renameLayer: (layerId: string, name: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerGuide: (layerId: string) => void;
  setLayerBlendMode: (layerId: string, blendMode: BlendMode) => void;
  toggleLayerLock: (layerId: string) => void;
  groupLayers: (layerIds: string[]) => string | null;
  ungroupLayers: (layerIds: string[]) => void;
  setLayerParent: (layerId: string, parentId: string | null) => void;
  setLayerClipChildren: (layerId: string, clipChildren: boolean) => void;
  setLayerMask: (layerId: string, mask: Layer['mask'], hideSource?: boolean) => void;
  setLayerMaskOnly: (layerId: string, value: boolean) => void;
  setLayerConstraints: (layerId: string, constraints: Partial<LayerConstraints>) => void;
  setLayerAutoLayout: (layerId: string, layout: Partial<LayerAutoLayout>) => void;
  setLayerUpdateTransition: (layerId: string, patch: Partial<Layer['updateTransition']>) => void;
  setLayerMotionPath: (layerId: string, link: Layer['motionPath']) => void;
  addLayerVisualRule: (layerId: string, trigger?: VisualRuleTrigger) => string | null;
  updateLayerVisualRule: (
    layerId: string,
    ruleId: string,
    patch: Partial<Omit<LayerVisualRule, 'id'>>,
  ) => void;
  moveLayerVisualRule: (layerId: string, ruleId: string, direction: -1 | 1) => void;
  duplicateLayerVisualRule: (layerId: string, ruleId: string) => string | null;
  /** Bakes an Animate In or Out choice into each unlocked layer's tracks. */
  setLayerMotion: (
    layerIds: string | string[],
    side: LayerMotionSide,
    spec: LayerMotionSpec | null,
  ) => void;
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
        | 'options'
        | 'constraints'
        | 'fileExtensions'
        | 'properties'
        | 'items'
      >
    >,
  ) => void;
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
  importAsset: (file: File) => Promise<string>;
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
  if (!useTimelineStore.getState().autoKeyframe) {
    const existingEffect = getEffectStack(layer.effects).find((effect) => effect.id === effectId);
    if (!existingEffect) throw new Error(`Effect not found: ${effectId}`);
    const before = Object.fromEntries(
      Object.entries(patch.params ?? {}).flatMap(([param, value]) => {
        if (typeof value !== 'number') return [];
        const property = effectProperty(existingEffect, param) as AnimatableLayerProperty;
        return [[param, getLayerPropertyValueAtFrame(layer, property, frame)]];
      }),
    );
    const effect = updateEffect(layer, effectId, patch);
    for (const [param, value] of Object.entries(effectParams(effect, layer.effects)))
      if (typeof value === 'number' && before[param] !== undefined)
        offsetExistingPropertyKeys(
          layer,
          effectProperty(effect, param) as AnimatableLayerProperty,
          value - before[param]!,
        );
    return;
  }
  const effect = updateEffect(layer, effectId, patch),
    boundedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
  for (const [param, value] of Object.entries(patch.params ?? {}))
    if (typeof value === 'number')
      upsertPropertyKeyframe(
        layer,
        effectProperty(effect, param) as AnimatableLayerProperty,
        boundedFrame,
        value,
      );
}

function getDefaultAuthoringKeyframeId(composition: Composition): string {
  return (
    (
      composition.keyframes.find((keyframe) => keyframe.role === 'start') ??
      composition.keyframes.find((keyframe) => keyframe.role === 'step') ??
      composition.keyframes[0]
    )?.id ?? ''
  );
}

function materializeAnimationTracks(layer: Layer): void {
  const resolved = getResolvedLayerAnimationTracks(layer);
  layer.animationTracks = Object.fromEntries(
    Object.entries(resolved).map(([property, keyframes]) => [
      property,
      keyframes?.map((keyframe) => ({ ...keyframe })) ?? [],
    ]),
  );
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
  if (!propertyKeyRemains && layer.keyframes.length > 1) {
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
    property.startsWith('fill.stops[')
  )
    return Math.max(0, Math.min(1, value));
  if (property === 'blur' || property === 'dropShadowBlur' || property === 'strokeWidth')
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

function writeUiLayerTransform(
  composition: Composition,
  layer: Layer,
  frame: number,
  patch: Partial<LayerTransform>,
): void {
  const roundedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
  const autoKeyframe = useTimelineStore.getState().autoKeyframe;
  const before = getLayerTransformAtFrame(layer, roundedFrame);
  if (autoKeyframe) writeLayerTransformAtFrame(composition, layer, roundedFrame, patch);
  else offsetLayerTransform(layer, roundedFrame, patch);
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
    if (autoKeyframe) writeLayerTransformAtFrame(composition, descendant, roundedFrame, childPatch);
    else offsetLayerTransform(descendant, roundedFrame, childPatch);
  }
}

function resizeConstrainedLayers(
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
    for (const { frame, resized } of resizedFrames) {
      writeLayerTransformAtFrame(composition, layer, frame, {
        x: resized.x,
        y: resized.y,
        width: resized.width,
        height: resized.height,
      });
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

function appendLayerCopies(
  composition: Composition,
  sourceComposition: Composition,
  sources: Layer[],
  offset: number,
  placement: 'front' | 'after-selection' = 'front',
): string[] {
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
          ]),
      ),
    ];
    for (const sourceFieldId of boundFieldIds) {
      const sourceField = sourceComposition.dataFields.find((field) => field.id === sourceFieldId);
      if (!sourceField) continue;
      const field = cloneFieldDefinitionWithFreshIds(sourceField);
      field.key = uniqueCopiedFieldKey(sourceField.key, usedFieldKeys);
      composition.dataFields.push(field);
      fields.set(sourceFieldId, field.id);
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
    const sourceTracks = getResolvedLayerAnimationTracks(source);
    layer.animationTracks = Object.fromEntries(
      Object.entries(sourceTracks).map(([property, keyframes]) => [
        property,
        (keyframes ?? []).map((keyframe) =>
          createLayerPropertyKeyframe(
            keyframe.frame,
            keyframe.value + (property === 'x' || property === 'y' ? offset : 0),
            {
              easing: keyframe.easing,
              curve: keyframe.curve ? { ...keyframe.curve } : undefined,
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
                  curve: keyframe.curve ? { ...keyframe.curve } : undefined,
                },
              ),
            ),
          ]),
        ),
      };
    }
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
      (composition.mediaCues?.length ?? 0) > 0 ||
      [
        ...composition.layers,
        ...composition.components.flatMap((component) => component.layers),
      ].some((layer) => hasElementMediaPaint(layer.element) || layer.element.type === 'audio'),
  );
}

function enforceMediaRuntimeProfile(project: Project): void {
  if (!projectUsesMediaPaint(project)) return;
  project.supportsRealTime = true;
  project.supportsNonRealTime = false;
}

async function readPlayableDurationMs(
  file: File,
  kind: 'audio' | 'media',
): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video');
    const finish = (value?: number) => {
      window.clearTimeout(timeout);
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(), 8_000);
    media.preload = 'metadata';
    media.onloadedmetadata = () =>
      finish(
        Number.isFinite(media.duration) && media.duration > 0 ? media.duration * 1000 : undefined,
      );
    media.onerror = () => finish();
    media.src = url;
  });
}

export const useProjectStore = create<ProjectStore>()(
  immer((set, get) => {
    const initialProject = createProject();
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
    return {
      project: initialProject,
      activeCompositionId: initialProject.mainCompositionId,
      activeKeyframeId: getDefaultAuthoringKeyframeId(initialComposition),

      newProject: () => {
        projectLoadGeneration++;
        useLayerClipboardStore.getState().copy([]);
        useTimelineStore.getState().resetForProjectLoad();
        set((state) => {
          const project = createProject();
          const composition = project.compositions[0]!;
          state.project = project;
          state.activeCompositionId = project.mainCompositionId;
          state.activeKeyframeId = getDefaultAuthoringKeyframeId(composition);
        });
      },

      loadProject: (project) => {
        projectLoadGeneration++;
        useLayerClipboardStore.getState().copy([]);
        useTimelineStore.getState().resetForProjectLoad();
        set((state) => {
          const migrated = migrateProject(project);
          for (const candidate of migrated.compositions)
            syncCompositionShaderParameterFields(candidate);
          enforceMediaRuntimeProfile(migrated);
          state.project = migrated;
          state.activeCompositionId = migrated.mainCompositionId;
          const composition = getActiveComposition(migrated, migrated.mainCompositionId);
          state.activeKeyframeId = getDefaultAuthoringKeyframeId(composition);
        });
      },

      setProjectMeta: (patch) =>
        set((state) => {
          Object.assign(state.project, patch);
          enforceMediaRuntimeProfile(state.project);
        }),

      updateCompositionSettings: (patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const oldSize = { width: composition.width, height: composition.height };
          const next = { ...patch };
          // Guard the numeric fields: a cleared/invalid input must not poison the composition
          // (frameRate 0 would divide-by-zero every frame<->seconds conversion in the app).
          if (next.width !== undefined && !(next.width > 0)) delete next.width;
          if (next.height !== undefined && !(next.height > 0)) delete next.height;
          if (next.frameRate !== undefined && !(next.frameRate > 0)) delete next.frameRate;
          if (next.updateTransitionFrames !== undefined)
            next.updateTransitionFrames = Math.max(0, Math.round(next.updateTransitionFrames));
          const newSize = {
            width: next.width ?? composition.width,
            height: next.height ?? composition.height,
          };
          resizeConstrainedLayers(composition, oldSize, newSize);
          Object.assign(composition, next);
        }),

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
          composition.mediaCues = (composition.mediaCues ?? []).filter((cue) => cue.id !== cueId);
          pruneVisualRuleReferences(composition);
        }),

      addLayer: (kind) => {
        if (kind === 'pattern') {
          let id = '';
          set((state) => {
            const c = getActiveComposition(state.project, state.activeCompositionId);
            const p = setTilingPattern(
              c,
              getPatternPresetPatch('dots', c.width, c.height, c.frameRate),
            );
            id = addTilingPatternLayer(c, p.id);
          });
          return id;
        }
        const layer = createLayerOfKind(kind);
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const lifecycleFrames = computeKeyframeFrames(composition);
          for (const [index, keyframe] of composition.keyframes.entries()) {
            layer.keyframes.push(
              createLayerKeyframe(
                lifecycleFrames[index]?.frame ?? 0,
                defaultTransformForRole(kind, keyframe.role),
                {
                  easing:
                    composition.transitions.find(
                      (transition) => transition.toKeyframeId === keyframe.id,
                    )?.easing ?? 'linear',
                },
              ),
            );
          }
          materializeAnimationTracks(layer);
          composition.layers.push(layer);
          if (kind === 'audio') {
            state.project.supportsRealTime = true;
            state.project.supportsNonRealTime = false;
          }
          syncShaderParameterFields(composition, layer);
        });
        return layer.id;
      },

      addLowerThird: () => {
        let result!: MaterializedLowerThird;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          result = materializeLowerThird(composition);
        });
        return result;
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
      addPatternInstance: (patternId) => {
        let id = '';
        set((state) => {
          id = addTilingPatternLayer(
            getActiveComposition(state.project, state.activeCompositionId),
            patternId,
          );
        });
        return id;
      },
      createPatternResource: (patch, addToCanvas = true) => {
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
          if (addToCanvas) result.layerId = addTilingPatternLayer(composition, pattern.id);
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
        let result!: MaterializedBroadcastRecipe;
        set((state) => {
          result = materializeBug(getActiveComposition(state.project, state.activeCompositionId));
        });
        return result;
      },

      addTicker: () => {
        let result!: MaterializedBroadcastRecipe;
        set((state) => {
          result = materializeTicker(
            getActiveComposition(state.project, state.activeCompositionId),
          );
        });
        return result;
      },

      addScoreboard: () => {
        let result!: MaterializedBroadcastRecipe;
        set((state) => {
          result = materializeScoreboard(
            getActiveComposition(state.project, state.activeCompositionId),
          );
        });
        return result;
      },

      addClock: () => {
        let result!: MaterializedBroadcastRecipe;
        set((state) => {
          result = materializeClock(getActiveComposition(state.project, state.activeCompositionId));
        });
        return result;
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
          composition.layers = composition.layers.filter((l) => l.id !== layerId);
          syncCompositionShaderParameterFields(composition);
          for (const layer of composition.layers) {
            if (layer.parentId === layerId) layer.parentId = null;
            if (layer.motionPath?.sourceLayerId === layerId) layer.motionPath = null;
          }
          for (const folder of composition.layout.timelineFolders) {
            folder.layerIds = folder.layerIds.filter((candidate) => candidate !== layerId);
          }
          composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
            (folder) => folder.layerIds.length > 0,
          );
          pruneVisualRuleReferences(composition);
        }),

      updateLayerTransform: (layerId, frame, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (!layer || layer.isLocked) return;
          writeUiLayerTransform(composition, layer, frame, patch);
        }),

      addLayerKeyframe: (layerId, frame) => {
        let created!: LayerKeyframe;
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
            created = existing;
            return;
          }
          created = createLayerKeyframe(
            roundedFrame,
            getLayerTransformAtFrame(layer, roundedFrame),
          );
          layer.keyframes.push(created);
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
        });
        return created.id;
      },

      addLayerHoldFrame: (layerId, frame) => {
        let created!: LayerKeyframe;
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
            created = existing;
            return;
          }
          const previous = [...layer.keyframes]
            .sort((a, b) => a.frame - b.frame)
            .filter((keyframe) => keyframe.frame < roundedFrame)
            .at(-1);
          created = createLayerKeyframe(
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
        });
        return created.id;
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
            if (propertyKey) propertyKey.easing = easing;
          }
        }),

      addLayerPropertyKeyframe: (layerId, property, frame) => {
        let created!: LayerPropertyKeyframe;
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
          created =
            existing ??
            upsertPropertyKeyframe(
              layer,
              property,
              roundedFrame,
              getLayerPropertyValueAtFrame(layer, property, roundedFrame),
            );
          syncAggregateKeyframe(layer, roundedFrame, created.easing);
        });
        return created.id;
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
          materializeAnimationTracks(layer);
          const track = layer.animationTracks[property] ?? [];
          if (track.length <= 1 && !parseShaderAnimationProperty(property)) return;
          const removedFrame = track.find((candidate) => candidate.id === keyframeId)?.frame;
          layer.animationTracks[property] = track.filter(
            (candidate) => candidate.id !== keyframeId,
          );
          if (layer.animationTracks[property]?.length === 0) delete layer.animationTracks[property];
          if (removedFrame !== undefined) removeAggregateKeyframeIfOrphaned(layer, removedFrame);
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
          if (keyframe) keyframe.easing = easing;
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

      updateLayerElement: (layerId, patch) =>
        designerEdit(layerId, Object.keys(patch), (state, composition, layers) => {
          const layer = layers[0]!;
          if (layer && !layer.isLocked) {
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
            if (
              layer.element.type === 'text' &&
              patch.content !== undefined &&
              patch.content !== layer.element.content &&
              patch.runs === undefined
            ) {
              layer.element.runs = [];
            }
            Object.assign(layer.element, patch);
            enforceMediaRuntimeProfile(state.project);
            syncShaderParameterFields(composition, layer);
            pruneInvalidGradientStopTracks(layer);
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
              if (useTimelineStore.getState().autoKeyframe) {
                const key = upsertPropertyKeyframe(layer, property, roundedFrame, next);
                syncAggregateKeyframe(layer, roundedFrame, key.easing);
              } else {
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
          const next = shaderPaintWithPatch(paint ?? createShaderPaint(), {});
          if (!next.name) next.name = defaultShaderResourceName(state.project);
          const resource = createStoredShaderResource({ paint: next });
          state.project.shaders.push(resource);
          target = { shaderId: resource.id };
        });
        return target!;
      },

      updateShaderResource: (target, patch) => {
        const values = useTestDataStore.getState().values;
        const resets: Array<{ fieldId: string; sourcePath: string[] }> = [];
        set((state) => {
          if (isStoredShaderResourceTarget(target)) {
            const { resource, paint } = resolveShaderResource(state.project, target);
            resource.paint = shaderPaintWithPatch(paint, patch);
            return;
          }
          const { composition, component, layer, paint } = resolveShaderResource(
            state.project,
            target,
          );
          const before = { element: current(layer.element), effects: current(layer.effects) };
          if (layer.isLocked) throw new Error(`Shader resource object "${layer.name}" is locked.`);
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
          const { composition, component, layer } = resolveShaderResource(state.project, target);
          if (layer.isLocked) throw new Error(`Shader resource object "${layer.name}" is locked.`);
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
          if (!useTimelineStore.getState().autoKeyframe) {
            const before = getLayerPropertyValueAtFrame(layer, 'strokeWidth', frame);
            offsetExistingPropertyKeys(layer, 'strokeWidth', strokeWidth - before);
            layer.element.strokeWidth = strokeWidth;
            return;
          }
          layer.element.strokeWidth = strokeWidth;
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const keyframe = upsertPropertyKeyframe(layer, 'strokeWidth', roundedFrame, strokeWidth);
          syncAggregateKeyframe(layer, roundedFrame, keyframe.easing);
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
          const previous = element.fill;
          const previousEvaluated = getPaintAtFrame(
            previous,
            getResolvedLayerAnimationTracks(layer),
            roundedFrame,
          );
          if (!useTimelineStore.getState().autoKeyframe) {
            if (isGradientPaint(paint) && isGradientPaint(previousEvaluated)) {
              paint.stops.forEach((stop, index) => {
                const before = previousEvaluated.stops[index]?.offset;
                if (before !== undefined)
                  offsetExistingPropertyKeys(
                    layer,
                    `fill.stops[${index}].offset`,
                    stop.offset - before,
                  );
              });
            }
            element.fill = paint;
            syncShaderParameterFields(composition, layer);
            pruneInvalidGradientStopTracks(layer);
            return;
          }
          materializeAnimationTracks(layer);
          if (isGradientPaint(paint) && isGradientPaint(previous)) {
            element.fill = {
              ...paint,
              stops: paint.stops.map((stop, index) => ({
                ...stop,
                offset: previous.stops[index]?.offset ?? stop.offset,
              })),
            };
            if (isGradientPaint(previousEvaluated)) {
              paint.stops.forEach((stop, index) => {
                if (previousEvaluated.stops[index]?.offset === stop.offset) return;
                const keyframe = upsertPropertyKeyframe(
                  layer,
                  `fill.stops[${index}].offset`,
                  roundedFrame,
                  stop.offset,
                );
                syncAggregateKeyframe(layer, roundedFrame, keyframe.easing);
              });
            }
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
          if (!useTimelineStore.getState().autoKeyframe) {
            for (const property of EFFECT_ANIMATION_PROPERTIES)
              if (patch[property] !== undefined)
                offsetExistingPropertyKeys(
                  layer,
                  property,
                  normalized[property] -
                    getLayerPropertyValueAtFrame(layer, property, roundedFrame),
                );
            layer.effects = normalized;
            return;
          }
          layer.effects = normalized;
          for (const property of EFFECT_ANIMATION_PROPERTIES) {
            if (patch[property] !== undefined) {
              const keyframe = upsertPropertyKeyframe(
                layer,
                property,
                roundedFrame,
                normalized[property],
              );
              syncAggregateKeyframe(layer, roundedFrame, keyframe.easing);
            }
          }
        }),

      renameProject: (name) => {
        const trimmed = name.trim();
        if (!trimmed || trimmed === get().project.name) return;
        set((state) => {
          state.project.name = trimmed;
        });
      },

      renameLayer: (layerId, name) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer) layer.name = name;
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
          if (layer) layer.isGuide = !layer.isGuide;
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
          for (const layer of composition.layers) {
            if (unique.includes(layer.id)) layer.groupId = groupId;
          }
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
          for (const layer of composition.layers) {
            if (layer.groupId && groupIds.has(layer.groupId)) layer.groupId = null;
          }
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
        } catch {
          return null;
        }
        set((state) => {
          getActiveComposition(state.project, state.activeCompositionId).components.push(
            definition,
          );
        });
        return definition.id;
      },

      instantiateComponent: (componentId, offset = { x: 40, y: 40 }, linked = false) => {
        const snapshot = useProjectStore.getState();
        const composition = getActiveComposition(snapshot.project, snapshot.activeCompositionId);
        const definition = composition.components.find((candidate) => candidate.id === componentId);
        if (!definition) return [];
        const instance = instantiateComponentDefinition(composition, definition, offset, linked);
        set((state) => {
          const target = getActiveComposition(state.project, state.activeCompositionId);
          target.dataFields.push(...instance.dataFields);
          target.layers.push(...instance.layers);
        });
        return instance.layers.map((layer) => layer.id);
      },

      updateComponentFromLayers: (componentId, layerIds) => {
        const snapshot = useProjectStore.getState();
        const composition = getActiveComposition(snapshot.project, snapshot.activeCompositionId);
        const index = composition.components.findIndex((candidate) => candidate.id === componentId);
        const existing = composition.components[index];
        if (!existing || layerIds.length === 0) return false;
        let replacement: ComponentDefinition;
        try {
          replacement = buildComponentDefinition(composition, layerIds, existing.name, existing.id);
        } catch {
          return false;
        }
        set((state) => {
          const target = getActiveComposition(state.project, state.activeCompositionId);
          const targetIndex = target.components.findIndex(
            (candidate) => candidate.id === componentId,
          );
          if (targetIndex >= 0) target.components[targetIndex] = replacement;
        });
        return true;
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
          composition.components = composition.components.filter(
            (candidate) => candidate.id !== componentId,
          );
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
          if (!layer || parentId === layerId) return;
          if (parentId && !composition.layers.some((candidate) => candidate.id === parentId))
            return;
          if (
            parentId &&
            descendantLayers(composition, layerId).some((item) => item.id === parentId)
          )
            return;
          layer.parentId = parentId;
        }),

      setLayerClipChildren: (layerId, clipChildren) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer) layer.clipChildren = clipChildren;
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
        }),

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
          layer.motionPath = link ? structuredClone(link) : null;
        }),

      addLayerVisualRule: (layerId, trigger = 'data') => {
        let id: string | null = null;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const createdField = trigger === 'data' && composition.dataFields.length === 0;
          const field =
            trigger === 'data'
              ? (composition.dataFields[0] ?? createRuleConditionField(composition, layer))
              : null;
          const rule = createLayerVisualRule({
            trigger,
            fieldId: field?.id ?? '',
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
            !composition.dataFields.some((field) => field.id === rule.fieldId)
          ) {
            const createdField = composition.dataFields.length === 0;
            rule.fieldId = (
              composition.dataFields[0] ?? createRuleConditionField(composition, layer)
            ).id;
            if (createdField) rule.operator = 'not-empty';
          }
        }),

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
            name: `${source.name} copy`,
          });
        });
        return duplicatedId;
      },

      setLayerMotion: (layerIds, side, spec) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const ids = new Set(Array.isArray(layerIds) ? layerIds : [layerIds]);
          for (const layer of composition.layers) {
            if (!ids.has(layer.id) || layer.isLocked) continue;
            applyLayerMotion(composition, layer, side, spec);
          }
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
          composition.dataConnections.push({
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
          });
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
          connection.refreshMs = Math.max(0, Math.round(connection.refreshMs));
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

      updateDesignToken: (tokenId, patch) =>
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
        }),

      removeDesignToken: (tokenId) =>
        set((state) => {
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
              if (useTimelineStore.getState().autoKeyframe)
                writeLayerTransformAtFrame(composition, layer, frame, patch);
              else writeUiLayerTransform(composition, layer, frame, patch);
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
              if (useTimelineStore.getState().autoKeyframe)
                writeLayerTransformAtFrame(composition, layer, frame, patch);
              else writeUiLayerTransform(composition, layer, frame, patch);
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

      removeDataField: (fieldId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          if (
            composition.dataFields.find((field) => field.id === fieldId)?.generatedShaderParameter
          )
            return;
          composition.dataFields = composition.dataFields.filter((f) => f.id !== fieldId);
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
          const created = createNextBinding(layer, composition.dataFields);
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
            const replacement = current.layers.find((layer) => layer.id === options.replaceLayerId);
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
          useTestDataStore.getState().clearOverrides(resets);
          return ids;
        } finally {
          unsubscribe();
        }
      },

      importAsset: async (file) => {
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });
        const extension = file.name.split('.').at(-1)?.toLowerCase();
        const fontMime =
          extension === 'woff2'
            ? 'font/woff2'
            : extension === 'woff'
              ? 'font/woff'
              : extension === 'otf'
                ? 'font/otf'
                : extension === 'ttf'
                  ? 'font/ttf'
                  : undefined;
        const audioMime =
          extension === 'mp3'
            ? 'audio/mpeg'
            : extension === 'wav'
              ? 'audio/wav'
              : extension === 'ogg'
                ? 'audio/ogg'
                : undefined;
        const mimeType = (fontMime ?? audioMime ?? file.type) || 'application/octet-stream';
        const kind = fontMime
          ? 'font'
          : mimeType.startsWith('image/')
            ? 'image'
            : mimeType.startsWith('video/')
              ? 'media'
              : mimeType.startsWith('audio/')
                ? 'audio'
                : 'source';
        const durationMs =
          kind === 'audio' || kind === 'media'
            ? await readPlayableDurationMs(file, kind)
            : undefined;
        const asset = createAsset({
          name: file.name,
          kind,
          dataUri,
          mimeType,
          originalFileName: file.name,
          byteSize: file.size || dataUriByteSize(dataUri),
          ...(durationMs ? { durationMs } : {}),
          ...(fontMime ? { fontFamily: file.name.replace(/\.[^.]+$/, '') } : {}),
          ...(fontMime ? { fontWeight: '100 900', fontStyle: 'normal' as const } : {}),
        });
        let assetId = asset.id;
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const duplicate = composition.assets.find(
            (candidate) => candidate.dataUri === dataUri && candidate.mimeType === mimeType,
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
            consumers.mediaCueIds.length > 0
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
