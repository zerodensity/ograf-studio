import {
  EFFECT_ANIMATION_PROPERTIES,
  assertMaskSourcesRemovable,
  layerMaskErrors,
  TRANSFORM_ANIMATION_PROPERTIES,
  applyDesignTokenBinding,
  addEffect,
  ensureLegacyEffects,
  updateEffect,
  removeEffect,
  duplicateEffect,
  reorderEffects,
  effectProperty,
  bindFieldDefaultToken,
  syncDesignTokenFieldDefaults,
  applyStylePack,
  setTilingPattern,
  removeTilingPattern,
  addTilingPatternLayer,
  removeStylePack,
  computeKeyframeFrames,
  buildComponentDefinition,
  createCustomActionDefinition,
  createFieldDefinition,
  createFieldDefinitionFromInput,
  defaultConstraintsForFieldType,
  defaultOptionsForFieldType,
  defaultValueForFieldType,
  createAsset,
  createId,
  createKeyframe,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createTransition,
  defaultTransformForRole,
  findLayerKeyframeAtFrame,
  getLayerAnimatableProperties,
  getLayerEffectsAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  gradientStopIndexForProperty,
  normalizeAuthoredTransformPatch,
  normalizeCornerRadii,
  normalizeLayerEffects,
  instantiateComponentDefinition,
  materializeBug,
  materializeClock,
  materializeLowerThird,
  materializeScoreboard,
  materializeTicker,
  materializeRepeater,
  normalizeDesignTokenValue,
  planLifecycleRetime,
  pruneInvalidGradientStopTracks,
  refreshComponentInstances,
  resizeConstrainedTransform,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
  type AnimatableLayerProperty,
  type Composition,
  type EasingPreset,
  type Layer,
  type MaterializedBroadcastRecipe,
  type MaterializedLowerThird,
  type LayerPropertyKeyframe,
  type LayerTransform,
  type Project,
} from '@ograf-editor/scene-model';
import type { AuthoringChangeSummary, AuthoringOperation } from './types';

const clone = <T>(value: T): T => structuredClone(value);

function compositionFor(project: Project, compositionId?: string): Composition {
  const id = compositionId ?? project.mainCompositionId;
  const composition = project.compositions.find((candidate) => candidate.id === id);
  if (!composition) throw new Error(`Composition not found: ${id}`);
  return composition;
}

function layerFor(composition: Composition, layerId: string): Layer {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Layer not found: ${layerId}`);
  return layer;
}

function assertUnlocked(layer: Layer): void {
  if (layer.isLocked) throw new Error(`Layer is locked: ${layer.id}`);
}

function assertCollectionCapacity(capacity: number): number {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    throw new Error('Runtime collection capacity must be an integer from 1 to 100.');
  }
  return capacity;
}

function assertRuntimeCollectionPrototype(
  composition: Composition,
  layerIds: string[],
  collectionId?: string,
): void {
  if (layerIds.length === 0 || new Set(layerIds).size !== layerIds.length) {
    throw new Error('Runtime collection prototype layers must be non-empty and unique.');
  }
  const layers = layerIds.map((layerId) => layerFor(composition, layerId));
  if (layers.some((layer) => layer.isGuide)) {
    throw new Error('Runtime collection prototypes cannot contain guide layers.');
  }
  const groups = new Set(layers.map((layer) => layer.groupId));
  if (groups.size !== 1 || groups.has(null)) {
    throw new Error('Runtime collection prototype layers must share one persistent group.');
  }
  const indexes = layers
    .map((layer) => composition.layers.findIndex((candidate) => candidate.id === layer.id))
    .sort((left, right) => left - right);
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) {
    throw new Error('Runtime collection prototype layers must be contiguous in paint order.');
  }
  const conflict = composition.runtimeCollections.find(
    (collection) =>
      collection.id !== collectionId &&
      collection.prototypeLayerIds.some((layerId) => layerIds.includes(layerId)),
  );
  if (conflict)
    throw new Error(`Prototype layer already belongs to runtime collection: ${conflict.name}`);
}

function descendantsFor(composition: Composition, parentId: string): Layer[] {
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

function frameInComposition(composition: Composition, frame: number): number {
  if (!Number.isFinite(frame)) throw new Error('Frame must be finite.');
  return Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
}

function materializeTracks(layer: Layer): void {
  layer.animationTracks = Object.fromEntries(
    Object.entries(getResolvedLayerAnimationTracks(layer)).map(([property, keys]) => [
      property,
      keys?.map((key) => ({ ...key, ...(key.curve ? { curve: { ...key.curve } } : {}) })) ?? [],
    ]),
  );
}

function upsertPropertyKey(
  layer: Layer,
  property: AnimatableLayerProperty,
  frame: number,
  value: number,
  easing: EasingPreset = 'ease-in-out',
): LayerPropertyKeyframe {
  assertPropertyApplicable(layer, property, value);
  materializeTracks(layer);
  const track = layer.animationTracks[property] ?? [];
  let key = track.find((candidate) => candidate.frame === frame);
  if (key) key.value = value;
  else {
    key = createLayerPropertyKeyframe(frame, value, { easing });
    track.push(key);
  }
  layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
  return key;
}

function assertPropertyApplicable(
  layer: Layer,
  property: AnimatableLayerProperty,
  value?: number,
): void {
  if (property === 'strokeWidth') {
    if (layer.element.type !== 'text') {
      throw new Error(
        `Property "strokeWidth" is supported only by text layers; "${layer.name}" is ${layer.element.type}.`,
      );
    }
    if (value !== undefined && value < 0) {
      throw new Error('Text stroke width must be non-negative.');
    }
    return;
  }
  const stopIndex = gradientStopIndexForProperty(property);
  if (stopIndex === null) return;
  const fill =
    layer.element.type === 'rectangle' ||
    layer.element.type === 'ellipse' ||
    layer.element.type === 'path' ||
    layer.element.type === 'pattern'
      ? layer.element.fill
      : null;
  if (!fill || typeof fill === 'string' || !fill.stops[stopIndex]) {
    throw new Error(
      `Property "${property}" requires gradient stop ${stopIndex} on layer "${layer.name}".`,
    );
  }
  if (value !== undefined && (value < 0 || value > 1)) {
    throw new Error(`Gradient stop offsets must be from 0 to 1.`);
  }
}

function syncAggregateKey(layer: Layer, frame: number, easing: EasingPreset): void {
  let aggregate = findLayerKeyframeAtFrame(layer, frame);
  if (!aggregate) {
    aggregate = createLayerKeyframe(frame, getLayerTransformAtFrame(layer, frame), { easing });
    layer.keyframes.push(aggregate);
    layer.keyframes = sortLayerKeyframes(layer.keyframes);
  } else aggregate.transform = getLayerTransformAtFrame(layer, frame);
}

type PropertyTrackInput = Extract<AuthoringOperation, { type: 'set_property_track' }>['keys'];

function applyPropertyTrack(
  composition: Composition,
  layer: Layer,
  property: AnimatableLayerProperty,
  keys: PropertyTrackInput,
  replace = true,
): LayerPropertyKeyframe[] {
  materializeTracks(layer);
  const normalized = keys.map((input) => ({
    ...input,
    frame: frameInComposition(composition, input.frame),
  }));
  if (new Set(normalized.map((key) => key.frame)).size !== normalized.length) {
    throw new Error('A property track cannot contain multiple keys at the same resolved frame.');
  }
  if (normalized.some((key) => !Number.isFinite(key.value))) {
    throw new Error('Property track values must be finite.');
  }
  for (const key of normalized) assertPropertyApplicable(layer, property, key.value);

  const affected: LayerPropertyKeyframe[] = [];
  if (replace) {
    layer.animationTracks[property] = sortLayerPropertyKeyframes(
      normalized.map((input) => {
        const key = createLayerPropertyKeyframe(input.frame, input.value, {
          easing: input.easing ?? 'ease-in-out',
        });
        if (input.curve !== undefined && input.curve !== null) key.curve = clone(input.curve);
        affected.push(key);
        return key;
      }),
    );
  } else {
    for (const input of normalized) {
      const key = upsertPropertyKey(layer, property, input.frame, input.value, input.easing);
      if (input.easing !== undefined) key.easing = input.easing;
      if (input.curve === null) delete key.curve;
      else if (input.curve !== undefined) key.curve = clone(input.curve);
      affected.push(key);
    }
  }

  for (const aggregate of layer.keyframes) {
    syncAggregateKey(layer, aggregate.frame, aggregate.easing);
  }
  for (const key of affected) syncAggregateKey(layer, key.frame, key.easing);
  return affected;
}

function applyLoopPropertyTrack(
  layer: Layer,
  property: AnimatableLayerProperty,
  keys: Extract<AuthoringOperation, { type: 'set_loop_property_track' }>['keys'],
  replace = true,
): LayerPropertyKeyframe[] {
  const loop = layer.loop;
  if (!loop) throw new Error(`Layer "${layer.name}" has no loop clip.`);
  if (keys.some((key) => !Number.isFinite(key.value))) {
    throw new Error('Loop property values must be finite.');
  }
  const normalized = keys.map((input) => ({ ...input, frame: Math.round(input.frame) }));
  if (normalized.some((key) => key.frame < 0 || key.frame > loop.durationFrames)) {
    throw new Error(`Loop keys must stay inside local frames 0..${loop.durationFrames}.`);
  }
  if (new Set(normalized.map((key) => key.frame)).size !== normalized.length) {
    throw new Error('A loop property track cannot contain multiple keys at the same frame.');
  }
  for (const key of normalized) assertPropertyApplicable(layer, property, key.value);

  const existing = loop.tracks[property] ?? [];
  const affected: LayerPropertyKeyframe[] = [];
  if (replace) {
    loop.tracks[property] = sortLayerPropertyKeyframes(
      normalized.map((input) => {
        const key = createLayerPropertyKeyframe(input.frame, input.value, {
          easing: input.easing ?? 'ease-in-out',
        });
        if (input.curve != null) key.curve = clone(input.curve);
        affected.push(key);
        return key;
      }),
    );
  } else {
    for (const input of normalized) {
      let key = existing.find((candidate) => candidate.frame === input.frame);
      if (!key) {
        key = createLayerPropertyKeyframe(input.frame, input.value, {
          easing: input.easing ?? 'ease-in-out',
        });
        existing.push(key);
      } else {
        key.value = input.value;
        if (input.easing !== undefined) key.easing = input.easing;
      }
      if (input.curve === null) delete key.curve;
      else if (input.curve !== undefined) key.curve = clone(input.curve);
      affected.push(key);
    }
    loop.tracks[property] = sortLayerPropertyKeyframes(existing);
  }
  return affected;
}

function bakeResponsiveResize(
  composition: Composition,
  newSize: { width: number; height: number },
): void {
  const oldSize = { width: composition.width, height: composition.height };
  if (oldSize.width === newSize.width && oldSize.height === newSize.height) return;
  for (const layer of composition.layers) {
    const tracks = getResolvedLayerAnimationTracks(layer);
    const frames = new Set(layer.keyframes.map((keyframe) => keyframe.frame));
    for (const property of ['x', 'y', 'width', 'height'] as const) {
      for (const keyframe of tracks[property] ?? []) frames.add(keyframe.frame);
    }
    const resized = [...frames].map((frame) => ({
      frame,
      pose: resizeConstrainedTransform(
        getLayerTransformAtFrame(layer, frame),
        layer.constraints,
        oldSize,
        newSize,
      ),
    }));
    for (const { frame, pose } of resized) {
      const easing = findLayerKeyframeAtFrame(layer, frame)?.easing ?? 'ease-in-out';
      for (const property of ['x', 'y', 'width', 'height'] as const) {
        upsertPropertyKey(layer, property, frame, pose[property], easing);
      }
      syncAggregateKey(layer, frame, easing);
    }
  }
}

function addLayer(
  composition: Composition,
  operation: Extract<AuthoringOperation, { type: 'add_layer' }>,
): string {
  const layer = createLayerOfKind(operation.kind);
  if (operation.id !== undefined) {
    if (composition.layers.some((candidate) => candidate.id === operation.id)) {
      throw new Error(`Layer id already exists: ${operation.id}`);
    }
    layer.id = operation.id;
  }
  if (operation.name !== undefined) layer.name = operation.name.trim() || layer.name;
  const lifecycleFrames = computeKeyframeFrames(composition);
  for (const [index, lifecycle] of composition.keyframes.entries()) {
    const transform = {
      ...defaultTransformForRole(operation.kind, lifecycle.role),
      ...operation.transform,
    };
    layer.keyframes.push(
      createLayerKeyframe(lifecycleFrames[index]?.frame ?? 0, transform, {
        easing:
          composition.transitions.find((transition) => transition.toKeyframeId === lifecycle.id)
            ?.easing ?? 'ease-in-out',
      }),
    );
  }
  if (operation.element) {
    const elementPatch = { ...operation.element };
    if (layer.element.type === 'rectangle' && elementPatch.borderRadius !== undefined) {
      elementPatch.borderRadius = normalizeCornerRadii(elementPatch.borderRadius as never);
    }
    Object.assign(layer.element, elementPatch);
  }
  if (operation.effects)
    layer.effects = normalizeLayerEffects({ ...layer.effects, ...operation.effects });
  materializeTracks(layer);
  const index = Math.max(
    0,
    Math.min(composition.layers.length, operation.index ?? composition.layers.length),
  );
  composition.layers.splice(index, 0, layer);
  return layer.id;
}

function warnForDegenerateShrinkToFit(
  summary: AuthoringChangeSummary,
  layer: Layer,
  frames: number[],
  operationIndex: number,
): void {
  if (layer.element.type !== 'text' || layer.element.autoFit !== 'shrink-to-fit') return;
  for (const frame of frames) {
    const height = getLayerTransformAtFrame(layer, frame).height;
    const ratio = height / layer.element.fontSize;
    if (ratio < 1.3) {
      summary.warnings.push(
        `Operation ${operationIndex}: shrink-to-fit warning for text layer "${layer.name}": height/fontSize ratio ${ratio.toFixed(3)} at frame ${frame}; ratios below 1.3 can require the 50% legibility clamp and overflow.`,
      );
    }
  }
}

function operationFrames(
  composition: Composition,
  scope: 'authored' | 'frame' | undefined,
  frame: number | undefined,
): number[] {
  if ((scope ?? 'authored') === 'frame') {
    if (frame === undefined) throw new Error('frame is required when scope="frame".');
    return [frameInComposition(composition, frame)];
  }
  return [...new Set(computeKeyframeFrames(composition).map((item) => item.frame))];
}

function literalRewrite(
  value: string,
  rewrite: { from: string; to: string } | undefined,
  n: number,
): string {
  if (!rewrite) return value;
  return value.replaceAll(rewrite.from, rewrite.to.replaceAll('{n}', String(n)));
}

function duplicateSourceLayers(
  composition: Composition,
  source: Extract<AuthoringOperation, { type: 'duplicate_group' }>['source'],
): Layer[] {
  if ('groupId' in source) {
    return composition.layers.filter((layer) => layer.groupId === source.groupId);
  }
  if ('parentId' in source) {
    return composition.layers.filter((layer) => layer.parentId === source.parentId);
  }
  const wanted = new Set(source.layerIds);
  if (wanted.size !== source.layerIds.length) {
    throw new Error('duplicate_group source.layerIds cannot contain duplicates.');
  }
  const layers = composition.layers.filter((layer) => wanted.has(layer.id));
  const missing = source.layerIds.filter((id) => !layers.some((layer) => layer.id === id));
  if (missing.length > 0)
    throw new Error(`duplicate_group source layers not found: ${missing.join(', ')}`);
  return layers;
}

function duplicateGroup(
  composition: Composition,
  operation: Extract<AuthoringOperation, { type: 'duplicate_group' }>,
  operationIndex: number,
  summary: AuthoringChangeSummary,
): void {
  const sources = duplicateSourceLayers(composition, operation.source);
  if (sources.length === 0) throw new Error('duplicate_group source matched no layers.');
  for (const layer of sources) assertUnlocked(layer);

  const totalFrames = getTotalFrames(composition);
  const sourceIds = new Set(sources.map((layer) => layer.id));
  const bindings = operation.bindings ?? 'clone';
  const offsetX = operation.transformOffset?.x ?? 0;
  const offsetY = operation.transformOffset?.y ?? 0;
  const frameOffset = operation.frameOffset ?? 0;
  const lifecycleFrames = new Set(computeKeyframeFrames(composition).map((item) => item.frame));
  const copies: AuthoringChangeSummary['duplicateGroups'][number]['copies'] = [];
  const firstToken = /^\S+\s+/.exec(sources[0]?.name ?? '')?.[0] ?? '';
  const sharedToken = firstToken && sources.every((layer) => layer.name.startsWith(firstToken));

  for (let copyIndex = 1; copyIndex <= operation.count; copyIndex++) {
    const n = copyIndex + 1;
    const frameShift = frameOffset * copyIndex;
    const xShift = offsetX * copyIndex;
    const yShift = offsetY * copyIndex;
    const layerIds: Record<string, string> = {};
    const fieldIds: Record<string, string> = {};
    const groupId = createId('group');

    for (const source of sources) layerIds[source.id] = createId('layer');

    if (bindings === 'clone') {
      const boundFieldIds = [
        ...new Set(sources.flatMap((layer) => layer.bindings.map((binding) => binding.fieldId))),
      ];
      for (const sourceFieldId of boundFieldIds) {
        const sourceField = composition.dataFields.find((field) => field.id === sourceFieldId);
        if (!sourceField)
          throw new Error(`duplicate_group binding field not found: ${sourceFieldId}`);
        const field = clone(sourceField);
        field.id = createId('field');
        field.key = literalRewrite(sourceField.key, operation.fieldKeyRewrite, n);
        field.label = literalRewrite(sourceField.label, operation.labelRewrite, n);
        if (typeof field.defaultValue === 'string') {
          field.defaultValue = literalRewrite(field.defaultValue, operation.labelRewrite, n);
        }
        if (composition.dataFields.some((candidate) => candidate.key === field.key)) {
          throw new Error(`duplicate_group would create duplicate data field key: ${field.key}`);
        }
        composition.dataFields.push(field);
        fieldIds[sourceField.id] = field.id;
        summary.generatedIds.push({ operationIndex, kind: 'field', id: field.id });
      }
    }

    const clones = sources.map((source) => {
      const layer = clone(source);
      layer.id = layerIds[source.id]!;
      const rewrittenName = literalRewrite(source.name, operation.labelRewrite, n);
      if (operation.namePattern !== undefined) {
        const pattern = operation.namePattern.replaceAll('{n}', String(n));
        layer.name = pattern.includes('{name}')
          ? pattern.replaceAll('{name}', rewrittenName)
          : sharedToken
            ? `${pattern}${rewrittenName.slice(firstToken.length)}`
            : `${pattern}${rewrittenName}`;
      } else layer.name = rewrittenName;
      layer.groupId = groupId;
      layer.parentId =
        source.parentId && sourceIds.has(source.parentId)
          ? layerIds[source.parentId]!
          : source.parentId;
      const shiftedAggregateKeys = new Map<number, (typeof layer.keyframes)[number]>();
      layer.mask = source.mask
        ? {
            ...source.mask,
            sourceLayerId: layerIds[source.mask.sourceLayerId] ?? source.mask.sourceLayerId,
          }
        : null;
      const orderedAggregateKeys = [
        ...layer.keyframes.filter((key) => lifecycleFrames.has(key.frame)),
        ...layer.keyframes.filter((key) => !lifecycleFrames.has(key.frame)),
      ];
      for (const key of orderedAggregateKeys) {
        const frame = lifecycleFrames.has(key.frame) ? key.frame : key.frame + frameShift;
        if (frame < 0 || frame > totalFrames) {
          throw new Error(
            `duplicate_group copy ${n} would move layer "${source.name}" key from frame ${key.frame} to ${frame}, outside 0..${totalFrames}.`,
          );
        }
        shiftedAggregateKeys.set(frame, {
          ...key,
          id: createId('layer-key'),
          frame,
          transform: {
            ...key.transform,
            x: key.transform.x + xShift,
            y: key.transform.y + yShift,
          },
        });
      }
      layer.keyframes = sortLayerKeyframes([...shiftedAggregateKeys.values()]);
      layer.animationTracks = Object.fromEntries(
        Object.entries(layer.animationTracks).map(([property, keys]) => [
          property,
          (() => {
            const shiftedKeys = new Map<number, LayerPropertyKeyframe>();
            const orderedKeys = [
              ...(keys ?? []).filter((key) => lifecycleFrames.has(key.frame)),
              ...(keys ?? []).filter((key) => !lifecycleFrames.has(key.frame)),
            ];
            for (const key of orderedKeys) {
              const frame = lifecycleFrames.has(key.frame) ? key.frame : key.frame + frameShift;
              if (frame < 0 || frame > totalFrames) {
                throw new Error(
                  `duplicate_group copy ${n} would move layer "${source.name}" property "${property}" key from frame ${key.frame} to ${frame}, outside 0..${totalFrames}.`,
                );
              }
              shiftedKeys.set(frame, {
                ...key,
                id: createId('property-key'),
                frame,
                value:
                  property === 'x'
                    ? key.value + xShift
                    : property === 'y'
                      ? key.value + yShift
                      : key.value,
              });
            }
            return sortLayerPropertyKeyframes([...shiftedKeys.values()]);
          })(),
        ]),
      );
      if (layer.loop) {
        layer.loop.id = createId('layer-loop');
        layer.loop.tracks = Object.fromEntries(
          Object.entries(layer.loop.tracks).map(([property, keys]) => [
            property,
            (keys ?? []).map((key) => ({
              ...key,
              id: createId('loop-property-key'),
              value:
                property === 'x'
                  ? key.value + xShift
                  : property === 'y'
                    ? key.value + yShift
                    : key.value,
              ...(key.curve ? { curve: { ...key.curve } } : {}),
            })),
          ]),
        );
      }
      for (const aggregate of layer.keyframes) {
        aggregate.transform = getLayerTransformAtFrame(layer, aggregate.frame);
      }
      if (layer.element.type === 'text') {
        layer.element.content = literalRewrite(layer.element.content, operation.labelRewrite, n);
      }
      if (bindings === 'clear') layer.bindings = [];
      else if (bindings === 'clone') {
        layer.bindings = layer.bindings.map((binding) => ({
          ...binding,
          fieldId: fieldIds[binding.fieldId]!,
        }));
      }
      summary.generatedIds.push({ operationIndex, kind: 'layer', id: layer.id });
      summary.affectedLayerIds.push(layer.id);
      return layer;
    });
    composition.layers.push(...clones);
    copies.push({ n, groupId, layers: layerIds, fields: fieldIds });
  }
  summary.duplicateGroups.push({ operationIndex, copies });
}

function recordOperation(summary: AuthoringChangeSummary, operation: AuthoringOperation): void {
  summary.operationTypes.push(operation.type);
  const compositionId = 'compositionId' in operation ? operation.compositionId : undefined;
  if (compositionId) summary.affectedCompositionIds.push(compositionId);
  if ('layerId' in operation) summary.affectedLayerIds.push(operation.layerId);
  if ('layerIds' in operation && Array.isArray(operation.layerIds)) {
    summary.affectedLayerIds.push(...operation.layerIds);
  }
  if ('frame' in operation && typeof operation.frame === 'number') {
    summary.affectedFrames.push(Math.round(operation.frame));
  }
  if ('keys' in operation) {
    const offsets =
      operation.type === 'stagger_property_track'
        ? operation.layerIds.map((_, index) => index * operation.frameOffset)
        : [0];
    for (const offset of offsets) {
      summary.affectedFrames.push(...operation.keys.map((key) => Math.round(key.frame + offset)));
    }
  }
}

function recordSemanticBlock(
  summary: AuthoringChangeSummary,
  operationIndex: number,
  block: MaterializedLowerThird | MaterializedBroadcastRecipe,
): void {
  const layerIds = Object.values(block.layers);
  const fieldIds = Object.values(block.fields);
  summary.affectedLayerIds.push(...layerIds);
  for (const id of layerIds) summary.generatedIds.push({ operationIndex, kind: 'layer', id });
  for (const id of fieldIds) summary.generatedIds.push({ operationIndex, kind: 'field', id });
  summary.generatedIds.push({ operationIndex, kind: 'canvas-group', id: block.groupId });
  summary.generatedIds.push({
    operationIndex,
    kind: 'timeline-group',
    id: block.timelineGroupId,
  });
  summary.semanticBlocks.push({ operationIndex, ...block });
}

export function applyAuthoringOperations(
  source: Project,
  operations: AuthoringOperation[],
): { project: Project; summary: AuthoringChangeSummary } {
  if (operations.length === 0) throw new Error('At least one authoring operation is required.');
  const project = clone(source);
  const summary: AuthoringChangeSummary = {
    operationCount: operations.length,
    operationTypes: [],
    affectedCompositionIds: [],
    affectedLayerIds: [],
    affectedFrames: [],
    generatedIds: [],
    clearedBindings: [],
    warnings: [],
    duplicateGroups: [],
    componentInstances: [],
    semanticBlocks: [],
    stylePacks: [],
    repeaters: [],
  };

  operations.forEach((operation, operationIndex) => {
    recordOperation(summary, operation);
    if (operation.type === 'set_project_metadata') {
      if (operation.id !== undefined) project.id = operation.id;
      if (operation.name !== undefined) project.name = operation.name;
      if (operation.description !== undefined) project.description = operation.description;
      if (operation.version !== undefined) project.version = operation.version;
      if (operation.author !== undefined) project.author = clone(operation.author);
      if (operation.supportsRealTime !== undefined)
        project.supportsRealTime = operation.supportsRealTime;
      if (operation.supportsNonRealTime !== undefined)
        project.supportsNonRealTime = operation.supportsNonRealTime;
      return;
    }

    const composition = compositionFor(project, operation.compositionId);
    summary.affectedCompositionIds.push(composition.id);
    switch (operation.type) {
      case 'set_composition':
        bakeResponsiveResize(composition, {
          width: operation.width ?? composition.width,
          height: operation.height ?? composition.height,
        });
        if (operation.name !== undefined) composition.name = operation.name;
        if (operation.width !== undefined) composition.width = operation.width;
        if (operation.height !== undefined) composition.height = operation.height;
        if (operation.frameRate !== undefined) composition.frameRate = operation.frameRate;
        if (operation.updateTransitionFrames !== undefined)
          composition.updateTransitionFrames = Math.max(
            0,
            Math.round(operation.updateTransitionFrames),
          );
        if (operation.backgroundColor !== undefined)
          composition.backgroundColor = operation.backgroundColor;
        break;
      case 'set_composition_layout':
        Object.assign(composition.layout, operation.patch);
        break;
      case 'set_design_system_name': {
        const name = operation.name.trim();
        if (!name) throw new Error('Design-system name cannot be empty.');
        composition.designSystem.name = name;
        break;
      }
      case 'upsert_design_token': {
        const key = operation.key.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) {
          throw new Error(
            'Design-token key must start with a letter or underscore and contain only letters, numbers, dot, dash, or underscore.',
          );
        }
        const conflicting = composition.designSystem.tokens.find(
          (candidate) => candidate.key === key && candidate.id !== operation.tokenId,
        );
        if (conflicting) throw new Error(`Design-token key already exists: ${key}`);
        const value = normalizeDesignTokenValue(operation.tokenType, operation.value);
        const existing = operation.tokenId
          ? composition.designSystem.tokens.find((candidate) => candidate.id === operation.tokenId)
          : undefined;
        if (operation.tokenId && !existing) {
          throw new Error(`Design token not found: ${operation.tokenId}`);
        }
        if (existing) {
          existing.key = key;
          existing.name = operation.name?.trim() || key;
          existing.type = operation.tokenType;
          existing.value = value;
          existing.description = operation.description?.trim() ?? existing.description;
          syncDesignTokenFieldDefaults(composition, existing.id);
          for (const layer of composition.layers) {
            for (const binding of layer.designTokenBindings.filter(
              (candidate) => candidate.tokenId === existing.id,
            )) {
              applyDesignTokenBinding(layer, binding, existing);
              summary.affectedLayerIds.push(layer.id);
            }
          }
        } else {
          if (
            operation.id &&
            composition.designSystem.tokens.some((candidate) => candidate.id === operation.id)
          ) {
            throw new Error(`Design-token ID already exists: ${operation.id}`);
          }
          const token = {
            id: operation.id ?? createId('design-token'),
            key,
            name: operation.name?.trim() || key,
            type: operation.tokenType,
            value,
            description: operation.description?.trim() ?? '',
          };
          composition.designSystem.tokens.push(token);
          summary.generatedIds.push({
            operationIndex,
            kind: 'design-token',
            id: token.id,
          });
        }
        break;
      }
      case 'remove_design_token': {
        const token = composition.designSystem.tokens.find(
          (candidate) => candidate.id === operation.tokenId,
        );
        if (!token) throw new Error(`Design token not found: ${operation.tokenId}`);
        const consumers = composition.layers.filter((layer) =>
          layer.designTokenBindings.some((binding) => binding.tokenId === token.id),
        );
        const defaultConsumers = composition.dataFields.filter(
          (field) => field.defaultTokenId === token.id,
        );
        if ((consumers.length > 0 || defaultConsumers.length > 0) && !operation.force) {
          throw new Error(
            `Design token "${token.key}" is bound by ${consumers.length} layer(s); use force=true to remove the links while preserving materialized values.`,
          );
        }
        for (const layer of consumers) {
          layer.designTokenBindings = layer.designTokenBindings.filter(
            (binding) => binding.tokenId !== token.id,
          );
          summary.affectedLayerIds.push(layer.id);
        }
        for (const field of defaultConsumers) delete field.defaultTokenId;
        composition.designSystem.tokens = composition.designSystem.tokens.filter(
          (candidate) => candidate.id !== token.id,
        );
        break;
      }
      case 'bind_design_token': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const token = operation.tokenId
          ? composition.designSystem.tokens.find((candidate) => candidate.id === operation.tokenId)
          : composition.designSystem.tokens.find(
              (candidate) => candidate.key === operation.tokenKey,
            );
        if (!token) {
          throw new Error(
            `Design token not found: ${operation.tokenId ?? operation.tokenKey ?? '(missing selector)'}`,
          );
        }
        applyDesignTokenBinding(
          layer,
          { tokenId: token.id, targetProperty: operation.targetProperty },
          token,
        );
        layer.designTokenBindings = [
          ...layer.designTokenBindings.filter(
            (binding) => binding.targetProperty !== operation.targetProperty,
          ),
          { tokenId: token.id, targetProperty: operation.targetProperty },
        ];
        summary.affectedLayerIds.push(layer.id);
        break;
      }
      case 'unbind_design_token': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        layer.designTokenBindings = layer.designTokenBindings.filter(
          (binding) => binding.targetProperty !== operation.targetProperty,
        );
        summary.affectedLayerIds.push(layer.id);
        break;
      }
      case 'add_lifecycle_step': {
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
        const stepNumber =
          composition.keyframes.filter((keyframe) => keyframe.role === 'step').length + 1;
        const keyframe = createKeyframe({
          name: operation.name?.trim() || `Step ${stepNumber}`,
          role: 'step',
        });
        composition.keyframes.splice(insertionIndex, 0, keyframe);
        if (replacedTransition) {
          composition.transitions = composition.transitions.filter(
            (transition) => transition.id !== replacedTransition.id,
          );
        }
        if (previousKeyframe) {
          composition.transitions.push(
            createTransition(previousKeyframe.id, keyframe.id, {
              durationFrames: replacedTransition?.durationFrames ?? 12,
              easing: replacedTransition?.easing ?? 'ease-in-out',
            }),
          );
        }
        if (nextKeyframe) {
          composition.transitions.push(createTransition(keyframe.id, nextKeyframe.id));
        }
        summary.generatedIds.push({
          operationIndex,
          kind: 'lifecycle-keyframe',
          id: keyframe.id,
        });
        break;
      }
      case 'rename_lifecycle_keyframe': {
        const keyframe = composition.keyframes.find(
          (candidate) => candidate.id === operation.keyframeId,
        );
        if (!keyframe) throw new Error(`Lifecycle keyframe not found: ${operation.keyframeId}`);
        const name = operation.name.trim();
        if (!name) throw new Error('Lifecycle keyframe name cannot be empty.');
        keyframe.name = name;
        break;
      }
      case 'move_lifecycle_keyframe': {
        const plan = planLifecycleRetime(composition, operation.keyframeId, operation.frame);
        if (!plan) {
          throw new Error(`Lifecycle keyframe cannot be moved: ${operation.keyframeId}`);
        }
        for (const update of plan.transitionUpdates) {
          const transition = composition.transitions.find(
            (candidate) => candidate.id === update.transitionId,
          );
          if (transition) transition.durationFrames = update.durationFrames;
        }
        summary.affectedFrames.push(plan.currentFrame, plan.targetFrame);
        summary.warnings.push(
          ...plan.warnings.map((warning) => `Operation ${operationIndex}: ${warning}`),
        );
        break;
      }
      case 'remove_lifecycle_step': {
        const index = composition.keyframes.findIndex(
          (candidate) => candidate.id === operation.keyframeId,
        );
        const keyframe = composition.keyframes[index];
        if (!keyframe) throw new Error(`Lifecycle keyframe not found: ${operation.keyframeId}`);
        if (keyframe.role !== 'step') throw new Error('Only pausable Step states can be removed.');
        const removedFrame = computeKeyframeFrames(composition)[index]?.frame ?? 0;
        const previous = composition.keyframes[index - 1];
        const next = composition.keyframes[index + 1];
        const inbound = composition.transitions.find(
          (transition) => transition.toKeyframeId === keyframe.id,
        );
        const outbound = composition.transitions.find(
          (transition) => transition.fromKeyframeId === keyframe.id,
        );
        composition.keyframes.splice(index, 1);
        composition.transitions = composition.transitions.filter(
          (transition) =>
            transition.fromKeyframeId !== keyframe.id && transition.toKeyframeId !== keyframe.id,
        );
        if (previous && next) {
          composition.transitions.push(
            createTransition(previous.id, next.id, {
              durationFrames: (inbound?.durationFrames ?? 0) + (outbound?.durationFrames ?? 0),
              easing: outbound?.easing ?? inbound?.easing ?? 'ease-in-out',
            }),
          );
        }
        const retainedKeys = composition.layers.reduce(
          (count, layer) =>
            count +
            Object.values(getResolvedLayerAnimationTracks(layer)).reduce(
              (layerCount, keys) =>
                layerCount + (keys ?? []).filter((key) => key.frame === removedFrame).length,
              0,
            ),
          0,
        );
        if (retainedKeys > 0) {
          summary.warnings.push(
            `Operation ${operationIndex}: removed Step at frame ${removedFrame}; ${retainedKeys} layer property ${retainedKeys === 1 ? 'key remains' : 'keys remain'} at that authored frame.`,
          );
        }
        summary.affectedFrames.push(removedFrame);
        break;
      }
      case 'add_canvas_guide': {
        if (!Number.isFinite(operation.position)) throw new Error('Guide position must be finite.');
        const id = createId('guide');
        composition.layout.guides.push({
          id,
          axis: operation.axis,
          position: Math.round(operation.position),
        });
        summary.generatedIds.push({ operationIndex, kind: 'guide', id });
        break;
      }
      case 'update_canvas_guide': {
        const guide = composition.layout.guides.find(
          (candidate) => candidate.id === operation.guideId,
        );
        if (!guide) throw new Error(`Canvas guide not found: ${operation.guideId}`);
        if (!Number.isFinite(operation.position)) throw new Error('Guide position must be finite.');
        guide.position = Math.round(operation.position);
        break;
      }
      case 'remove_canvas_guide':
        if (!composition.layout.guides.some((guide) => guide.id === operation.guideId)) {
          throw new Error(`Canvas guide not found: ${operation.guideId}`);
        }
        composition.layout.guides = composition.layout.guides.filter(
          (guide) => guide.id !== operation.guideId,
        );
        break;
      case 'create_timeline_group': {
        const members = [...new Set(operation.layerIds)];
        if (members.length < 2) throw new Error('A timeline group requires at least two layers.');
        for (const layerId of members) layerFor(composition, layerId);
        for (const group of composition.layout.timelineFolders) {
          group.layerIds = group.layerIds.filter((layerId) => !members.includes(layerId));
        }
        composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
          (group) => group.layerIds.length > 0,
        );
        const index = composition.layout.timelineFolders.length;
        const colors = ['#7c6cff', '#31b7d4', '#f09a3e', '#4fc47a', '#d96bb3', '#d3b84a'];
        const id = operation.id ?? createId('timeline-group');
        composition.layout.timelineFolders.push({
          id,
          name: operation.name?.trim() || `Group ${index + 1}`,
          color: operation.color ?? colors[index % colors.length]!,
          layerIds: members,
        });
        summary.affectedLayerIds.push(...members);
        summary.generatedIds.push({ operationIndex, kind: 'timeline-group', id });
        break;
      }
      case 'rename_timeline_group': {
        const group = composition.layout.timelineFolders.find(
          (candidate) => candidate.id === operation.groupId,
        );
        if (!group) throw new Error(`Timeline group not found: ${operation.groupId}`);
        const name = operation.name.trim();
        if (!name) throw new Error('Timeline group name cannot be empty.');
        group.name = name;
        summary.affectedLayerIds.push(...group.layerIds);
        break;
      }
      case 'set_timeline_group_color': {
        const group = composition.layout.timelineFolders.find(
          (candidate) => candidate.id === operation.groupId,
        );
        if (!group) throw new Error(`Timeline group not found: ${operation.groupId}`);
        if (!/^#[0-9a-f]{6}$/i.test(operation.color)) {
          throw new Error('Timeline group color must be a #RRGGBB value.');
        }
        group.color = operation.color;
        summary.affectedLayerIds.push(...group.layerIds);
        break;
      }
      case 'ungroup_timeline_group': {
        const group = composition.layout.timelineFolders.find(
          (candidate) => candidate.id === operation.groupId,
        );
        if (!group) throw new Error(`Timeline group not found: ${operation.groupId}`);
        summary.affectedLayerIds.push(...group.layerIds);
        composition.layout.timelineFolders = composition.layout.timelineFolders.filter(
          (candidate) => candidate.id !== operation.groupId,
        );
        break;
      }
      case 'group_layers': {
        const members = [...new Set(operation.layerIds)];
        if (members.length < 2) throw new Error('group_layers requires at least two layer IDs.');
        for (const layerId of members) layerFor(composition, layerId);
        for (const collection of composition.runtimeCollections) {
          const overlaps = collection.prototypeLayerIds.some((layerId) =>
            members.includes(layerId),
          );
          if (
            overlaps &&
            !collection.prototypeLayerIds.every((layerId) => members.includes(layerId))
          ) {
            throw new Error(
              'Regroup the complete runtime collection prototype or remove the collection first.',
            );
          }
        }
        const id = operation.id ?? createId('group');
        if (composition.layers.some((layer) => layer.groupId === id)) {
          throw new Error(`Canvas group id already exists: ${id}`);
        }
        for (const layer of composition.layers) {
          if (members.includes(layer.id)) layer.groupId = id;
        }
        summary.generatedIds.push({ operationIndex, kind: 'canvas-group', id });
        summary.affectedLayerIds.push(...members);
        break;
      }
      case 'ungroup_layers': {
        if (operation.groupId && operation.layerIds?.length) {
          throw new Error('ungroup_layers accepts groupId or layerIds, not both.');
        }
        const groupIds = new Set<string>();
        if (operation.groupId) groupIds.add(operation.groupId);
        for (const layerId of operation.layerIds ?? []) {
          const groupId = layerFor(composition, layerId).groupId;
          if (groupId) groupIds.add(groupId);
        }
        if (groupIds.size === 0) throw new Error('ungroup_layers matched no canvas groups.');
        if (
          composition.runtimeCollections.some((collection) =>
            collection.prototypeLayerIds.some((layerId) => {
              const layer = composition.layers.find((candidate) => candidate.id === layerId);
              return Boolean(layer?.groupId && groupIds.has(layer.groupId));
            }),
          )
        ) {
          throw new Error('Remove the runtime collection before ungrouping its prototype.');
        }
        for (const layer of composition.layers) {
          if (layer.groupId && groupIds.has(layer.groupId)) {
            layer.groupId = null;
            summary.affectedLayerIds.push(layer.id);
          }
        }
        break;
      }
      case 'save_component': {
        if (
          operation.id &&
          composition.components.some((candidate) => candidate.id === operation.id)
        ) {
          throw new Error(`Component id already exists: ${operation.id}`);
        }
        const definition = buildComponentDefinition(
          composition,
          operation.layerIds,
          operation.name,
          operation.id,
        );
        composition.components.push(definition);
        summary.generatedIds.push({ operationIndex, kind: 'component', id: definition.id });
        break;
      }
      case 'instantiate_component': {
        const definition = composition.components.find(
          (candidate) => candidate.id === operation.componentId,
        );
        if (!definition) throw new Error(`Component not found: ${operation.componentId}`);
        const instance = instantiateComponentDefinition(
          composition,
          definition,
          {
            x: operation.offset?.x ?? 40,
            y: operation.offset?.y ?? 40,
          },
          operation.linked ?? false,
        );
        composition.dataFields.push(...instance.dataFields);
        composition.layers.push(...instance.layers);
        for (const layer of instance.layers) {
          summary.generatedIds.push({ operationIndex, kind: 'layer', id: layer.id });
          summary.affectedLayerIds.push(layer.id);
        }
        for (const field of instance.dataFields) {
          summary.generatedIds.push({ operationIndex, kind: 'field', id: field.id });
        }
        summary.componentInstances.push({
          operationIndex,
          componentId: definition.id,
          instanceId: instance.instanceId,
          groupId: instance.groupId,
          linked: operation.linked ?? false,
          layers: instance.layerIds,
          fields: instance.fieldIds,
        });
        break;
      }
      case 'update_component_from_layers': {
        const index = composition.components.findIndex(
          (candidate) => candidate.id === operation.componentId,
        );
        const existing = composition.components[index];
        if (!existing) throw new Error(`Component not found: ${operation.componentId}`);
        composition.components[index] = buildComponentDefinition(
          composition,
          operation.layerIds,
          existing.name,
          existing.id,
        );
        break;
      }
      case 'refresh_component_instances': {
        const definition = composition.components.find(
          (candidate) => candidate.id === operation.componentId,
        );
        if (!definition) throw new Error(`Component not found: ${operation.componentId}`);
        for (const refreshed of refreshComponentInstances(
          composition,
          definition,
          operation.instanceIds,
        )) {
          const { instance } = refreshed;
          for (const layer of instance.layers) {
            summary.generatedIds.push({ operationIndex, kind: 'layer', id: layer.id });
          }
          for (const field of instance.dataFields) {
            summary.generatedIds.push({ operationIndex, kind: 'field', id: field.id });
          }
          summary.affectedLayerIds.push(
            ...refreshed.removedLayerIds,
            ...instance.layers.map((layer) => layer.id),
          );
          summary.componentInstances.push({
            operationIndex,
            componentId: definition.id,
            instanceId: refreshed.instanceId,
            groupId: instance.groupId,
            linked: true,
            layers: instance.layerIds,
            fields: instance.fieldIds,
          });
        }
        break;
      }
      case 'rename_component': {
        const definition = composition.components.find(
          (candidate) => candidate.id === operation.componentId,
        );
        if (!definition) throw new Error(`Component not found: ${operation.componentId}`);
        const name = operation.name.trim();
        if (!name) throw new Error('Component name cannot be empty.');
        definition.name = name;
        break;
      }
      case 'remove_component': {
        if (!composition.components.some((candidate) => candidate.id === operation.componentId)) {
          throw new Error(`Component not found: ${operation.componentId}`);
        }
        composition.components = composition.components.filter(
          (candidate) => candidate.id !== operation.componentId,
        );
        for (const layer of composition.layers) {
          if (layer.componentLink?.componentId === operation.componentId) {
            layer.componentLink = null;
          }
        }
        break;
      }
      case 'add_asset': {
        const compact = operation.data.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
          throw new Error('Asset data must be a valid base64 payload without a data-URI prefix.');
        }
        const dataUri = `data:${operation.mimeType};base64,${compact}`;
        const duplicate = composition.assets.find(
          (candidate) => candidate.mimeType === operation.mimeType && candidate.dataUri === dataUri,
        );
        if (duplicate) {
          summary.generatedIds.push({ operationIndex, kind: 'asset', id: duplicate.id });
          summary.warnings.push(
            `Operation ${operationIndex}: reused identical asset "${duplicate.name}" (${duplicate.id}).`,
          );
          break;
        }
        const asset = createAsset({
          name: operation.name.trim(),
          kind: operation.mimeType.startsWith('font/')
            ? 'font'
            : operation.mimeType.startsWith('image/')
              ? 'image'
              : 'source',
          mimeType: operation.mimeType,
          dataUri,
          originalFileName: operation.name.trim(),
          byteSize:
            Math.floor((compact.length * 3) / 4) -
            (compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0),
          ...(operation.fontFamily ? { fontFamily: operation.fontFamily.trim() } : {}),
          ...(operation.fontWeight ? { fontWeight: operation.fontWeight.trim() } : {}),
          ...(operation.fontStyle ? { fontStyle: operation.fontStyle } : {}),
          ...(operation.packagePath ? { packagePath: operation.packagePath.trim() } : {}),
          ...(operation.licenseName ? { licenseName: operation.licenseName } : {}),
          ...(operation.licenseUrl ? { licenseUrl: operation.licenseUrl } : {}),
          ...(operation.licenseText ? { licenseText: operation.licenseText } : {}),
        });
        composition.assets.push(asset);
        summary.generatedIds.push({ operationIndex, kind: 'asset', id: asset.id });
        break;
      }
      case 'update_asset': {
        const asset = composition.assets.find((candidate) => candidate.id === operation.assetId);
        if (!asset) throw new Error(`Asset not found: ${operation.assetId}`);
        if (operation.name !== undefined) asset.name = operation.name.trim();
        if (operation.fontFamily !== undefined) asset.fontFamily = operation.fontFamily.trim();
        if (operation.fontWeight !== undefined) asset.fontWeight = operation.fontWeight.trim();
        if (operation.fontStyle !== undefined) asset.fontStyle = operation.fontStyle;
        if (operation.packagePath !== undefined) {
          const packagePath = operation.packagePath?.trim();
          if (packagePath) asset.packagePath = packagePath;
          else delete asset.packagePath;
        }
        if (operation.licenseName !== undefined) asset.licenseName = operation.licenseName;
        if (operation.licenseUrl !== undefined) asset.licenseUrl = operation.licenseUrl;
        if (operation.licenseText !== undefined) asset.licenseText = operation.licenseText;
        break;
      }
      case 'remove_asset': {
        const asset = composition.assets.find((candidate) => candidate.id === operation.assetId);
        if (!asset) throw new Error(`Asset not found: ${operation.assetId}`);
        const reference = `asset:${asset.id}`;
        const layerConsumers = composition.layers.filter((layer) => {
          if (layer.element.type === 'image') return layer.element.src === reference;
          if (layer.element.type === 'image-sequence') {
            return layer.element.frames.includes(reference);
          }
          return false;
        });
        const fieldConsumers = composition.dataFields.filter(
          (field) =>
            (field.type === 'image-url' || field.type === 'file-path') &&
            field.defaultValue === reference,
        );
        if ((layerConsumers.length > 0 || fieldConsumers.length > 0) && !operation.force) {
          throw new Error(
            `Cannot remove asset "${asset.name}" while referenced by ${layerConsumers.length} layer(s) and ${fieldConsumers.length} data field(s). Pass force=true to clear those references atomically.`,
          );
        }
        if (operation.force) {
          for (const layer of layerConsumers) {
            if (layer.element.type === 'image') layer.element.src = null;
            else if (layer.element.type === 'image-sequence') {
              layer.element.frames = layer.element.frames.filter((frame) => frame !== reference);
            }
            summary.affectedLayerIds.push(layer.id);
          }
          for (const field of fieldConsumers) field.defaultValue = '';
        }
        if (
          asset.kind === 'font' &&
          composition.layers.some(
            (layer) =>
              layer.element.type === 'text' && layer.element.fontFamily === asset.fontFamily,
          )
        ) {
          summary.warnings.push(
            `Operation ${operationIndex}: removed font asset "${asset.name}" while text layers still request family "${asset.fontFamily}"; those layers will use renderer fallback fonts.`,
          );
        }
        composition.assets = composition.assets.filter((candidate) => candidate.id !== asset.id);
        break;
      }
      case 'add_layer': {
        const id = addLayer(composition, operation);
        summary.affectedLayerIds.push(id);
        summary.generatedIds.push({ operationIndex, kind: 'layer', id });
        warnForDegenerateShrinkToFit(
          summary,
          layerFor(composition, id),
          computeKeyframeFrames(composition).map((item) => item.frame),
          operationIndex,
        );
        break;
      }
      case 'set_tiling_pattern': {
        const pattern = setTilingPattern(
          composition,
          operation.patch,
          operation.patternId,
          operation.id,
        );
        summary.generatedIds.push({ operationIndex, kind: 'pattern', id: pattern.id });
        if (!operation.patternId && operation.createLayer !== false) {
          const id = addTilingPatternLayer(composition, pattern.id);
          summary.generatedIds.push({ operationIndex, kind: 'layer', id });
          summary.affectedLayerIds.push(id);
        }
        summary.affectedLayerIds.push(
          ...composition.layers
            .filter(
              (layer) => layer.element.type === 'pattern' && layer.element.patternId === pattern.id,
            )
            .map((layer) => layer.id),
        );
        break;
      }
      case 'remove_tiling_pattern':
        removeTilingPattern(composition, operation.patternId);
        break;
      case 'set_layer_semantics': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if (operation.patch.role !== undefined) layer.semantics.role = operation.patch.role;
        if (operation.patch.description !== undefined)
          layer.semantics.description = operation.patch.description.trim();
        if (operation.patch.tags !== undefined) {
          layer.semantics.tags = [
            ...new Set(operation.patch.tags.map((tag) => tag.trim()).filter(Boolean)),
          ];
        }
        break;
      }
      case 'apply_style_pack': {
        const applied = applyStylePack(composition, operation.stylePack, {
          refreshTokens: true,
          ...(operation.bindLayers === false ? { bindLayerIds: [] } : {}),
          ...(operation.tokenIds ? { tokenIds: operation.tokenIds } : {}),
        });
        for (const id of applied.createdTokenIds) {
          summary.generatedIds.push({ operationIndex, kind: 'design-token', id });
        }
        summary.affectedLayerIds.push(...applied.affectedLayerIds);
        summary.stylePacks.push({
          operationIndex,
          packId: applied.packId,
          name: applied.name,
          tokenIds: applied.tokenIds,
          affectedLayerIds: applied.affectedLayerIds,
        });
        break;
      }
      case 'remove_style_pack': {
        const removed = removeStylePack(composition);
        if (removed) summary.affectedLayerIds.push(...removed.affectedLayerIds);
        break;
      }
      case 'create_lower_third': {
        const block = materializeLowerThird(composition, operation);
        recordSemanticBlock(summary, operationIndex, block);
        break;
      }
      case 'create_bug':
        recordSemanticBlock(summary, operationIndex, materializeBug(composition, operation));
        break;
      case 'create_ticker':
        recordSemanticBlock(summary, operationIndex, materializeTicker(composition, operation));
        break;
      case 'create_scoreboard':
        recordSemanticBlock(summary, operationIndex, materializeScoreboard(composition, operation));
        break;
      case 'create_clock':
        recordSemanticBlock(summary, operationIndex, materializeClock(composition, operation));
        break;
      case 'create_repeater': {
        const repeater = materializeRepeater(composition, operation);
        for (const item of repeater.items) {
          summary.generatedIds.push({
            operationIndex,
            kind: 'canvas-group',
            id: item.groupId,
          });
          if (item.index === 0) continue;
          for (const id of Object.values(item.layers)) {
            summary.generatedIds.push({ operationIndex, kind: 'layer', id });
            summary.affectedLayerIds.push(id);
          }
          for (const id of Object.values(item.fields)) {
            summary.generatedIds.push({ operationIndex, kind: 'field', id });
          }
        }
        summary.repeaters.push({ operationIndex, ...repeater });
        break;
      }
      case 'duplicate_group':
        duplicateGroup(composition, operation, operationIndex, summary);
        break;
      case 'remove_layer':
        assertMaskSourcesRemovable(composition, new Set([operation.layerId]));
        if (
          composition.runtimeCollections.some((collection) =>
            collection.prototypeLayerIds.includes(operation.layerId),
          )
        ) {
          throw new Error(
            'Remove the runtime collection before deleting one of its prototype layers.',
          );
        }
        assertUnlocked(layerFor(composition, operation.layerId));
        composition.layers = composition.layers.filter((layer) => layer.id !== operation.layerId);
        for (const layer of composition.layers) {
          if (layer.parentId === operation.layerId) layer.parentId = null;
        }
        break;
      case 'rename_layer':
        layerFor(composition, operation.layerId).name = operation.name;
        break;
      case 'set_layer_flags': {
        const layer = layerFor(composition, operation.layerId);
        if (operation.isVisible !== undefined) layer.isVisible = operation.isVisible;
        if (operation.isGuide !== undefined) layer.isGuide = operation.isGuide;
        if (operation.isMaskOnly !== undefined) layer.isMaskOnly = operation.isMaskOnly;
        if (operation.blendMode !== undefined) layer.blendMode = operation.blendMode;
        break;
      }
      case 'set_layer_layout': {
        const layer = layerFor(composition, operation.layerId);
        if (operation.parentId === layer.id) throw new Error('A layer cannot parent itself.');
        if (
          operation.parentId &&
          !composition.layers.some((candidate) => candidate.id === operation.parentId)
        ) {
          throw new Error(`Transform parent not found: ${operation.parentId}`);
        }
        if (
          operation.parentId &&
          descendantsFor(composition, layer.id).some(
            (candidate) => candidate.id === operation.parentId,
          )
        ) {
          throw new Error('Transform parent would create a cycle.');
        }
        if (operation.isLocked !== undefined) layer.isLocked = operation.isLocked;
        if (operation.clipChildren !== undefined) layer.clipChildren = operation.clipChildren;
        if (operation.groupId !== undefined) layer.groupId = operation.groupId;
        if (operation.parentId !== undefined) layer.parentId = operation.parentId;
        if (operation.constraints) Object.assign(layer.constraints, operation.constraints);
        break;
      }
      case 'set_layer_mask': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if (operation.sourceLayerId === null) {
          layer.mask = null;
          break;
        }
        const source = layerFor(composition, operation.sourceLayerId);
        layer.mask = {
          sourceLayerId: source.id,
          mode: operation.mode ?? 'alpha',
          inverted: operation.inverted ?? false,
        };
        const errors = layerMaskErrors(composition);
        if (errors.length) throw new Error(errors.join(' '));
        if (operation.hideSource !== false) {
          assertUnlocked(source);
          source.isMaskOnly = true;
        }
        summary.affectedLayerIds.push(source.id);
        break;
      }
      case 'update_element': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if ('type' in operation.patch && operation.patch.type !== layer.element.type) {
          throw new Error('An element patch cannot change the layer element type.');
        }
        const previousStrokeWidth =
          layer.element.type === 'text' ? layer.element.strokeWidth : null;
        if (layer.element.type === 'text' && operation.patch.strokeWidth !== undefined) {
          const strokeWidth = Number(operation.patch.strokeWidth);
          if (!Number.isFinite(strokeWidth)) {
            throw new Error('Text stroke width must be finite.');
          }
          assertPropertyApplicable(layer, 'strokeWidth', strokeWidth);
        }
        const elementPatch = { ...operation.patch };
        if (layer.element.type === 'rectangle' && elementPatch.borderRadius !== undefined) {
          const radiusPatch = elementPatch.borderRadius;
          elementPatch.borderRadius = normalizeCornerRadii(
            radiusPatch && typeof radiusPatch === 'object'
              ? { ...layer.element.borderRadius, ...radiusPatch }
              : (radiusPatch as never),
          );
        }
        Object.assign(layer.element, elementPatch);
        if (layer.element.type === 'text' && operation.patch.strokeWidth !== undefined) {
          const track = layer.animationTracks.strokeWidth;
          if (!track?.length) materializeTracks(layer);
          else if (track.length === 1 && track[0]!.value === previousStrokeWidth) {
            track[0]!.value = layer.element.strokeWidth;
          }
        }
        pruneInvalidGradientStopTracks(layer);
        break;
      }
      case 'update_transform': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const patch = normalizeAuthoredTransformPatch(operation.patch);
        const frames = operationFrames(composition, operation.scope, operation.frame);
        for (const frame of frames) {
          const before = getLayerTransformAtFrame(layer, frame);
          const aggregate = findLayerKeyframeAtFrame(layer, frame);
          const easing = aggregate?.easing ?? 'ease-in-out';
          for (const [property, value] of Object.entries(patch) as [
            keyof LayerTransform,
            number,
          ][]) {
            upsertPropertyKey(layer, property, frame, value, easing);
          }
          syncAggregateKey(layer, frame, easing);
          const after = getLayerTransformAtFrame(layer, frame);
          const deltaX = after.x - before.x;
          const deltaY = after.y - before.y;
          for (const descendant of descendantsFor(composition, layer.id)) {
            const pose = getLayerTransformAtFrame(descendant, frame);
            if (deltaX !== 0) upsertPropertyKey(descendant, 'x', frame, pose.x + deltaX, easing);
            if (deltaY !== 0) upsertPropertyKey(descendant, 'y', frame, pose.y + deltaY, easing);
            syncAggregateKey(descendant, frame, easing);
          }
        }
        warnForDegenerateShrinkToFit(summary, layer, frames, operationIndex);
        break;
      }
      case 'add_effect':
      case 'duplicate_effect': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const effect =
          operation.type === 'add_effect'
            ? addEffect(layer, operation.effectType, operation.patch, operation.index, operation.id)
            : duplicateEffect(layer, operation.effectId, operation.id);
        summary.generatedIds.push({ operationIndex, kind: 'effect', id: effect.id });
        summary.affectedLayerIds.push(layer.id);
        break;
      }
      case 'update_effect': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const effect = updateEffect(layer, operation.effectId, operation.patch);
        for (const [param, value] of Object.entries(operation.patch.params ?? {}))
          if (typeof value === 'number')
            for (const frame of operationFrames(composition, operation.scope, operation.frame))
              upsertPropertyKey(
                layer,
                effectProperty(effect, param) as AnimatableLayerProperty,
                frame,
                value,
              );
        summary.affectedLayerIds.push(layer.id);
        break;
      }
      case 'remove_effect':
      case 'reorder_effects': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if (operation.type === 'remove_effect') removeEffect(layer, operation.effectId);
        else reorderEffects(layer, operation.effectIds);
        summary.affectedLayerIds.push(layer.id);
        break;
      }
      case 'update_effects': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        layer.effects = ensureLegacyEffects(
          normalizeLayerEffects({ ...layer.effects, ...operation.patch }),
          operation.patch,
        );
        for (const frame of operationFrames(composition, operation.scope, operation.frame)) {
          for (const property of EFFECT_ANIMATION_PROPERTIES) {
            if (operation.patch[property] !== undefined) {
              const key = upsertPropertyKey(layer, property, frame, layer.effects[property]);
              syncAggregateKey(layer, frame, key.easing);
            }
          }
        }
        break;
      }
      case 'set_property_key': {
        if (!Number.isFinite(operation.value))
          throw new Error('Property key value must be finite.');
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const frame = frameInComposition(composition, operation.frame);
        const key = upsertPropertyKey(
          layer,
          operation.property,
          frame,
          operation.value,
          operation.easing,
        );
        if (operation.easing !== undefined) key.easing = operation.easing;
        if (operation.curve === null) delete key.curve;
        else if (operation.curve !== undefined) key.curve = clone(operation.curve);
        syncAggregateKey(layer, frame, key.easing);
        summary.generatedIds.push({ operationIndex, kind: 'property-key', id: key.id });
        break;
      }
      case 'set_property_track': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const keys = applyPropertyTrack(
          composition,
          layer,
          operation.property,
          operation.keys,
          operation.replace,
        );
        for (const key of keys) {
          summary.generatedIds.push({ operationIndex, kind: 'property-key', id: key.id });
        }
        break;
      }
      case 'set_layer_loop': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const activation = operation.activation;
        if (
          activation?.type === 'step' &&
          !composition.keyframes.some(
            (keyframe) => keyframe.id === activation.stepKeyframeId && keyframe.role === 'step',
          )
        ) {
          throw new Error(`Loop activation Step not found: ${activation.stepKeyframeId}`);
        }
        const nextDuration = operation.durationFrames ?? layer.loop?.durationFrames ?? 30;
        if (!Number.isInteger(nextDuration) || nextDuration < 1) {
          throw new Error('Loop durationFrames must be a positive integer.');
        }
        if (
          layer.loop &&
          Object.values(layer.loop.tracks).some((track) =>
            track?.some((key) => key.frame > nextDuration),
          )
        ) {
          throw new Error(
            `Shortening this loop to ${nextDuration} frames would strand existing loop keys.`,
          );
        }
        const created = !layer.loop;
        layer.loop ??= createLayerLoopClip(operation.id ? { id: operation.id } : {});
        if (operation.name !== undefined) layer.loop.name = operation.name.trim() || 'Loop';
        if (operation.activation !== undefined) {
          layer.loop.activation = clone(operation.activation);
        }
        layer.loop.durationFrames = nextDuration;
        if (operation.phaseOffsetFrames !== undefined) {
          layer.loop.phaseOffsetFrames = Math.round(operation.phaseOffsetFrames);
        }
        if (operation.repeatCount !== undefined) {
          layer.loop.repeatCount =
            operation.repeatCount === null ? null : Math.max(1, Math.round(operation.repeatCount));
        }
        if (created) {
          summary.generatedIds.push({ operationIndex, kind: 'loop', id: layer.loop.id });
        }
        break;
      }
      case 'set_loop_property_track': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        const keys = applyLoopPropertyTrack(
          layer,
          operation.property,
          operation.keys,
          operation.replace,
        );
        for (const key of keys) {
          summary.generatedIds.push({ operationIndex, kind: 'property-key', id: key.id });
        }
        break;
      }
      case 'remove_layer_loop': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if (!layer.loop) throw new Error(`Layer "${layer.name}" has no loop clip.`);
        layer.loop = null;
        break;
      }
      case 'stagger_property_track': {
        operation.layerIds.forEach((layerId, index) => {
          const layer = layerFor(composition, layerId);
          assertUnlocked(layer);
          const offset = index * operation.frameOffset;
          const keys = applyPropertyTrack(
            composition,
            layer,
            operation.property,
            operation.keys.map((key) => ({ ...key, frame: key.frame + offset })),
            operation.replace,
          );
          for (const key of keys) {
            summary.generatedIds.push({ operationIndex, kind: 'property-key', id: key.id });
          }
        });
        break;
      }
      case 'move_property_key': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        materializeTracks(layer);
        const track = layer.animationTracks[operation.property] ?? [];
        const key = track.find((candidate) => candidate.id === operation.keyframeId);
        if (!key) throw new Error(`Property key not found: ${operation.keyframeId}`);
        const frame = frameInComposition(composition, operation.frame);
        if (track.some((candidate) => candidate.id !== key.id && candidate.frame === frame)) {
          throw new Error(`Property track already has a key at frame ${frame}.`);
        }
        key.frame = frame;
        layer.animationTracks[operation.property] = sortLayerPropertyKeyframes(track);
        syncAggregateKey(layer, frame, key.easing);
        break;
      }
      case 'remove_property_key': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        materializeTracks(layer);
        const track = layer.animationTracks[operation.property] ?? [];
        if (track.length <= 1) throw new Error('A property track must retain at least one key.');
        if (!track.some((candidate) => candidate.id === operation.keyframeId)) {
          throw new Error(`Property key not found: ${operation.keyframeId}`);
        }
        layer.animationTracks[operation.property] = track.filter(
          (candidate) => candidate.id !== operation.keyframeId,
        );
        break;
      }
      case 'set_property_key_easing': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        materializeTracks(layer);
        const key = layer.animationTracks[operation.property]?.find(
          (candidate) => candidate.id === operation.keyframeId,
        );
        if (!key) throw new Error(`Property key not found: ${operation.keyframeId}`);
        key.easing = operation.easing;
        if (operation.curve === null) delete key.curve;
        else if (operation.curve !== undefined) key.curve = clone(operation.curve);
        break;
      }
      case 'reorder_layers': {
        if (new Set(operation.layerIds).size !== composition.layers.length) {
          throw new Error('Layer order must contain every layer exactly once.');
        }
        const byId = new Map(composition.layers.map((layer) => [layer.id, layer]));
        composition.layers = operation.layerIds.map((id) => {
          const layer = byId.get(id);
          if (!layer) throw new Error(`Layer order contains unknown layer: ${id}`);
          return layer;
        });
        break;
      }
      case 'add_data_field': {
        if (composition.dataFields.some((field) => field.key === operation.key)) {
          throw new Error(`Data field key already exists: ${operation.key}`);
        }
        const field = createFieldDefinition(operation.fieldType, {
          key: operation.key,
          label: operation.label ?? operation.key,
          description: operation.description ?? '',
          ...(operation.defaultValue !== undefined ? { defaultValue: operation.defaultValue } : {}),
          required: operation.required ?? false,
          ...(operation.options ? { options: operation.options } : {}),
          ...(operation.constraints ? { constraints: operation.constraints } : {}),
          ...(operation.fileExtensions ? { fileExtensions: operation.fileExtensions } : {}),
          ...(operation.properties
            ? { properties: operation.properties.map(createFieldDefinitionFromInput) }
            : {}),
          ...(operation.items !== undefined
            ? {
                items:
                  operation.items === null ? null : createFieldDefinitionFromInput(operation.items),
              }
            : {}),
        });
        if (operation.id !== undefined) {
          if (composition.dataFields.some((candidate) => candidate.id === operation.id)) {
            throw new Error(`Data field id already exists: ${operation.id}`);
          }
          field.id = operation.id;
        }
        if (operation.defaultTokenId !== undefined)
          bindFieldDefaultToken(composition, field, operation.defaultTokenId);
        composition.dataFields.push(field);
        summary.generatedIds.push({ operationIndex, kind: 'field', id: field.id });
        break;
      }
      case 'update_data_field': {
        const field = composition.dataFields.find(
          (candidate) => candidate.id === operation.fieldId,
        );
        if (!field) throw new Error(`Data field not found: ${operation.fieldId}`);
        const runtimeCollection = composition.runtimeCollections.find(
          (collection) => collection.fieldId === field.id,
        );
        if (operation.key !== undefined) {
          const key = operation.key.trim();
          if (!key) throw new Error('Data field key cannot be empty.');
          if (
            composition.dataFields.some(
              (candidate) => candidate.id !== field.id && candidate.key === key,
            )
          ) {
            throw new Error(`Data field key already exists: ${key}`);
          }
          field.key = key;
        }
        if (operation.label !== undefined) field.label = operation.label;
        if (operation.description !== undefined) field.description = operation.description;
        if (operation.fieldType !== undefined) {
          const defaults = createFieldDefinition(operation.fieldType);
          field.type = operation.fieldType;
          field.options = operation.options ?? defaultOptionsForFieldType(operation.fieldType);
          field.constraints =
            operation.constraints ?? defaultConstraintsForFieldType(operation.fieldType);
          field.fileExtensions = operation.fileExtensions ?? [];
          field.defaultValue =
            operation.defaultValue ?? defaultValueForFieldType(operation.fieldType, field.options);
          field.properties =
            operation.properties?.map(createFieldDefinitionFromInput) ?? defaults.properties;
          field.items =
            operation.items === undefined
              ? defaults.items
              : operation.items === null
                ? null
                : createFieldDefinitionFromInput(operation.items);
        } else {
          if (operation.options !== undefined) field.options = operation.options;
          if (operation.constraints !== undefined) field.constraints = operation.constraints;
          if (operation.fileExtensions !== undefined) {
            field.fileExtensions = operation.fileExtensions;
          }
          if (operation.defaultValue !== undefined) field.defaultValue = operation.defaultValue;
          if (operation.properties !== undefined) {
            field.properties = operation.properties.map(createFieldDefinitionFromInput);
          }
          if (operation.items !== undefined) {
            field.items =
              operation.items === null ? null : createFieldDefinitionFromInput(operation.items);
          }
        }
        if (operation.required !== undefined) field.required = operation.required;
        if (operation.defaultTokenId !== undefined)
          bindFieldDefaultToken(composition, field, operation.defaultTokenId);
        else if (operation.defaultValue !== undefined || operation.fieldType !== undefined)
          delete field.defaultTokenId;
        if (runtimeCollection) {
          if (field.type !== 'array' || field.items?.type !== 'object') {
            throw new Error(
              'Remove the runtime collection before changing its field away from object-item array data.',
            );
          }
          if (field.constraints.maxItems !== undefined) {
            runtimeCollection.capacity = assertCollectionCapacity(field.constraints.maxItems);
          } else {
            field.constraints = { ...field.constraints, maxItems: runtimeCollection.capacity };
          }
        }
        break;
      }
      case 'remove_data_field': {
        const field = composition.dataFields.find(
          (candidate) => candidate.id === operation.fieldId,
        );
        if (!field) throw new Error(`Data field not found: ${operation.fieldId}`);
        const consumers = composition.layers.filter((layer) =>
          layer.bindings.some((binding) => binding.fieldId === operation.fieldId),
        );
        const collectionConsumers = composition.runtimeCollections.filter(
          (collection) => collection.fieldId === operation.fieldId,
        );
        if ((consumers.length > 0 || collectionConsumers.length > 0) && !operation.force) {
          throw new Error(
            `Cannot remove data field "${field.key}" while it is used by ${[
              consumers.length
                ? `layer${consumers.length === 1 ? '' : 's'} ${consumers.map((layer) => `"${layer.name}" (${layer.id})`).join(', ')}`
                : '',
              collectionConsumers.length
                ? `runtime collection${collectionConsumers.length === 1 ? '' : 's'} ${collectionConsumers.map((collection) => `"${collection.name}" (${collection.id})`).join(', ')}`
                : '',
            ]
              .filter(Boolean)
              .join(' and ')}. Pass force=true to clear those uses atomically.`,
          );
        }
        for (const layer of consumers) {
          const removedBindings = layer.bindings.filter(
            (binding) => binding.fieldId === operation.fieldId,
          );
          layer.bindings = layer.bindings.filter(
            (binding) => binding.fieldId !== operation.fieldId,
          );
          for (const _binding of removedBindings) {
            summary.clearedBindings.push({
              layerId: layer.id,
              layerName: layer.name,
              fieldId: field.id,
            });
          }
          summary.affectedLayerIds.push(layer.id);
        }
        composition.dataFields = composition.dataFields.filter(
          (candidate) => candidate.id !== field.id,
        );
        if (collectionConsumers.length > 0) {
          composition.runtimeCollections = composition.runtimeCollections.filter(
            (collection) => collection.fieldId !== field.id,
          );
        }
        break;
      }
      case 'set_layer_binding': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if (
          operation.binding &&
          !composition.dataFields.some((field) => field.id === operation.binding?.fieldId)
        ) {
          throw new Error(`Binding references unknown field: ${operation.binding.fieldId}`);
        }
        layer.bindings = operation.binding ? [clone(operation.binding)] : [];
        break;
      }
      case 'set_layer_bindings': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        for (const binding of operation.bindings) {
          if (!composition.dataFields.some((field) => field.id === binding.fieldId)) {
            throw new Error(`Binding references unknown field: ${binding.fieldId}`);
          }
        }
        const targets = operation.bindings.map((binding) => binding.targetProperty);
        if (new Set(targets).size !== targets.length) {
          throw new Error('A layer cannot bind the same target property more than once.');
        }
        layer.bindings = clone(operation.bindings);
        break;
      }
      case 'create_runtime_collection': {
        const field = composition.dataFields.find(
          (candidate) => candidate.id === operation.fieldId,
        );
        if (!field) throw new Error(`Data field not found: ${operation.fieldId}`);
        if (field.type !== 'array' || field.items?.type !== 'object') {
          throw new Error('Runtime collections require an array field with object items.');
        }
        if (
          composition.runtimeCollections.some(
            (collection) => collection.fieldId === operation.fieldId,
          )
        ) {
          throw new Error(`Array field already drives a runtime collection: ${field.key}`);
        }
        const layerIds = [...new Set(operation.prototypeLayerIds)];
        if (layerIds.length !== operation.prototypeLayerIds.length) {
          throw new Error('Runtime collection prototype layers must be unique.');
        }
        assertRuntimeCollectionPrototype(composition, layerIds);
        if (
          !Number.isFinite(operation.offsetPerItem.x) ||
          !Number.isFinite(operation.offsetPerItem.y)
        ) {
          throw new Error('Runtime collection item offsets must be finite.');
        }
        const capacity = assertCollectionCapacity(operation.capacity ?? 12);
        const id = operation.id ?? createId('runtime-collection');
        if (composition.runtimeCollections.some((collection) => collection.id === id)) {
          throw new Error(`Runtime collection id already exists: ${id}`);
        }
        field.constraints = { ...field.constraints, maxItems: capacity };
        composition.runtimeCollections.push({
          id,
          name: operation.name?.trim() || field.label || field.key,
          fieldId: field.id,
          prototypeLayerIds: layerIds,
          offsetPerItem: { ...operation.offsetPerItem },
          capacity,
          overflow: operation.overflow ?? 'truncate',
        });
        summary.affectedLayerIds.push(...layerIds);
        summary.generatedIds.push({ operationIndex, kind: 'runtime-collection', id });
        break;
      }
      case 'update_runtime_collection': {
        const collection = composition.runtimeCollections.find(
          (candidate) => candidate.id === operation.collectionId,
        );
        if (!collection) throw new Error(`Runtime collection not found: ${operation.collectionId}`);
        if (operation.fieldId !== undefined) {
          const field = composition.dataFields.find(
            (candidate) => candidate.id === operation.fieldId,
          );
          if (!field) throw new Error(`Data field not found: ${operation.fieldId}`);
          if (field.type !== 'array' || field.items?.type !== 'object') {
            throw new Error('Runtime collections require an array field with object items.');
          }
          if (
            composition.runtimeCollections.some(
              (candidate) =>
                candidate.id !== collection.id && candidate.fieldId === operation.fieldId,
            )
          ) {
            throw new Error(`Array field already drives another runtime collection: ${field.key}`);
          }
          collection.fieldId = field.id;
        }
        if (operation.name !== undefined) collection.name = operation.name.trim();
        if (operation.prototypeLayerIds !== undefined) {
          const layerIds = [...new Set(operation.prototypeLayerIds)];
          if (layerIds.length !== operation.prototypeLayerIds.length) {
            throw new Error('Runtime collection prototype layers must be unique.');
          }
          assertRuntimeCollectionPrototype(composition, layerIds, collection.id);
          collection.prototypeLayerIds = layerIds;
          summary.affectedLayerIds.push(...layerIds);
        }
        if (operation.offsetPerItem !== undefined) {
          if (
            !Number.isFinite(operation.offsetPerItem.x) ||
            !Number.isFinite(operation.offsetPerItem.y)
          ) {
            throw new Error('Runtime collection item offsets must be finite.');
          }
          collection.offsetPerItem = { ...operation.offsetPerItem };
        }
        if (operation.capacity !== undefined) {
          collection.capacity = assertCollectionCapacity(operation.capacity);
        }
        if (operation.overflow !== undefined) collection.overflow = operation.overflow;
        const field = composition.dataFields.find(
          (candidate) => candidate.id === collection.fieldId,
        );
        if (field) field.constraints = { ...field.constraints, maxItems: collection.capacity };
        break;
      }
      case 'remove_runtime_collection': {
        if (
          !composition.runtimeCollections.some(
            (collection) => collection.id === operation.collectionId,
          )
        ) {
          throw new Error(`Runtime collection not found: ${operation.collectionId}`);
        }
        composition.runtimeCollections = composition.runtimeCollections.filter(
          (collection) => collection.id !== operation.collectionId,
        );
        break;
      }
      case 'add_custom_action': {
        const actionId = operation.actionId.trim();
        if (!actionId) throw new Error('Custom action id cannot be empty.');
        if (composition.customActions.some((action) => action.actionId === actionId)) {
          throw new Error(`Custom action id already exists: ${actionId}`);
        }
        const action = createCustomActionDefinition({
          ...(operation.id ? { id: operation.id } : {}),
          actionId,
          name: operation.name?.trim() || actionId,
          description: operation.description ?? '',
        });
        if (composition.customActions.some((candidate) => candidate.id === action.id)) {
          throw new Error(`Custom action definition id already exists: ${action.id}`);
        }
        composition.customActions.push(action);
        summary.generatedIds.push({ operationIndex, kind: 'custom-action', id: action.id });
        break;
      }
      case 'update_custom_action': {
        const action = composition.customActions.find(
          (candidate) => candidate.actionId === operation.actionId,
        );
        if (!action) throw new Error(`Custom action not found: ${operation.actionId}`);
        if (operation.nextActionId !== undefined) {
          const nextActionId = operation.nextActionId.trim();
          if (!nextActionId) throw new Error('Custom action id cannot be empty.');
          if (
            composition.customActions.some(
              (candidate) => candidate.id !== action.id && candidate.actionId === nextActionId,
            )
          ) {
            throw new Error(`Custom action id already exists: ${nextActionId}`);
          }
          action.actionId = nextActionId;
        }
        if (operation.name !== undefined) action.name = operation.name;
        if (operation.description !== undefined) action.description = operation.description;
        break;
      }
      case 'remove_custom_action': {
        const action = composition.customActions.find(
          (candidate) => candidate.actionId === operation.actionId,
        );
        if (!action) throw new Error(`Custom action not found: ${operation.actionId}`);
        composition.customActions = composition.customActions.filter(
          (candidate) => candidate.id !== action.id,
        );
        break;
      }
      case 'set_transition': {
        const transition = composition.transitions.find(
          (candidate) => candidate.id === operation.transitionId,
        );
        if (!transition) throw new Error(`Transition not found: ${operation.transitionId}`);
        if (operation.durationFrames !== undefined) {
          const previousFrames = new Map(
            computeKeyframeFrames(composition).map((item) => [item.keyframeId, item.frame]),
          );
          const previousDuration = transition.durationFrames;
          transition.durationFrames = Math.max(0, Math.round(operation.durationFrames));
          if (transition.durationFrames !== previousDuration) {
            const nextFrames = new Map(
              computeKeyframeFrames(composition).map((item) => [item.keyframeId, item.frame]),
            );
            const newTotal = getTotalFrames(composition);
            for (const layer of composition.layers) {
              const tracks = getResolvedLayerAnimationTracks(layer);
              for (const property of getLayerAnimatableProperties(layer)) {
                for (const key of tracks[property] ?? []) {
                  if (key.frame > newTotal) {
                    summary.warnings.push(
                      `Operation ${operationIndex}: transition retiming for layer "${layer.name}" property "${property}": key at frame ${key.frame} is outside the new composition duration ${newTotal}.`,
                    );
                  }
                  for (const [keyframeId, oldFrame] of previousFrames) {
                    const nextFrame = nextFrames.get(keyframeId);
                    if (
                      nextFrame !== undefined &&
                      oldFrame !== nextFrame &&
                      key.frame === oldFrame
                    ) {
                      summary.warnings.push(
                        `Operation ${operationIndex}: transition retiming for layer "${layer.name}" property "${property}": key remains at moved lifecycle frame ${oldFrame}; lifecycle "${keyframeId}" is now frame ${nextFrame}.`,
                      );
                    }
                  }
                }
              }
            }
          }
        }
        if (operation.easing !== undefined) transition.easing = operation.easing;
        break;
      }
    }
  });

  summary.operationTypes = [...new Set(summary.operationTypes)];
  summary.affectedCompositionIds = [...new Set(summary.affectedCompositionIds)];
  summary.affectedLayerIds = [...new Set(summary.affectedLayerIds)];
  summary.affectedFrames = [...new Set(summary.affectedFrames)].sort((a, b) => a - b);
  summary.warnings = [...new Set(summary.warnings)];
  return { project, summary };
}

export function materializeLayerAnimation(layer: Layer): void {
  materializeTracks(layer);
  for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
    if (!layer.animationTracks[property]?.length) {
      throw new Error(`Layer property track was not materialized: ${property}`);
    }
  }
  getLayerEffectsAtFrame(layer, 0);
}
