import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createAsset,
  applyDesignTokenBinding,
  dataUriByteSize,
  findAssetConsumers,
  buildComponentDefinition,
  createCustomActionDefinition,
  computeKeyframeFrames,
  createFieldDefinition,
  createId,
  createKeyframe,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createProject,
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
  type LayerKeyframe,
  type LayerPropertyKeyframe,
  type LayerLoopActivation,
  type Layer,
  type LayerBinding,
  type LayerEffects,
  type LayerSemantics,
  type LayerTransform,
  type LayerConstraints,
  type NewLayerKind,
  type MaterializedLowerThird,
  type MaterializedRepeater,
  type PathElement,
  type Paint,
  type Project,
  type RectangleElement,
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
import { planLifecycleRetime, type LifecycleRetimePlan } from './lifecycleRetime';
import { buildSvgBundle } from './svgBundleImport';

export type { NewLayerKind } from '@ograf-editor/scene-model';

export type ElementFields = { fill: Paint } & Omit<RectangleElement, 'type' | 'fill'> &
  Omit<EllipseElement, 'type' | 'fill'> &
  Omit<TextElement, 'type'> &
  Omit<ImageElement, 'type'> &
  Omit<PathElement, 'type' | 'fill'> &
  Omit<ImageSequenceElement, 'type'> &
  Omit<LottieElement, 'type'>;

interface ProjectState {
  project: Project;
  activeCompositionId: string;
  activeKeyframeId: string;
}

interface ProjectActions {
  newProject: () => void;
  loadProject: (project: Project) => void;
  setProjectMeta: (
    patch: Partial<
      Pick<
        Project,
        'id' | 'name' | 'description' | 'version' | 'supportsRealTime' | 'supportsNonRealTime'
      >
    >,
  ) => void;
  updateCompositionSettings: (
    patch: Partial<
      Pick<
        Composition,
        'name' | 'width' | 'height' | 'frameRate' | 'updateTransitionFrames' | 'backgroundColor'
      >
    >,
  ) => void;
  updateCompositionLayout: (patch: Partial<Omit<CompositionLayout, 'guides'>>) => void;
  addCanvasGuide: (axis: 'vertical' | 'horizontal', position?: number) => string;
  updateCanvasGuide: (guideId: string, position: number) => void;
  removeCanvasGuide: (guideId: string) => void;

  addLayer: (kind: NewLayerKind) => string;
  addLowerThird: () => MaterializedLowerThird;
  addRepeater: (
    layerIds: string[],
    count?: number,
    direction?: 'horizontal' | 'vertical',
    gap?: number,
  ) => MaterializedRepeater | null;
  pasteLayers: (layers: Layer[], offset?: number) => string[];
  removeLayer: (layerId: string) => void;
  updateLayerTransform: (layerId: string, frame: number, patch: Partial<LayerTransform>) => void;
  addLayerKeyframe: (layerId: string, frame: number) => string;
  addLayerHoldFrame: (layerId: string, frame: number) => string;
  moveLayerKeyframe: (layerId: string, keyframeId: string, frame: number) => void;
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
  updateLayerPaint: (layerId: string, frame: number, paint: Paint) => void;
  updateLayerEffects: (layerId: string, frame: number, patch: Partial<LayerEffects>) => void;
  renameLayer: (layerId: string, name: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerGuide: (layerId: string) => void;
  setLayerBlendMode: (layerId: string, blendMode: BlendMode) => void;
  toggleLayerLock: (layerId: string) => void;
  groupLayers: (layerIds: string[]) => string | null;
  ungroupLayers: (layerIds: string[]) => void;
  setLayerParent: (layerId: string, parentId: string | null) => void;
  setLayerClipChildren: (layerId: string, clipChildren: boolean) => void;
  setLayerConstraints: (layerId: string, constraints: Partial<LayerConstraints>) => void;
  setLayerSemantics: (layerId: string, patch: Partial<LayerSemantics>) => void;
  setDesignSystemName: (name: string) => void;
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
        | 'required'
        | 'options'
        | 'constraints'
        | 'fileExtensions'
      >
    >,
  ) => void;
  setLayerBindings: (layerId: string, bindings: LayerBinding[]) => void;

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

export type ProjectStore = ProjectState & ProjectActions;

export function getActiveComposition(project: Project, activeCompositionId: string): Composition {
  const composition = project.compositions.find((c) => c.id === activeCompositionId);
  if (!composition) {
    throw new Error(`Active composition not found: ${activeCompositionId}`);
  }
  return composition;
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
  easing: EasingPreset = 'ease-in-out',
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

function writeLayerTransformAtFrame(
  composition: Composition,
  layer: Layer,
  frame: number,
  patch: Partial<LayerTransform>,
): void {
  const roundedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
  let keyframe = findLayerKeyframeAtFrame(layer, roundedFrame);
  const easing = keyframe?.easing ?? 'ease-in-out';
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

export const useProjectStore = create<ProjectStore>()(
  immer((set) => {
    const initialProject = createProject();
    const initialComposition = initialProject.compositions[0]!;
    return {
      project: initialProject,
      activeCompositionId: initialProject.mainCompositionId,
      activeKeyframeId: getDefaultAuthoringKeyframeId(initialComposition),

      newProject: () => {
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
        useTimelineStore.getState().resetForProjectLoad();
        set((state) => {
          const migrated = migrateProject(project);
          state.project = migrated;
          state.activeCompositionId = migrated.mainCompositionId;
          const composition = getActiveComposition(migrated, migrated.mainCompositionId);
          state.activeKeyframeId = getDefaultAuthoringKeyframeId(composition);
        });
      },

      setProjectMeta: (patch) =>
        set((state) => {
          Object.assign(state.project, patch);
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

      addLayer: (kind) => {
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
                    )?.easing ?? 'ease-in-out',
                },
              ),
            );
          }
          materializeAnimationTracks(layer);
          composition.layers.push(layer);
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
        const pastedIds: string[] = [];
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const usedNames = new Set(composition.layers.map((layer) => layer.name));
          const idMap = new Map(layers.map((layer) => [layer.id, createId('layer')]));
          const groupMap = new Map(
            layers
              .map((layer) => layer.groupId)
              .filter((groupId): groupId is string => Boolean(groupId))
              .map((groupId) => [groupId, createId('group')]),
          );
          for (const source of layers) {
            const baseName = source.name.replace(/ copy(?: \d+)?$/, '');
            let name = `${baseName} copy`;
            let suffix = 2;
            while (usedNames.has(name)) name = `${baseName} copy ${suffix++}`;
            usedNames.add(name);

            const layer: Layer = {
              ...structuredClone(source),
              id: idMap.get(source.id)!,
              name,
              groupId: source.groupId ? (groupMap.get(source.groupId) ?? null) : null,
              parentId: source.parentId ? (idMap.get(source.parentId) ?? null) : null,
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
            composition.layers.push(layer);
            pastedIds.push(layer.id);
          }
        });
        return pastedIds;
      },

      removeLayer: (layerId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          if (composition.layers.find((layer) => layer.id === layerId)?.isLocked) return;
          composition.layers = composition.layers.filter((l) => l.id !== layerId);
          for (const layer of composition.layers) {
            if (layer.parentId === layerId) layer.parentId = null;
          }
          for (const folder of composition.layout.timelineFolders) {
            folder.layerIds = folder.layerIds.filter((candidate) => candidate !== layerId);
          }
          composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
            (folder) => folder.layerIds.length > 0,
          );
        }),

      updateLayerTransform: (layerId, frame, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (!layer || layer.isLocked) return;
          const before = getLayerTransformAtFrame(layer, frame);
          writeLayerTransformAtFrame(composition, layer, frame, patch);
          const after = getLayerTransformAtFrame(layer, frame);
          const deltaX = after.x - before.x;
          const deltaY = after.y - before.y;
          if (deltaX === 0 && deltaY === 0) return;
          for (const descendant of descendantLayers(composition, layer.id)) {
            const pose = getLayerTransformAtFrame(descendant, frame);
            writeLayerTransformAtFrame(composition, descendant, frame, {
              x: pose.x + deltaX,
              y: pose.y + deltaY,
            });
          }
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
            if (track.length > 1) {
              layer.animationTracks[property] = track.filter(
                (keyframe) => keyframe.frame !== removed.frame,
              );
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
          if (track.length <= 1) return;
          const removedFrame = track.find((candidate) => candidate.id === keyframeId)?.frame;
          layer.animationTracks[property] = track.filter(
            (candidate) => candidate.id !== keyframeId,
          );
          if (removedFrame !== undefined) removeAggregateKeyframeIfOrphaned(layer, removedFrame);
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
          layer.loop.durationFrames = nextDuration;
          if (patch.phaseOffsetFrames !== undefined) {
            layer.loop.phaseOffsetFrames = Math.round(patch.phaseOffsetFrames);
          }
          if (patch.repeatCount !== undefined) {
            layer.loop.repeatCount =
              patch.repeatCount === null ? null : Math.max(1, Math.round(patch.repeatCount));
          }
        }),

      setLayerLoopPropertyTrack: (layerId, property, keys) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked || !layer.loop) return;
          const normalized = sortLayerPropertyKeyframes(
            keys
              .map((key) => ({
                ...key,
                frame: Math.max(0, Math.min(layer.loop!.durationFrames, Math.round(key.frame))),
                ...(key.curve ? { curve: { ...key.curve } } : {}),
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

      updateLayerElement: (layerId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer && !layer.isLocked) {
            Object.assign(layer.element, patch);
            pruneInvalidGradientStopTracks(layer);
          }
        }),

      updateLayerPaint: (layerId, frame, paint) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (
            !layer ||
            layer.isLocked ||
            (layer.element.type !== 'rectangle' && layer.element.type !== 'ellipse')
          ) {
            return;
          }
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const previous = layer.element.fill;
          const previousEvaluated = getPaintAtFrame(
            previous,
            getResolvedLayerAnimationTracks(layer),
            roundedFrame,
          );
          materializeAnimationTracks(layer);
          if (typeof paint !== 'string' && typeof previous !== 'string') {
            layer.element.fill = {
              ...paint,
              stops: paint.stops.map((stop, index) => ({
                ...stop,
                offset: previous.stops[index]?.offset ?? stop.offset,
              })),
            };
            if (typeof previousEvaluated !== 'string') {
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
            layer.element.fill = paint;
          }
          pruneInvalidGradientStopTracks(layer);
        }),

      updateLayerEffects: (layerId, frame, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (!layer || layer.isLocked) return;
          const roundedFrame = Math.max(
            0,
            Math.min(getTotalFrames(composition), Math.round(frame)),
          );
          const normalized = normalizeLayerEffects({ ...layer.effects, ...patch });
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
        let newLayerIds: string[] = [];
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const definition = composition.components.find(
            (candidate) => candidate.id === componentId,
          );
          if (!definition) return;
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

      setLayerConstraints: (layerId, constraints) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((candidate) => candidate.id === layerId);
          if (layer) Object.assign(layer.constraints, constraints);
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
          for (const layer of composition.layers) {
            for (const binding of layer.designTokenBindings.filter(
              (candidate) => candidate.tokenId === token.id,
            )) {
              applyDesignTokenBinding(layer, binding, token);
            }
          }
        }),

      removeDesignToken: (tokenId) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          if (
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
            if (layer) writeLayerTransformAtFrame(composition, layer, frame, patch);
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
            if (layer) writeLayerTransformAtFrame(composition, layer, frame, patch);
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
          if (previousKeyframe && nextKeyframe) {
            composition.transitions.push(
              createTransition(previousKeyframe.id, nextKeyframe.id, {
                durationFrames: (inbound?.durationFrames ?? 0) + (outbound?.durationFrames ?? 0),
                easing: outbound?.easing ?? inbound?.easing ?? 'ease-in-out',
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
          composition.dataFields = composition.dataFields.filter((f) => f.id !== fieldId);
          for (const layer of composition.layers) {
            layer.bindings = layer.bindings.filter((binding) => binding.fieldId !== fieldId);
          }
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
        }),

      setLayerBindings: (layerId, bindings) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const layer = composition.layers.find((l) => l.id === layerId);
          if (layer && !layer.isLocked) layer.bindings = bindings;
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
          composition.customActions = composition.customActions.filter((a) => a.id !== actionDefId);
        }),

      updateCustomAction: (actionDefId, patch) =>
        set((state) => {
          const composition = getActiveComposition(state.project, state.activeCompositionId);
          const action = composition.customActions.find((a) => a.id === actionDefId);
          if (!action) return;
          const nextPatch = { ...patch };
          if (nextPatch.actionId !== undefined) {
            const trimmed = nextPatch.actionId.trim();
            const isDuplicate =
              trimmed.length === 0 ||
              composition.customActions.some((a) => a.id !== actionDefId && a.actionId === trimmed);
            if (isDuplicate) delete nextPatch.actionId;
            else nextPatch.actionId = trimmed;
          }
          Object.assign(action, nextPatch);
        }),

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
        const mimeType = (fontMime ?? file.type) || 'application/octet-stream';
        const kind = fontMime ? 'font' : mimeType.startsWith('image/') ? 'image' : 'source';
        const asset = createAsset({
          name: file.name,
          kind,
          dataUri,
          mimeType,
          originalFileName: file.name,
          byteSize: file.size || dataUriByteSize(dataUri),
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
            consumers.fontLayerIds.length > 0
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
