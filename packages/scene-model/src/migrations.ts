import {
  createFieldDefinition,
  createDefaultTransform,
  createKeyframe,
  createLayerKeyframe,
  createLayerEffects,
  createLayerSemantics,
  createTransition,
  PROJECT_DOCUMENT_VERSION,
} from './factory';
import {
  createAnimationTracksFromLegacyLayer,
  getLayerAnimatableProperties,
  isAnimatableLayerProperty,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
} from './layerAnimation';
import { normalizeAuthoredTransform } from './authoredTransform';
import { normalizeLayerEffects } from './layerEffects';
import type {
  Composition,
  Element,
  FieldDefinition,
  Keyframe,
  KeyframeRole,
  Layer,
  LayerKeyframe,
  LayerTransform,
  Project,
  Transition,
} from './types';

interface LegacyKeyframe {
  id: string;
  name: string;
  role?: KeyframeRole;
  isOutro?: boolean;
}

type LegacyLayer = Omit<
  Layer,
  | 'keyframes'
  | 'effects'
  | 'animationTracks'
  | 'loop'
  | 'isLocked'
  | 'blendMode'
  | 'groupId'
  | 'parentId'
  | 'clipChildren'
  | 'constraints'
  | 'bindings'
  | 'semantics'
  | 'designTokenBindings'
  | 'componentLink'
> & {
  keyframes?: LayerKeyframe[];
  poses?: Record<string, LayerTransform>;
  effects?: Layer['effects'];
  animationTracks?: Layer['animationTracks'];
  loop?: Layer['loop'];
  isLocked?: boolean;
  blendMode?: Layer['blendMode'];
  groupId?: string | null;
  parentId?: string | null;
  clipChildren?: boolean;
  constraints?: Layer['constraints'];
  bindings?: Layer['bindings'];
  semantics?: Layer['semantics'];
  designTokenBindings?: Layer['designTokenBindings'];
  componentLink?: Layer['componentLink'];
  /** Document v10 and older supported only one binding per layer. */
  binding?: Layer['bindings'][number] | null;
};

type LegacyComposition = Omit<
  Composition,
  'keyframes' | 'layers' | 'layout' | 'components' | 'designSystem' | 'runtimeCollections'
> & {
  keyframes: LegacyKeyframe[];
  layers: LegacyLayer[];
  layout?: Partial<Composition['layout']>;
  updateTransitionFrames?: number;
  components?: Composition['components'];
  designSystem?: Composition['designSystem'];
  runtimeCollections?: Composition['runtimeCollections'];
};

type LegacyFieldDefinition = Omit<
  FieldDefinition,
  'description' | 'options' | 'constraints' | 'fileExtensions' | 'properties' | 'items'
> &
  Partial<Pick<FieldDefinition, 'description' | 'options' | 'constraints' | 'fileExtensions'>> & {
    properties?: LegacyFieldDefinition[];
    items?: LegacyFieldDefinition | null;
  };

type LegacyProject = Omit<
  Project,
  'documentVersion' | 'compositions' | 'supportsRealTime' | 'supportsNonRealTime'
> & {
  documentVersion?: number;
  supportsRealTime?: boolean;
  supportsNonRealTime?: boolean;
  compositions: LegacyComposition[];
};

function cloneProject(project: LegacyProject): LegacyProject {
  return JSON.parse(JSON.stringify(project)) as LegacyProject;
}

function hiddenClone(pose: LayerTransform | undefined): LayerTransform | undefined {
  return pose ? { ...pose, opacity: 0 } : undefined;
}

function normalizeFieldDefinition(field: LegacyFieldDefinition): FieldDefinition {
  const properties = (field.properties ?? []).map(normalizeFieldDefinition);
  const items =
    field.items === undefined
      ? field.type === 'array'
        ? createFieldDefinition('object', { key: 'item', label: 'Item', required: true })
        : null
      : field.items === null
        ? null
        : normalizeFieldDefinition(field.items);
  return {
    ...field,
    description: field.description ?? '',
    options: field.options ?? [],
    constraints: field.constraints ?? {},
    fileExtensions: field.fileExtensions ?? [],
    properties,
    items,
  };
}

function normalizeElement(element: Element): Element {
  if (element.type !== 'text') return element;
  return {
    ...element,
    strokeColor: element.strokeColor ?? 'transparent',
    strokeWidth: element.strokeWidth ?? 0,
    lineHeight: element.lineHeight ?? 1.2,
    letterSpacing: element.letterSpacing ?? 0,
    textTransform: element.textTransform ?? 'none',
    verticalAlign: element.verticalAlign ?? 'top',
    baselineShift: element.baselineShift ?? 0,
    minFontSize: element.minFontSize ?? Math.max(1, element.fontSize * 0.5),
    overflowPolicy: element.overflowPolicy ?? 'visible',
    autoFit: element.autoFit ?? 'auto-size',
  };
}

function normalizeRoles(keyframes: LegacyKeyframe[]): Keyframe[] {
  const hasExplicitRoles = keyframes.some((keyframe) => keyframe.role !== undefined);
  if (hasExplicitRoles) {
    return keyframes.map((keyframe) => ({
      id: keyframe.id,
      name: keyframe.name,
      role: keyframe.role ?? 'step',
    }));
  }

  const nonOutroCount = keyframes.filter((keyframe) => !keyframe.isOutro).length;
  return keyframes.map((keyframe) => ({
    id: keyframe.id,
    name: keyframe.name,
    role: keyframe.isOutro && nonOutroCount > 0 ? 'end' : 'step',
  }));
}

function normalizeComposition(composition: LegacyComposition): Composition {
  const keyframes = normalizeRoles(composition.keyframes);
  const existingStart = keyframes.find((keyframe) => keyframe.role === 'start');
  const existingEnd = keyframes.find((keyframe) => keyframe.role === 'end');
  const steps = keyframes
    .filter((keyframe) => keyframe.id !== existingStart?.id && keyframe.id !== existingEnd?.id)
    .map((keyframe) => ({ ...keyframe, role: 'step' as const }));
  const start = existingStart ?? createKeyframe({ name: 'Start', role: 'start' });
  const end = existingEnd ?? createKeyframe({ name: 'End', role: 'end' });
  start.role = 'start';
  end.role = 'end';
  const normalizedKeyframes = [start, ...steps, end];

  const transitionsByEdge = new Map(
    (composition.transitions ?? []).map((transition) => [
      `${transition.fromKeyframeId}:${transition.toKeyframeId}`,
      transition,
    ]),
  );
  const transitions: Transition[] = normalizedKeyframes.slice(1).map((to, index) => {
    const from = normalizedKeyframes[index]!;
    return transitionsByEdge.get(`${from.id}:${to.id}`) ?? createTransition(from.id, to.id);
  });

  const frameByLifecycleId = new Map<string, number>([[start.id, 0]]);
  let frame = 0;
  for (const transition of transitions) {
    frame += transition.durationFrames;
    frameByLifecycleId.set(transition.toKeyframeId, frame);
  }

  const layers: Layer[] = composition.layers.map((legacyLayer) => {
    const bindings = (
      legacyLayer.bindings ?? (legacyLayer.binding ? [legacyLayer.binding] : [])
    ).map((binding) => ({
      ...binding,
      sourcePath: binding.sourcePath ?? [],
      ...(binding.valueMap ? { valueMap: { ...binding.valueMap } } : {}),
    }));
    const element = normalizeElement(legacyLayer.element);
    const effects = normalizeLayerEffects(legacyLayer.effects ?? createLayerEffects());
    if (legacyLayer.keyframes?.length) {
      const { poses: _poses, binding: _binding, bindings: _bindings, ...layer } = legacyLayer;
      const normalizedLayer: Layer = {
        ...layer,
        isLocked: legacyLayer.isLocked ?? false,
        blendMode: legacyLayer.blendMode ?? 'normal',
        groupId: legacyLayer.groupId ?? null,
        parentId: legacyLayer.parentId ?? null,
        clipChildren: legacyLayer.clipChildren ?? false,
        constraints: legacyLayer.constraints ?? { horizontal: 'left', vertical: 'top' },
        bindings,
        element,
        effects,
        semantics: createLayerSemantics(legacyLayer.semantics),
        designTokenBindings: legacyLayer.designTokenBindings ?? [],
        componentLink: legacyLayer.componentLink ?? null,
        keyframes: sortLayerKeyframes(legacyLayer.keyframes).map((keyframe) => ({
          ...keyframe,
          transform: normalizeAuthoredTransform(keyframe.transform),
        })),
        animationTracks: {},
        loop: legacyLayer.loop
          ? {
              ...legacyLayer.loop,
              durationFrames: Math.max(1, Math.round(legacyLayer.loop.durationFrames)),
              phaseOffsetFrames: Math.round(legacyLayer.loop.phaseOffsetFrames ?? 0),
              repeatCount:
                legacyLayer.loop.repeatCount == null
                  ? null
                  : Math.max(1, Math.round(legacyLayer.loop.repeatCount)),
              tracks: Object.fromEntries(
                Object.entries(legacyLayer.loop.tracks ?? {})
                  .filter(([property]) => isAnimatableLayerProperty(property))
                  .map(([property, keys]) => [
                    property,
                    sortLayerPropertyKeyframes(keys ?? []).map((keyframe) => ({
                      ...keyframe,
                      frame: Math.max(
                        0,
                        Math.min(
                          Math.max(1, Math.round(legacyLayer.loop!.durationFrames)),
                          Math.round(keyframe.frame),
                        ),
                      ),
                      value: Number(keyframe.value),
                    })),
                  ]),
              ),
            }
          : null,
      };
      const trackProperties = [
        ...new Set([
          ...getLayerAnimatableProperties(normalizedLayer),
          ...Object.keys(legacyLayer.animationTracks ?? {}).filter(isAnimatableLayerProperty),
        ]),
      ];
      const hasAnimationTracks = trackProperties.some(
        (property) => (legacyLayer.animationTracks?.[property]?.length ?? 0) > 0,
      );
      const fallbackTracks = createAnimationTracksFromLegacyLayer(normalizedLayer);
      normalizedLayer.animationTracks = hasAnimationTracks
        ? Object.fromEntries(
            trackProperties.map((property) => {
              const keys = sortLayerPropertyKeyframes(
                legacyLayer.animationTracks?.[property] ?? [],
              ).map((keyframe) => ({
                ...keyframe,
                frame: Math.round(keyframe.frame),
                value: Number(keyframe.value),
              }));
              return [
                property,
                keys.length === 0 && property === 'strokeWidth'
                  ? (fallbackTracks.strokeWidth ?? [])
                  : keys,
              ];
            }),
          )
        : fallbackTracks;
      return normalizedLayer;
    }

    const poses = legacyLayer.poses ?? {};
    if (!poses[start.id]) {
      const source = steps[0] ? poses[steps[0].id] : poses[end.id];
      poses[start.id] = hiddenClone(source) ?? createDefaultTransform({ opacity: 0 });
    }
    if (!poses[end.id]) {
      const source = steps.at(-1) ? poses[steps.at(-1)!.id] : poses[start.id];
      poses[end.id] = hiddenClone(source) ?? createDefaultTransform({ opacity: 0 });
    }

    const animationKeys = normalizedKeyframes.map((lifecycleKeyframe) => {
      const transform = poses[lifecycleKeyframe.id] ?? createDefaultTransform();
      const incoming = transitions.find(
        (transition) => transition.toKeyframeId === lifecycleKeyframe.id,
      );
      return createLayerKeyframe(frameByLifecycleId.get(lifecycleKeyframe.id) ?? 0, transform, {
        easing: incoming?.easing ?? 'ease-in-out',
      });
    });
    const {
      poses: _poses,
      keyframes: _keyframes,
      animationTracks: _animationTracks,
      binding: _binding,
      bindings: _bindings,
      ...layer
    } = legacyLayer;
    const normalizedLayer: Layer = {
      ...layer,
      isLocked: legacyLayer.isLocked ?? false,
      blendMode: legacyLayer.blendMode ?? 'normal',
      groupId: legacyLayer.groupId ?? null,
      parentId: legacyLayer.parentId ?? null,
      clipChildren: legacyLayer.clipChildren ?? false,
      constraints: legacyLayer.constraints ?? { horizontal: 'left', vertical: 'top' },
      bindings,
      element,
      effects,
      semantics: createLayerSemantics(legacyLayer.semantics),
      designTokenBindings: legacyLayer.designTokenBindings ?? [],
      componentLink: legacyLayer.componentLink ?? null,
      keyframes: animationKeys,
      animationTracks: {},
      loop: null,
    };
    normalizedLayer.animationTracks = createAnimationTracksFromLegacyLayer(normalizedLayer);
    return normalizedLayer;
  });

  return {
    ...composition,
    updateTransitionFrames: Math.max(0, Math.round(composition.updateTransitionFrames ?? 0)),
    keyframes: normalizedKeyframes,
    transitions,
    layers,
    assets: composition.assets ?? [],
    customActions: composition.customActions ?? [],
    dataFields: (composition.dataFields ?? []).map((field) =>
      normalizeFieldDefinition(field as LegacyFieldDefinition),
    ),
    runtimeCollections: (composition.runtimeCollections ?? []).map((collection) => ({
      ...collection,
      capacity: Math.max(1, Math.min(100, Math.round(collection.capacity ?? 12))),
      offsetPerItem: {
        x: Number(collection.offsetPerItem?.x ?? 0),
        y: Number(collection.offsetPerItem?.y ?? 0),
      },
      overflow: 'truncate',
    })),
    components: (composition.components ?? []).map((component) => ({
      ...component,
      dataFields: component.dataFields.map((field) =>
        normalizeFieldDefinition(field as LegacyFieldDefinition),
      ),
      layers: component.layers.map((layer) => {
        const normalizedLayer: Layer = {
          ...layer,
          element: normalizeElement(layer.element),
          blendMode: layer.blendMode ?? 'normal',
          semantics: createLayerSemantics(layer.semantics),
          designTokenBindings: layer.designTokenBindings ?? [],
          componentLink: null,
        };
        if (
          normalizedLayer.element.type === 'text' &&
          !normalizedLayer.animationTracks.strokeWidth?.length
        ) {
          normalizedLayer.animationTracks = {
            ...normalizedLayer.animationTracks,
            strokeWidth: createAnimationTracksFromLegacyLayer(normalizedLayer).strokeWidth ?? [],
          };
        }
        return normalizedLayer;
      }),
    })),
    designSystem: composition.designSystem ?? { name: 'Brand Kit', tokens: [] },
    layout: {
      showRulers: composition.layout?.showRulers ?? true,
      showActionSafe: composition.layout?.showActionSafe ?? false,
      showTitleSafe: composition.layout?.showTitleSafe ?? false,
      dimOutsideCanvas: composition.layout?.dimOutsideCanvas ?? false,
      snappingEnabled: composition.layout?.snappingEnabled ?? true,
      snapToGrid: composition.layout?.snapToGrid ?? false,
      snapToGuides: composition.layout?.snapToGuides ?? true,
      snapToLayers: composition.layout?.snapToLayers ?? true,
      gridSize: composition.layout?.gridSize ?? 10,
      snapThreshold: composition.layout?.snapThreshold ?? 6,
      boundsMode: composition.layout?.boundsMode ?? 'allow',
      overflowPreview: composition.layout?.overflowPreview ?? 'visible',
      guides: composition.layout?.guides ?? [],
      timelineFolders: (composition.layout?.timelineFolders ?? []).map((folder) => ({
        ...folder,
        layerIds: [...new Set(folder.layerIds)].filter((layerId) =>
          layers.some((layer) => layer.id === layerId),
        ),
      })),
    },
  };
}

/** Upgrade an editor project without mutating the parsed/autosaved source object. */
export function migrateProject(project: Project | LegacyProject): Project {
  const cloned = cloneProject(project as LegacyProject);
  return {
    ...cloned,
    documentVersion: PROJECT_DOCUMENT_VERSION,
    supportsRealTime: cloned.supportsRealTime ?? true,
    supportsNonRealTime: cloned.supportsNonRealTime ?? true,
    compositions: cloned.compositions.map(normalizeComposition),
  };
}
