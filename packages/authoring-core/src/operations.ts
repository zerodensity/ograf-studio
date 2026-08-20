import {
  EFFECT_ANIMATION_PROPERTIES,
  TRANSFORM_ANIMATION_PROPERTIES,
  computeKeyframeFrames,
  createFieldDefinition,
  createAsset,
  createId,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  defaultTransformForRole,
  findLayerKeyframeAtFrame,
  getLayerAnimatableProperties,
  getLayerEffectsAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  gradientStopIndexForProperty,
  normalizeAuthoredTransformPatch,
  normalizeLayerEffects,
  pruneInvalidGradientStopTracks,
  resizeConstrainedTransform,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
  type AnimatableLayerProperty,
  type Composition,
  type EasingPreset,
  type Layer,
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
  const stopIndex = gradientStopIndexForProperty(property);
  if (stopIndex === null) return;
  const fill =
    layer.element.type === 'rectangle' || layer.element.type === 'ellipse'
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
  if (operation.element) Object.assign(layer.element, operation.element);
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
        ...new Set(sources.flatMap((layer) => (layer.binding ? [layer.binding.fieldId] : []))),
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
      if (bindings === 'clear') layer.binding = null;
      else if (bindings === 'clone' && layer.binding) {
        layer.binding.fieldId = fieldIds[layer.binding.fieldId]!;
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
  if ('layerIds' in operation) summary.affectedLayerIds.push(...operation.layerIds);
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
  };

  operations.forEach((operation, operationIndex) => {
    recordOperation(summary, operation);
    if (operation.type === 'set_project_metadata') {
      if (operation.name !== undefined) project.name = operation.name;
      if (operation.description !== undefined) project.description = operation.description;
      if (operation.version !== undefined) project.version = operation.version;
      if (operation.author !== undefined) project.author = clone(operation.author);
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
        if (operation.backgroundColor !== undefined)
          composition.backgroundColor = operation.backgroundColor;
        break;
      case 'set_composition_layout':
        Object.assign(composition.layout, operation.patch);
        break;
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
      case 'add_asset': {
        const compact = operation.data.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
          throw new Error('Asset data must be a valid base64 payload without a data-URI prefix.');
        }
        const asset = createAsset({
          name: operation.name.trim(),
          mimeType: operation.mimeType,
          dataUri: `data:${operation.mimeType};base64,${compact}`,
        });
        composition.assets.push(asset);
        summary.generatedIds.push({ operationIndex, kind: 'asset', id: asset.id });
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
      case 'duplicate_group':
        duplicateGroup(composition, operation, operationIndex, summary);
        break;
      case 'remove_layer':
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
      case 'update_element': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        if ('type' in operation.patch && operation.patch.type !== layer.element.type) {
          throw new Error('An element patch cannot change the layer element type.');
        }
        Object.assign(layer.element, operation.patch);
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
      case 'update_effects': {
        const layer = layerFor(composition, operation.layerId);
        assertUnlocked(layer);
        layer.effects = normalizeLayerEffects({ ...layer.effects, ...operation.patch });
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
          ...(operation.defaultValue !== undefined ? { defaultValue: operation.defaultValue } : {}),
          required: operation.required ?? false,
        });
        if (operation.id !== undefined) {
          if (composition.dataFields.some((candidate) => candidate.id === operation.id)) {
            throw new Error(`Data field id already exists: ${operation.id}`);
          }
          field.id = operation.id;
        }
        composition.dataFields.push(field);
        summary.generatedIds.push({ operationIndex, kind: 'field', id: field.id });
        break;
      }
      case 'update_data_field': {
        const field = composition.dataFields.find(
          (candidate) => candidate.id === operation.fieldId,
        );
        if (!field) throw new Error(`Data field not found: ${operation.fieldId}`);
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
        if (operation.defaultValue !== undefined) field.defaultValue = operation.defaultValue;
        if (operation.required !== undefined) field.required = operation.required;
        break;
      }
      case 'remove_data_field': {
        const field = composition.dataFields.find(
          (candidate) => candidate.id === operation.fieldId,
        );
        if (!field) throw new Error(`Data field not found: ${operation.fieldId}`);
        const consumers = composition.layers.filter(
          (layer) => layer.binding?.fieldId === operation.fieldId,
        );
        if (consumers.length > 0 && !operation.force) {
          throw new Error(
            `Cannot remove data field "${field.key}" while bound by layer${consumers.length === 1 ? '' : 's'}: ${consumers.map((layer) => `"${layer.name}" (${layer.id})`).join(', ')}. Pass force=true to clear these bindings atomically.`,
          );
        }
        for (const layer of consumers) {
          layer.binding = null;
          summary.clearedBindings.push({
            layerId: layer.id,
            layerName: layer.name,
            fieldId: field.id,
          });
          summary.affectedLayerIds.push(layer.id);
        }
        composition.dataFields = composition.dataFields.filter(
          (candidate) => candidate.id !== field.id,
        );
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
        layer.binding = operation.binding ? clone(operation.binding) : null;
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
