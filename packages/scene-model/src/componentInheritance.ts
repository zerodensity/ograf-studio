import { createId } from './id';
import { layerModifierGeometryReferences, remapLayerModifierReferences } from './modifiers';
import {
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  TRANSFORM_ANIMATION_PROPERTIES,
} from './layerAnimation';
import { remapVisualRule, visualRuleFieldIds, visualRuleReferencedLayerIds } from './visualRules';
import type {
  ComponentDefinition,
  Composition,
  FieldDefinition,
  Layer,
  LayerAnimationTracks,
  LayerKeyframe,
  LayerTransform,
  Project,
} from './types';
import { buildComponentDefinition } from './components';
import { computeKeyframeFrames } from './keyframeTiming';
import { layerMotionWindows } from './layerMotion';
import { retimeChartMarkAnimations } from './chartMarkAnimation';
import { remapClockTimerActionId, remapClockTimerLayerActions } from './clockTimer';

/** Scene documents contain JSON values; cloning recursively also accepts Immer draft proxies. */
export function cloneComponentValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneComponentValue) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneComponentValue(child)]),
    ) as T;
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    // Optional properties with undefined values have the same serialized JSON representation
    // as absent properties. They must not turn a copied animation channel into an override.
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    return (
      keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}
const escape = (part: string) => part.replaceAll('~', '~0').replaceAll('/', '~1');
const unescape = (part: string) => part.replaceAll('~1', '/').replaceAll('~0', '~');
const pointer = (path: string, key: string) => `${path}/${escape(key)}`;
const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
export interface ComponentInstanceIdentity {
  instanceId: string;
  groupId: string;
  layerIds: Record<string, string>;
  fieldIds: Record<string, string>;
  keyIds: Record<string, Record<string, string>>;
}
export function componentOverridePathIsSafe(path: string): boolean {
  return (
    path.startsWith('/') &&
    path !== '/' &&
    !/^\/(id|componentLink)(\/|$)/.test(path) &&
    path
      .split('/')
      .slice(1)
      .every((part) => !dangerous.has(unescape(part)))
  );
}
function assignJson<T extends object>(target: T, source: T): void {
  for (const key of Object.keys(target))
    if (!Object.hasOwn(source, key)) delete (target as Record<string, unknown>)[key];
  Object.assign(target, source);
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function snapshot(layer: Layer): Omit<Layer, 'componentLink'> {
  const { componentLink: _link, exportKey: _exportKey, ...properties } = layer;
  const copy = cloneComponentValue(properties);
  copy.animationTracks = cloneComponentValue(
    layer.animationTrackMode === 'independent'
      ? layer.animationTracks
      : getResolvedLayerAnimationTracks(layer),
  );
  return copy;
}

function differences(
  current: unknown,
  baseline: unknown,
  path = '',
  staticTransformProperties: readonly (keyof LayerTransform)[] = [],
): string[] {
  if (equal(current, baseline)) return [];
  if (record(current) && current.animationTrackMode === 'independent')
    staticTransformProperties = TRANSFORM_ANIMATION_PROPERTIES.filter(
      (property) =>
        !(current.animationTracks as Layer['animationTracks'] | undefined)?.[property]?.length,
    );
  if (path === '/keyframes' && Array.isArray(current) && Array.isArray(baseline)) {
    // Aggregate poses are normally derived from property tracks, so value/frame edits must not
    // replace the entire inherited array. A removed inherited pose is different: remember only
    // that stable identity, allowing the source to keep adding and retiming all other keys.
    const currentIds = new Set(current.map((key) => (key as { id?: string }).id));
    const currentFrames = new Set(current.map((key) => (key as { frame?: number }).frame));
    const removed = baseline.flatMap((key) => {
      const { id, frame } = key as { id?: string; frame?: number };
      return typeof id === 'string' && !currentIds.has(id) && !currentFrames.has(frame)
        ? [pointer(path, `@${id}`)]
        : [];
    });
    // Independent layers store unkeyed transform values in the base pose itself. Keep those
    // small overrides without treating derived animated pose snapshots as authored values.
    const base = [...current].sort(
      (left, right) => (left as LayerKeyframe).frame - (right as LayerKeyframe).frame,
    )[0] as LayerKeyframe | undefined;
    const previous = baseline.find((key) => (key as LayerKeyframe).id === base?.id) as
      LayerKeyframe | undefined;
    if (base && previous)
      for (const property of staticTransformProperties)
        if (base.transform[property] !== previous.transform[property])
          removed.push(pointer(pointer(pointer(path, `@${base.id}`), 'transform'), property));
    return removed;
  }
  if (path === '/keyframes' || path === '/id' || path === '/groupId') return [];
  if (
    (path === '/effects/stack' || path === '/modifiers') &&
    Array.isArray(current) &&
    Array.isArray(baseline)
  ) {
    const now = new Map(current.map((item) => [String((item as { id: string }).id), item]));
    const before = new Map(baseline.map((item) => [String((item as { id: string }).id), item]));
    const result = [...new Set([...now.keys(), ...before.keys()])].flatMap((id) =>
      differences(now.get(id), before.get(id), pointer(path, `@${id}`), staticTransformProperties),
    );
    if (!equal([...now.keys()], [...before.keys()])) result.push(`${path}/@order`);
    return result;
  }
  if (
    record(current) &&
    record(baseline) &&
    ![...Object.keys(current), ...Object.keys(baseline)].some((key) => dangerous.has(key))
  )
    return [...new Set([...Object.keys(current), ...Object.keys(baseline)])].flatMap((key) =>
      differences(current[key], baseline[key], pointer(path, key), staticTransformProperties),
    );
  return [path];
}

function valueAt(value: unknown, parts: string[]): unknown {
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current) && part.startsWith('@')) {
      if (part === '@order') return current.map((item) => (item as { id: string }).id);
      current = current.find((item) => (item as { id: string }).id === part.slice(1));
    } else if (record(current) && Object.hasOwn(current, part)) current = current[part];
    else return undefined;
  }
  return current;
}

function applyOverride(target: unknown, current: unknown, parts: string[]): void {
  if (!parts.length) return;
  const [part, ...rest] = parts;
  if (dangerous.has(part!)) throw new Error('Unsafe component override path.');
  if (Array.isArray(target) && part!.startsWith('@')) {
    if (part === '@order') {
      const ids = valueAt(current, ['@order']) as string[] | undefined;
      if (!ids) return;
      const order = new Map(ids.map((id, index) => [id, index]));
      target.sort(
        (left, right) =>
          (order.get((left as { id: string }).id) ?? ids.length) -
          (order.get((right as { id: string }).id) ?? ids.length),
      );
      return;
    }
    const id = part!.slice(1);
    const source = Array.isArray(current)
      ? current.find((item) => (item as { id: string }).id === id)
      : undefined;
    const index = target.findIndex((item) => (item as { id: string }).id === id);
    if (!rest.length) {
      if (source === undefined) {
        if (index >= 0) target.splice(index, 1);
      } else if (index >= 0) target[index] = cloneComponentValue(source);
      else target.push(cloneComponentValue(source));
      return;
    }
    if (source === undefined) return;
    if (index < 0) {
      target.push(cloneComponentValue(source));
      return;
    }
    applyOverride(target[index], source, rest);
    return;
  }
  if (!record(target)) return;
  const source = record(current) && Object.hasOwn(current, part!) ? current[part!] : undefined;
  if (!rest.length) {
    if (source === undefined) delete target[part!];
    else target[part!] = cloneComponentValue(source);
    return;
  }
  if (!Object.hasOwn(target, part!) || target[part!] === undefined) {
    if (source === undefined) return;
    target[part!] = cloneComponentValue(source);
  }
  applyOverride(target[part!], source, rest);
}

function mergeOverrides<T>(inherited: T, current: T, paths: readonly string[]): T {
  const next = cloneComponentValue(inherited);
  for (const path of [...paths].sort(
    (a, b) => Number(a.endsWith('/@order')) - Number(b.endsWith('/@order')),
  )) {
    if (!componentOverridePathIsSafe(path)) throw new Error('Unsafe component override path.');
    applyOverride(next, current, path.split('/').slice(1).map(unescape));
  }
  return next;
}

function mapSchema(
  field: FieldDefinition,
  ids: Record<string, string>,
  layers: Record<string, string>,
): FieldDefinition {
  const next = cloneComponentValue(field);
  next.id = ids[field.id] ??= createId('field');
  next.properties = field.properties.map((child) => mapSchema(child, ids, layers));
  if (field.items) next.items = mapSchema(field.items, ids, layers);
  if (next.generatedShaderParameter && layers[next.generatedShaderParameter.layerId])
    next.generatedShaderParameter.layerId = layers[next.generatedShaderParameter.layerId]!;
  return next;
}

function inferSchemaIds(
  source: FieldDefinition,
  actual: FieldDefinition,
  ids: Record<string, string>,
): void {
  ids[source.id] ??= actual.id;
  for (const child of source.properties) {
    const match = actual.properties.find((item) => item.key === child.key);
    if (match) inferSchemaIds(child, match, ids);
  }
  if (source.items && actual.items) inferSchemaIds(source.items, actual.items, ids);
}

function inferFieldIds(
  definition: ComponentDefinition,
  layers: Layer[],
  composition: Composition,
): Record<string, string> {
  const ids = Object.assign(
    {},
    ...layers.map((layer) => layer.componentLink?.fieldIds ?? {}),
  ) as Record<string, string>;
  for (const source of definition.layers) {
    const actual = layers.find((layer) => layer.componentLink?.sourceLayerId === source.id);
    if (!actual) continue;
    for (const binding of source.bindings) {
      const match = actual.bindings.find(
        (item) =>
          item.targetProperty === binding.targetProperty &&
          equal(item.sourcePath ?? [], binding.sourcePath ?? []),
      );
      if (match) ids[binding.fieldId] ??= match.fieldId;
    }
    const sourceRuleFields = (source.visualRules ?? []).flatMap(visualRuleFieldIds);
    const actualRuleFields = (actual.visualRules ?? []).flatMap(visualRuleFieldIds);
    sourceRuleFields.forEach((id, index) => {
      if (actualRuleFields[index]) ids[id] ??= actualRuleFields[index]!;
    });
    for (const modifier of source.modifiers ?? []) {
      if (modifier.type !== 'hide-empty' || modifier.params.source.kind !== 'field') continue;
      const match = actual.modifiers?.find((entry) => entry.id === modifier.id);
      if (match?.type === 'hide-empty' && match.params.source.kind === 'field')
        ids[modifier.params.source.fieldId] ??= match.params.source.fieldId;
    }
  }
  for (const field of definition.dataFields) {
    const actual = composition.dataFields.find((item) => item.id === ids[field.id]);
    if (actual) inferSchemaIds(field, actual, ids);
  }
  return ids;
}

function inferKeys(source: Layer, actual: Layer, ids: Record<string, string>): void {
  source.keyframes.forEach((key, index) => {
    const match =
      actual.keyframes.find((item) => item.frame === key.frame) ?? actual.keyframes[index];
    if (match) ids[key.id] ??= match.id;
  });
  const from = getResolvedLayerAnimationTracks(source);
  const to = getResolvedLayerAnimationTracks(actual);
  for (const [property, keys] of Object.entries(from))
    keys?.forEach((key, index) => {
      const matches = to[property as keyof LayerAnimationTracks];
      const match = matches?.find((item) => item.frame === key.frame) ?? matches?.[index];
      if (match) ids[key.id] ??= match.id;
    });
  if (source.loop && actual.loop) {
    ids[source.loop.id] ??= actual.loop.id;
    for (const [property, keys] of Object.entries(source.loop.tracks))
      keys?.forEach((key, index) => {
        const matches = actual.loop?.tracks[property as keyof LayerAnimationTracks];
        const match = matches?.find((item) => item.frame === key.frame) ?? matches?.[index];
        if (match) ids[key.id] ??= match.id;
      });
  }
  (source.visualRules ?? []).forEach((rule, index) => {
    const match =
      actual.visualRules.find((candidate) => candidate.id === rule.id) ?? actual.visualRules[index];
    if (match) ids[rule.id] ??= match.id;
  });
}

/** Cue identities are shared by an instance; animation and rule identities belong to one child. */
function instanceCueKeys(layers: Layer[]): Record<string, string> {
  return Object.assign(
    {},
    ...layers.map((layer) =>
      Object.fromEntries(
        Object.entries(layer.componentLink?.keyIds ?? {}).filter(([key]) =>
          key.startsWith('__cue:'),
        ),
      ),
    ),
  ) as Record<string, string>;
}

function translate(layer: Layer, offset: { x: number; y: number }): void {
  for (const key of layer.keyframes) {
    key.transform.x += offset.x;
    key.transform.y += offset.y;
  }
  for (const tracks of [layer.animationTracks, layer.loop?.tracks]) {
    for (const axis of ['x', 'y'] as const)
      for (const key of tracks?.[axis] ?? []) key.value += offset[axis];
  }
}

function aggregate(layer: Layer, previous?: Layer, ids: Record<string, string> = {}): void {
  const frames = [
    ...new Set([
      ...layer.keyframes.map((key) => key.frame),
      ...TRANSFORM_ANIMATION_PROPERTIES.flatMap((property) =>
        (layer.animationTracks[property] ?? []).map((key) => key.frame),
      ),
    ]),
  ].sort((a, b) => a - b);
  const used = new Set<string>();
  layer.keyframes = frames.map((frame) => {
    const authored = layer.keyframes.find((key) => key.frame === frame);
    const old = previous?.keyframes.find((key) => key.frame === frame);
    let id = old?.id ?? authored?.id ?? (ids[`__aggregate:${frame}`] ??= createId('layer-key'));
    if (used.has(id)) id = ids[`__aggregate:${frame}`] ??= createId('layer-key');
    used.add(id);
    return {
      id,
      frame,
      transform: cloneComponentValue(getLayerTransformAtFrame(layer, frame)),
      easing: authored?.easing ?? old?.easing ?? 'linear',
    };
  });
}

/** Resolve portable source lifecycle IDs without changing their canonical identities. */
export function componentLifecycleIds(
  composition: Composition,
  definition: ComponentDefinition,
): Map<string, string> {
  const result = new Map(composition.keyframes.map((key) => [key.id, key.id]));
  const source = definition.context?.keyframes ?? composition.keyframes;
  const steps = composition.keyframes.filter((key) => key.role === 'step');
  let ordinal = 0;
  for (const key of source) {
    const stepIndex = key.role === 'step' ? ordinal++ : -1;
    const match =
      composition.keyframes.find((item) => item.id === key.id) ??
      composition.keyframes.find((item) => item.role === key.role && item.name === key.name) ??
      (key.role === 'step'
        ? steps[stepIndex]
        : composition.keyframes.find((item) => item.role === key.role));
    if (match) result.set(key.id, match.id);
  }
  return result;
}

/** Map authored frames between a component's canonical lifecycle and its host template. */
export function componentFrameMapper(
  composition: Composition,
  definition: ComponentDefinition,
  direction: 'instance' | 'source' = 'instance',
): (frame: number) => number {
  const context = definition.context;
  if (!context) return (frame) => frame;
  const ids = componentLifecycleIds(composition, definition);
  const actual = new Map(
    computeKeyframeFrames(composition).map((key) => [key.keyframeId, key.frame]),
  );
  const anchors = computeKeyframeFrames({
    ...composition,
    keyframes: context.keyframes,
    transitions: context.transitions,
  })
    .flatMap((key) => {
      const target = actual.get(ids.get(key.keyframeId) ?? '');
      return target === undefined
        ? []
        : [
            direction === 'source'
              ? { from: target, to: key.frame }
              : { from: key.frame, to: target },
          ];
    })
    .sort((a, b) => a.from - b.from);
  return (frame) => {
    if (!anchors.length) return frame;
    if (frame <= anchors[0]!.from) return anchors[0]!.to;
    for (let index = 1; index < anchors.length; index++) {
      const from = anchors[index - 1]!;
      const to = anchors[index]!;
      if (frame <= to.from && to.from > from.from)
        return Math.round(
          from.to + ((to.to - from.to) * (frame - from.from)) / (to.from - from.from),
        );
    }
    const end = anchors.at(-1)!;
    const ratio =
      direction === 'source'
        ? context.frameRate / composition.frameRate
        : composition.frameRate / context.frameRate;
    return Math.round(end.to + (frame - end.from) * ratio);
  };
}

function installContext(composition: Composition, definition: ComponentDefinition): void {
  const context = definition.context;
  if (!context) return;
  for (const action of context.customActions)
    if (!composition.customActions.some((item) => item.actionId === action.actionId))
      composition.customActions.push(cloneComponentValue(action));
  for (const plugin of context.rendererPlugins ?? []) {
    composition.rendererPlugins ??= [];
    if (
      !composition.rendererPlugins.some(
        (item) =>
          item.sha256 === plugin.sha256 &&
          item.manifest.id === plugin.manifest.id &&
          item.manifest.version === plugin.manifest.version,
      )
    )
      composition.rendererPlugins.push(cloneComponentValue(plugin));
  }
  for (const plugin of context.animationPresetPlugins ?? []) {
    composition.animationPresetPlugins ??= [];
    if (
      !composition.animationPresetPlugins.some(
        (item) =>
          item.sha256 === plugin.sha256 &&
          item.manifest.id === plugin.manifest.id &&
          item.manifest.version === plugin.manifest.version,
      )
    )
      composition.animationPresetPlugins.push(cloneComponentValue(plugin));
  }
  if (context.designSystem) {
    for (const token of context.designSystem.tokens)
      if (!composition.designSystem.tokens.some((item) => item.id === token.id))
        composition.designSystem.tokens.push(cloneComponentValue(token));
    for (const style of context.designSystem.typography ?? []) {
      composition.designSystem.typography ??= [];
      if (!composition.designSystem.typography.some((item) => item.id === style.id))
        composition.designSystem.typography.push(cloneComponentValue(style));
    }
    for (const style of context.designSystem.backgrounds ?? []) {
      composition.designSystem.backgrounds ??= [];
      if (!composition.designSystem.backgrounds.some((item) => item.id === style.id))
        composition.designSystem.backgrounds.push(cloneComponentValue(style));
    }
  }
}

function instanceContext(
  composition: Composition,
  definition: ComponentDefinition,
  layers: Record<string, string>,
  keys: Record<string, string>,
): {
  lifecycle: Map<string, string>;
  frame: (frame: number) => number;
  cues: Map<string, string>;
  fpsRatio: number;
} {
  const lifecycle = componentLifecycleIds(composition, definition);
  const frame = componentFrameMapper(composition, definition);
  const cues = new Map<string, string>();
  installContext(composition, definition);
  for (const source of definition.context?.mediaCues ?? []) {
    const targetId = source.visual.targetLayerId ? layers[source.visual.targetLayerId] : null;
    if (source.visual.targetLayerId && !targetId)
      throw new Error(`Component "${definition.name}" has a media target outside its children.`);
    const key = `__cue:${source.id}`;
    const existing =
      composition.mediaCues.find((cue) => cue.id === keys[key]) ??
      composition.mediaCues.find(
        (cue) => cue.id === source.id && cue.visual.targetLayerId === targetId,
      );
    const cue = cloneComponentValue(source);
    if (cue.trigger.type === 'customAction')
      cue.trigger.actionId = remapClockTimerActionId(
        cue.trigger.actionId,
        new Map(Object.entries(layers)),
      );
    cue.id = keys[key] ??= existing?.id ?? createId('media-cue');
    cue.visual.targetLayerId = targetId ?? null;
    if (cue.trigger.type === 'lifecycle') {
      const id = lifecycle.get(cue.trigger.keyframeId);
      if (!id)
        throw new Error(`Component "${definition.name}" requires a missing lifecycle state.`);
      cue.trigger.keyframeId = id;
    } else if (cue.trigger.type === 'timeline')
      cue.trigger.startFrame = frame(cue.trigger.startFrame);
    const fpsRatio =
      composition.frameRate / (definition.context?.frameRate ?? composition.frameRate);
    if (cue.durationFrames !== null)
      cue.durationFrames = Math.max(1, Math.round(cue.durationFrames * fpsRatio));
    cue.transition.durationFrames = Math.max(
      0,
      Math.round(cue.transition.durationFrames * fpsRatio),
    );
    if (!existing) composition.mediaCues.push(cue);
    cues.set(source.id, cue.id);
  }
  return {
    lifecycle,
    frame,
    cues,
    fpsRatio: composition.frameRate / (definition.context?.frameRate ?? composition.frameRate),
  };
}

function materializeLayer(
  source: Layer,
  definition: ComponentDefinition,
  layerIds: Record<string, string>,
  fieldIds: Record<string, string>,
  keyIds: Record<string, string>,
  offset: { x: number; y: number },
  groupId: string | null,
  context?: ReturnType<typeof instanceContext>,
): Layer {
  const layer = cloneComponentValue(source);
  delete layer.exportKey;
  layer.id = layerIds[source.id]!;
  layer.name = `${definition.name} — ${source.name}`;
  layer.groupId = groupId;
  layer.componentLink = null;
  remapClockTimerLayerActions(layer, new Map(Object.entries(layerIds)));
  layer.parentId = source.parentId ? (layerIds[source.parentId] ?? null) : null;
  if (layer.mask)
    layer.mask.sourceLayerId = layerIds[layer.mask.sourceLayerId] ?? layer.mask.sourceLayerId;
  if (layer.motionPath)
    layer.motionPath.sourceLayerId =
      layerIds[layer.motionPath.sourceLayerId] ?? layer.motionPath.sourceLayerId;
  if (layer.textPath)
    layer.textPath.sourceLayerId =
      layerIds[layer.textPath.sourceLayerId] ?? layer.textPath.sourceLayerId;
  if (layer.modifiers) {
    const groups = new Map(
      definition.layers.flatMap((child) =>
        child.groupId && groupId ? [[child.groupId, groupId] as const] : [],
      ),
    );
    layer.modifiers = remapLayerModifierReferences(layer.modifiers, {
      layers: layerIds,
      groups,
      fields: fieldIds,
    })!;
  }
  layer.keyframes = layer.keyframes.map((key) => ({
    ...key,
    id: (keyIds[key.id] ??= createId('layer-key')),
  }));
  layer.animationTracks = cloneComponentValue(
    source.animationTrackMode === 'independent'
      ? source.animationTracks
      : getResolvedLayerAnimationTracks(source),
  );
  for (const keys of Object.values(layer.animationTracks))
    for (const key of keys ?? []) key.id = keyIds[key.id] ??= createId('property-key');
  if (layer.loop) {
    layer.loop.id = keyIds[layer.loop.id] ??= createId('layer-loop');
    if (layer.loop.timing) {
      layer.loop.timing.holdFieldId =
        fieldIds[layer.loop.timing.holdFieldId] ?? layer.loop.timing.holdFieldId;
      if (groupId) layer.loop.timing.groupId = `${groupId}:${layer.loop.timing.groupId}`;
    }
    for (const keys of Object.values(layer.loop.tracks))
      for (const key of keys ?? []) key.id = keyIds[key.id] ??= createId('loop-property-key');
  }
  layer.bindings = layer.bindings.map((binding) => ({
    ...binding,
    fieldId: fieldIds[binding.fieldId] ?? binding.fieldId,
  }));
  layer.visualRules = (source.visualRules ?? []).map((rule) =>
    remapVisualRule(cloneComponentValue(rule), {
      id: (keyIds[rule.id] ??= createId('visual-rule')),
      layerIds: new Map(Object.entries(layerIds)),
      fieldIds: new Map(Object.entries(fieldIds)),
      groupIds: new Map(
        definition.layers.flatMap((child) =>
          child.groupId && groupId ? [[child.groupId, groupId] as const] : [],
        ),
      ),
    }),
  );
  if (context) {
    if (layer.element.type === 'chart' && definition.context)
      retimeChartMarkAnimations(
        layer.element,
        layerMotionWindows(definition.context),
        context.frame,
      );
    for (const key of layer.keyframes) key.frame = context.frame(key.frame);
    for (const entries of Object.values(layer.animationTracks))
      for (const key of entries ?? []) key.frame = context.frame(key.frame);
    if (layer.loop) {
      layer.loop.durationFrames = Math.max(
        1,
        Math.round(layer.loop.durationFrames * context.fpsRatio),
      );
      layer.loop.phaseOffsetFrames = Math.round(layer.loop.phaseOffsetFrames * context.fpsRatio);
      for (const range of layer.loop.timing?.holdRanges ?? []) {
        range.startFrame = Math.round(range.startFrame * context.fpsRatio);
        range.endFrame = Math.round(range.endFrame * context.fpsRatio);
      }
      for (const entries of Object.values(layer.loop.tracks))
        for (const key of entries ?? []) key.frame = Math.round(key.frame * context.fpsRatio);
      if (layer.loop.activation.type === 'step') {
        const target = context.lifecycle.get(layer.loop.activation.stepKeyframeId);
        if (!target)
          throw new Error(`Component "${definition.name}" requires a missing Step state.`);
        layer.loop.activation.stepKeyframeId = target;
      }
    }
    const sourceFrames =
      definition.context &&
      computeKeyframeFrames({
        keyframes: definition.context.keyframes,
        transitions: definition.context.transitions,
      } as Composition);
    for (const side of ['in', 'out'] as const) {
      const spec = layer.motion?.[side];
      const boundary =
        side === 'in'
          ? sourceFrames?.find((key) =>
              definition.context?.keyframes.some(
                (source) => source.id === key.keyframeId && source.role === 'step',
              ),
            )?.frame
          : sourceFrames?.at(-1)?.frame;
      if (spec && boundary !== undefined) {
        const end = boundary - (spec.offsetFrames ?? 0);
        spec.durationFrames = Math.max(
          1,
          context.frame(end) - context.frame(end - spec.durationFrames),
        );
        if (spec.offsetFrames !== undefined)
          spec.offsetFrames = Math.max(0, context.frame(boundary) - context.frame(end));
      }
      const preset = layer.animationPresets?.[side];
      if (preset && boundary !== undefined) {
        const end = boundary - (preset.offsetFrames ?? 0);
        preset.durationFrames = Math.max(
          1,
          context.frame(end) - context.frame(end - preset.durationFrames),
        );
        if (preset.offsetFrames !== undefined)
          preset.offsetFrames = Math.max(0, context.frame(boundary) - context.frame(end));
      }
    }
    if (layer.element.type === 'text') {
      layer.element.textAnimation.durationFrames = Math.max(
        1,
        Math.round(layer.element.textAnimation.durationFrames * context.fpsRatio),
      );
      layer.element.textAnimation.cursorBlinkFrames = Math.max(
        1,
        Math.round(layer.element.textAnimation.cursorBlinkFrames * context.fpsRatio),
      );
    }
    layer.updateTransition.durationFrames = Math.max(
      0,
      Math.round(layer.updateTransition.durationFrames * context.fpsRatio),
    );
    if (layer.element.type === 'chart' && layer.element.animation) {
      layer.element.animation.durationFrames = Math.max(
        1,
        Math.round(layer.element.animation.durationFrames * context.fpsRatio),
      );
      layer.element.animation.delayFrames = Math.round(
        layer.element.animation.delayFrames * context.fpsRatio,
      );
      layer.element.animation.staggerFrames = Math.round(
        layer.element.animation.staggerFrames * context.fpsRatio,
      );
    }
    for (const rule of layer.visualRules) {
      if (rule.trigger === 'step' && rule.eventId) {
        const target = context.lifecycle.get(rule.eventId);
        if (!target)
          throw new Error(`Component "${definition.name}" requires a missing Step rule target.`);
        rule.eventId = target;
      }
      if (rule.delayFrames !== undefined)
        rule.delayFrames = Math.round(rule.delayFrames * context.fpsRatio);
      for (const action of rule.actions) {
        if (action.type === 'play-sound' || action.type === 'take-media')
          action.cueId = context.cues.get(action.cueId) ?? action.cueId;
        if ('transitionFrames' in action && action.transitionFrames !== undefined)
          action.transitionFrames = Math.round(action.transitionFrames * context.fpsRatio);
      }
    }
  }
  translate(layer, offset);
  aggregate(layer, undefined, keyIds);
  return layer;
}

/** Install portable resources once without replacing unrelated local resource edits. */
export function installComponentResources(
  composition: Composition,
  definition: ComponentDefinition,
): void {
  for (const resource of definition.resources ?? [])
    if (!composition.assets.some((item) => item.id === resource.id))
      composition.assets.push(cloneComponentValue(resource));
  for (const pattern of definition.patterns ?? [])
    if (!composition.patterns.some((item) => item.id === pattern.id))
      composition.patterns.push(cloneComponentValue(pattern));
  installContext(composition, definition);
}

export function materializeComponentInstance(
  composition: Composition,
  definition: ComponentDefinition,
  offset = { x: 40, y: 40 },
  linked = true,
  identity?: ComponentInstanceIdentity,
): {
  instanceId: string;
  groupId: string;
  layers: Layer[];
  dataFields: FieldDefinition[];
  layerIds: Record<string, string>;
  fieldIds: Record<string, string>;
} {
  if (!definition.layers.length) throw new Error('Component contains no layers.');
  for (const layer of definition.layers)
    for (const reference of layerModifierGeometryReferences(layer)) {
      const members = definition.layers.filter((child) =>
        reference.kind === 'layer'
          ? child.id === reference.layerId
          : child.groupId === reference.groupId,
      );
      if (
        !members.length ||
        (reference.kind === 'group' && members.length !== definition.layers.length)
      )
        throw new Error(
          'Component modifier references must remain inside its children; subgroup references cannot be widened to the whole component.',
        );
    }
  installComponentResources(composition, definition);
  const layerIds = Object.fromEntries(
    definition.layers.map((layer) => [layer.id, identity?.layerIds[layer.id] ?? createId('layer')]),
  );
  const fieldIds: Record<string, string> = cloneComponentValue(identity?.fieldIds ?? {});
  const used = new Set(composition.dataFields.map((field) => field.key));
  const dataFields = definition.dataFields.map((field) => {
    const next = mapSchema(field, fieldIds, layerIds);
    let suffix = 2;
    while (used.has(next.key)) next.key = `${field.key}_${suffix++}`;
    used.add(next.key);
    return next;
  });
  const fieldBaselines = Object.fromEntries(
    definition.dataFields.map((field, index) => [
      field.id,
      cloneComponentValue(dataFields[index]!),
    ]),
  );
  const groupId = identity?.groupId ?? createId('group');
  const instanceId = identity?.instanceId ?? createId('component-instance');
  const contextKeys = Object.assign(
    {},
    ...Object.values(identity?.keyIds ?? {}).map((keys) =>
      Object.fromEntries(Object.entries(keys).filter(([key]) => key.startsWith('__cue:'))),
    ),
  ) as Record<string, string>;
  const context = instanceContext(composition, definition, layerIds, contextKeys);
  const layers = definition.layers.map((source) => {
    const keyIds = { ...cloneComponentValue(identity?.keyIds[source.id] ?? {}), ...contextKeys };
    const layer = materializeLayer(
      source,
      definition,
      layerIds,
      fieldIds,
      keyIds,
      offset,
      groupId,
      context,
    );
    if (linked)
      layer.componentLink = {
        componentId: definition.id,
        instanceId,
        sourceLayerId: source.id,
        baseline: snapshot(layer),
        overridePaths: [],
        fieldIds: cloneComponentValue(fieldIds),
        keyIds,
        fieldBaselines: cloneComponentValue(fieldBaselines),
        fieldOverridePaths: {},
        offset: { ...offset },
      };
    return layer;
  });
  return { instanceId, groupId, layers, dataFields, layerIds, fieldIds };
}

/** Convert the saved selection into its first live instance without replacing any scene identity. */
export function linkExistingComponentLayers(
  composition: Composition,
  definition: ComponentDefinition,
  layerIds: string[],
): {
  instanceId: string;
  groupId: string;
  layers: Layer[];
  dataFields: FieldDefinition[];
  layerIds: Record<string, string>;
  fieldIds: Record<string, string>;
} {
  const selected = new Set(layerIds);
  const layers = composition.layers.filter((layer) => selected.has(layer.id));
  if (!layers.length || layers.length !== definition.layers.length)
    throw new Error('The original component selection must match its saved children.');
  const instanceId = createId('component-instance');
  const groupId = createId('group');
  const mapping = Object.fromEntries(
    definition.layers.map((source, index) => [source.id, layers[index]!.id]),
  );
  const fields: Record<string, string> = {};
  for (const field of definition.dataFields) {
    const actual = composition.dataFields.find((item) => item.id === field.id);
    if (actual) inferSchemaIds(field, actual, fields);
  }
  const contextKeys: Record<string, string> = {};
  const context = instanceContext(composition, definition, mapping, contextKeys);
  const ruleGroups = new Map([
    ...layers.flatMap((child) => (child.groupId ? [[child.groupId, groupId] as const] : [])),
    ...definition.layers.flatMap((child) =>
      child.groupId ? [[child.groupId, groupId] as const] : [],
    ),
  ]);
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]!;
    const source = definition.layers[index]!;
    const keys: Record<string, string> = { ...contextKeys };
    inferKeys(source, layer, keys);
    layer.groupId = groupId;
    layer.visualRules = (layer.visualRules ?? []).map((rule) =>
      remapVisualRule(rule, { id: rule.id, groupIds: ruleGroups }),
    );
    const inherited = materializeLayer(
      source,
      definition,
      mapping,
      fields,
      keys,
      { x: 0, y: 0 },
      groupId,
      context,
    );
    layer.componentLink = {
      componentId: definition.id,
      instanceId,
      sourceLayerId: source.id,
      baseline: snapshot(inherited),
      overridePaths: differences(snapshot(layer), snapshot(inherited)),
      fieldIds: cloneComponentValue(fields),
      keyIds: keys,
      fieldBaselines: Object.fromEntries(
        definition.dataFields.flatMap((field) => {
          const actual = composition.dataFields.find((item) => item.id === fields[field.id]);
          return actual ? [[field.id, cloneComponentValue(actual)]] : [];
        }),
      ),
      fieldOverridePaths: {},
      offset: { x: 0, y: 0 },
    };
  }
  return {
    instanceId,
    groupId,
    layers,
    dataFields: composition.dataFields.filter((field) => Object.values(fields).includes(field.id)),
    layerIds: mapping,
    fieldIds: fields,
  };
}

/** Rebase a promoted selection onto its new asset while keeping scene/field/key identities. */
export function adoptComponentSourceLayers(
  composition: Composition,
  definition: ComponentDefinition,
  layerIds: string[],
): string {
  const wanted = new Set(layerIds);
  const selected = composition.layers.filter((layer) => wanted.has(layer.id));
  const reference = selected.find((layer) => layer.componentLink?.componentId === definition.id);
  const instanceId = reference?.componentLink?.instanceId ?? createId('component-instance');
  const groupId =
    reference?.groupId ?? selected.find((layer) => layer.groupId)?.groupId ?? createId('group');
  const offset = cloneComponentValue(reference?.componentLink?.offset ?? { x: 0, y: 0 });
  const canonical = (layer: Layer) =>
    layer.componentLink?.componentId === definition.id
      ? layer.componentLink.sourceLayerId
      : layer.id;
  const mapping = Object.fromEntries(selected.map((layer) => [canonical(layer), layer.id]));
  const fields = Object.assign(
    {},
    ...selected.map((layer) => layer.componentLink?.fieldIds ?? {}),
  ) as Record<string, string>;
  // Fields newly introduced by independent layers already use their source schema identities.
  for (const field of definition.dataFields) {
    const actual = composition.dataFields.find(
      (item) => item.id === (fields[field.id] ?? field.id),
    );
    if (actual) inferSchemaIds(field, actual, fields);
  }
  const keysByLayer = new Map(
    selected.map((layer) => [layer.id, cloneComponentValue(layer.componentLink?.keyIds ?? {})]),
  );
  const contextKeys = instanceCueKeys(selected);
  const context = instanceContext(composition, definition, mapping, contextKeys);
  const fieldBaselines = Object.fromEntries(
    definition.dataFields.map((field) => {
      const baseline = mapSchema(field, fields, mapping);
      const actual = composition.dataFields.find((item) => item.id === baseline.id);
      if (actual) baseline.key = actual.key;
      return [field.id, baseline];
    }),
  );
  for (const layer of selected) {
    const source = definition.layers.find((item) => item.id === canonical(layer));
    if (!source) throw new Error('The promoted component source selection is incomplete.');
    const keys = { ...contextKeys, ...keysByLayer.get(layer.id) };
    inferKeys(source, layer, keys);
    // Keep authored groups intact. An ungrouped new child joins the source instance group.
    layer.groupId ??= groupId;
    const inherited = materializeLayer(
      source,
      definition,
      mapping,
      fields,
      keys,
      offset,
      layer.groupId,
      context,
    );
    layer.componentLink = {
      componentId: definition.id,
      instanceId,
      sourceLayerId: source.id,
      baseline: snapshot(inherited),
      // Values promoted to the asset are inherited again. External-only references and other
      // information excluded from a portable asset remain explicit instance overrides.
      overridePaths: differences(snapshot(layer), snapshot(inherited)),
      fieldIds: cloneComponentValue(fields),
      keyIds: keys,
      fieldBaselines: cloneComponentValue(fieldBaselines),
      fieldOverridePaths: {},
      offset: { ...offset },
    };
  }
  return instanceId;
}

/** Populate optional metadata without replacing existing scene, field or animation identities. */
export function initializeComponentInheritance(
  composition: Composition,
  previousComposition?: Composition,
): void {
  const instances = new Set(
    composition.layers.flatMap((layer) =>
      layer.componentLink ? [layer.componentLink.instanceId] : [],
    ),
  );
  for (const instanceId of instances) {
    const layers = composition.layers.filter(
      (layer) => layer.componentLink?.instanceId === instanceId,
    );
    const first = layers[0]?.componentLink;
    if (!first) continue;
    const definition =
      previousComposition?.components.find((item) => item.id === first.componentId) ??
      composition.components.find((item) => item.id === first.componentId);
    if (!definition) continue;
    const fieldIds = inferFieldIds(definition, layers, composition);
    const layerIds = Object.fromEntries(
      layers.map((layer) => [layer.componentLink!.sourceLayerId, layer.id]),
    );
    for (const source of definition.dataFields) {
      if (!fieldIds[source.id]) {
        const existing = composition.dataFields.find((field) => field.key === source.key);
        if (existing) inferSchemaIds(source, existing, fieldIds);
        else fieldIds[source.id] = createId('field');
      }
    }
    const reference = layers.find((layer) =>
      definition.layers.some((source) => source.id === layer.componentLink?.sourceLayerId),
    );
    const sourceReference = definition.layers.find(
      (source) => source.id === reference?.componentLink?.sourceLayerId,
    );
    const offset =
      first.offset ??
      (reference && sourceReference
        ? {
            x:
              getLayerTransformAtFrame(reference, 0).x -
              getLayerTransformAtFrame(sourceReference, 0).x,
            y:
              getLayerTransformAtFrame(reference, 0).y -
              getLayerTransformAtFrame(sourceReference, 0).y,
          }
        : { x: 0, y: 0 });
    const fieldBaselines = Object.fromEntries(
      definition.dataFields.map((field) => {
        const actual = composition.dataFields.find((item) => item.id === fieldIds[field.id]);
        const baseline = mapSchema(field, fieldIds, layerIds);
        if (actual) baseline.key = actual.key;
        return [field.id, baseline];
      }),
    );
    const contextKeys = instanceCueKeys(layers);
    const context = instanceContext(composition, definition, layerIds, contextKeys);
    for (const layer of layers) {
      const link = layer.componentLink!;
      if (link.baseline && link.fieldIds && link.keyIds && link.offset) continue;
      const source = definition.layers.find((item) => item.id === link.sourceLayerId);
      if (!source) continue;
      const keyIds = { ...contextKeys, ...cloneComponentValue(link.keyIds ?? {}) };
      inferKeys(source, layer, keyIds);
      const inherited = materializeLayer(
        source,
        definition,
        layerIds,
        fieldIds,
        keyIds,
        offset,
        layer.groupId,
        context,
      );
      layer.componentLink = {
        ...cloneComponentValue(link),
        baseline: link.baseline ?? snapshot(inherited),
        overridePaths: link.overridePaths ?? [],
        fieldIds: cloneComponentValue(fieldIds),
        keyIds,
        fieldBaselines: link.fieldBaselines ?? cloneComponentValue(fieldBaselines),
        fieldOverridePaths: link.fieldOverridePaths ?? {},
        offset: { ...offset },
      };
    }
  }
}

function uniformTranslation(layers: Layer[]): { x: number; y: number } {
  const result = { x: 0, y: 0 };
  for (const axis of ['x', 'y'] as const) {
    const deltas: number[] = [];
    for (const layer of layers) {
      const baseline = layer.componentLink?.baseline;
      if (!baseline) continue;
      const now = getResolvedLayerAnimationTracks(layer)[axis] ?? [];
      const before = baseline.animationTracks[axis] ?? [];
      if (now.length !== before.length) {
        deltas.push(Number.NaN);
        continue;
      }
      for (const key of now) {
        const match = before.find((item) => item.id === key.id && item.frame === key.frame);
        deltas.push(match ? key.value - match.value : Number.NaN);
      }
      const local = layer.loop?.tracks[axis] ?? [];
      const inherited = baseline.loop?.tracks[axis] ?? [];
      if (local.length !== inherited.length) deltas.push(Number.NaN);
      for (const key of local) {
        const match = inherited.find((item) => item.id === key.id && item.frame === key.frame);
        deltas.push(match ? key.value - match.value : Number.NaN);
      }
    }
    const first = deltas[0] ?? 0;
    if (Number.isFinite(first) && deltas.every((value) => Math.abs(value - first) < 1e-7))
      result[axis] = first;
  }
  return result;
}

function referencesOutside(composition: Composition, removed: Set<string>): Set<string> {
  const references = new Set<string>();
  for (const layer of composition.layers) {
    if (removed.has(layer.id)) continue;
    if (layer.parentId) references.add(layer.parentId);
    if (layer.mask) references.add(layer.mask.sourceLayerId);
    if (layer.motionPath) references.add(layer.motionPath.sourceLayerId);
    if (layer.textPath) references.add(layer.textPath.sourceLayerId);
    for (const reference of layerModifierGeometryReferences(layer)) {
      if (reference.kind === 'layer') references.add(reference.layerId);
      else
        for (const member of composition.layers)
          if (member.groupId === reference.groupId) references.add(member.id);
    }
    for (const rule of layer.visualRules ?? [])
      for (const id of visualRuleReferencedLayerIds(rule)) references.add(id);
  }
  for (const cue of composition.mediaCues ?? [])
    if (cue.visual.targetLayerId) references.add(cue.visual.targetLayerId);
  for (const collection of composition.runtimeCollections)
    for (const id of collection.prototypeLayerIds) references.add(id);
  return references;
}

function retainRemovedChildAsPrivateAsset(composition: Composition, layer: Layer): void {
  const source = cloneComponentValue(layer);
  delete source.exportKey;
  source.componentLink = null;
  source.parentId = null;
  source.mask = null;
  source.motionPath = null;
  source.textPath = null;
  if (source.modifiers)
    source.modifiers = source.modifiers.filter((modifier) =>
      layerModifierGeometryReferences({ modifiers: [modifier] }).every(
        (reference) => reference.kind === 'layer' && reference.layerId === source.id,
      ),
    );
  source.visualRules = source.visualRules.flatMap((rule) => {
    if (
      rule.trigger === 'timer-alarm' &&
      rule.timerAlarm?.sourceLayerId &&
      rule.timerAlarm.sourceLayerId !== layer.id
    )
      return [];
    const actions = rule.actions.filter((action) => {
      if ('targetLayerId' in action && action.targetLayerId && action.targetLayerId !== layer.id)
        return false;
      if (action.type === 'play-sound' || action.type === 'take-media') {
        const cue = composition.mediaCues.find((item) => item.id === action.cueId);
        return !cue?.visual.targetLayerId || cue.visual.targetLayerId === layer.id;
      }
      return true;
    });
    return actions.length || (rule.trigger === 'timer-alarm' && rule.actions.length === 0)
      ? [{ ...rule, actions }]
      : [];
  });
  const definition = buildComponentDefinition(
    { ...composition, layers: [source] },
    [source.id],
    `${layer.name} retained`,
  );
  definition.scope = 'local';
  composition.components.push(definition);
  const fields: Record<string, string> = {};
  for (const field of definition.dataFields) {
    const actual = composition.dataFields.find((item) => item.id === field.id);
    if (actual) inferSchemaIds(field, actual, fields);
  }
  const keys: Record<string, string> = {};
  inferKeys(source, layer, keys);
  const layerIds = { [source.id]: layer.id };
  const context = instanceContext(composition, definition, layerIds, keys);
  const inherited = materializeLayer(
    definition.layers[0]!,
    definition,
    layerIds,
    fields,
    keys,
    { x: 0, y: 0 },
    layer.groupId,
    context,
  );
  layer.componentLink = {
    componentId: definition.id,
    instanceId: createId('component-instance'),
    sourceLayerId: source.id,
    baseline: snapshot(inherited),
    overridePaths: differences(snapshot(layer), snapshot(inherited)),
    fieldIds: fields,
    keyIds: keys,
    offset: { x: 0, y: 0 },
    fieldOverridePaths: Object.fromEntries(definition.dataFields.map((field) => [field.id, []])),
    fieldBaselines: Object.fromEntries(
      definition.dataFields.map((field) => [
        field.id,
        cloneComponentValue(
          composition.dataFields.find((item) => item.id === fields[field.id]) ?? field,
        ),
      ]),
    ),
  };
}

function preserveRequiredEffects(next: Layer, current: Layer): void {
  const paths = [
    ...Object.keys(next.animationTracks),
    ...Object.keys(next.loop?.tracks ?? {}),
    ...next.bindings.map((binding) => binding.targetProperty),
  ];
  for (const effect of current.effects.stack ?? [])
    if (
      paths.some((path) => path.startsWith(`effects.${effect.id}.`)) &&
      !next.effects.stack?.some((item) => item.id === effect.id)
    ) {
      next.effects.stack ??= [];
      next.effects.stack.push(cloneComponentValue(effect));
    }
}

/** Three-way reconciliation keeps materialized scene identities and every explicit local override. */
export function reconcileComponentInstances(
  composition: Composition,
  previousComposition?: Composition,
): string[] {
  initializeComponentInheritance(composition, previousComposition);
  const changed = new Set<string>();
  const instanceIds = new Set(
    composition.layers.flatMap((layer) =>
      layer.componentLink ? [layer.componentLink.instanceId] : [],
    ),
  );
  for (const instanceId of instanceIds) {
    const layers = composition.layers.filter(
      (layer) => layer.componentLink?.instanceId === instanceId,
    );
    const first = layers[0]?.componentLink;
    if (!first) continue;
    const definition = composition.components.find((item) => item.id === first.componentId);
    if (!definition) continue;
    installComponentResources(composition, definition);
    const delta = uniformTranslation(layers);
    if (delta.x || delta.y)
      for (const layer of layers) {
        const link = layer.componentLink!;
        const baseline = cloneComponentValue(link.baseline!);
        translate(baseline as Layer, delta);
        link.baseline = baseline;
        link.offset = { x: (link.offset?.x ?? 0) + delta.x, y: (link.offset?.y ?? 0) + delta.y };
      }
    const offset = cloneComponentValue(first.offset ?? { x: 0, y: 0 });
    const layerIds = Object.fromEntries(
      layers.map((layer) => [layer.componentLink!.sourceLayerId, layer.id]),
    );
    for (const source of definition.layers) layerIds[source.id] ??= createId('layer');
    const fieldIds = inferFieldIds(definition, layers, composition);
    const fieldBaselines: Record<string, FieldDefinition> = {};
    const contextKeys = instanceCueKeys(layers);
    const context = instanceContext(composition, definition, layerIds, contextKeys);
    const fieldOverrides = Object.assign(
      {},
      ...layers.map((layer) => layer.componentLink?.fieldOverridePaths ?? {}),
    ) as Record<string, string[]>;
    const usedKeys = new Set(composition.dataFields.map((field) => field.key));
    for (const source of definition.dataFields) {
      const inherited = mapSchema(source, fieldIds, layerIds);
      const existing = composition.dataFields.find((field) => field.id === inherited.id);
      if (existing) inherited.key = existing.key;
      else {
        let suffix = 2;
        while (usedKeys.has(inherited.key)) inherited.key = `${source.key}_${suffix++}`;
        usedKeys.add(inherited.key);
      }
      const previous =
        layers.flatMap((layer) =>
          layer.componentLink?.fieldBaselines?.[source.id]
            ? [layer.componentLink.fieldBaselines[source.id]!]
            : [],
        )[0] ?? inherited;
      const paths = [
        ...new Set([
          ...(fieldOverrides[source.id] ?? []),
          ...(existing ? differences(existing, previous) : []),
        ]),
      ].filter((path) => path !== '/id' && path !== '/key');
      fieldOverrides[source.id] = paths;
      const resolved = existing ? mergeOverrides(inherited, existing, paths) : inherited;
      fieldBaselines[source.id] = cloneComponentValue(inherited);
      if (existing) {
        if (!equal(existing, resolved)) assignJson(existing, resolved);
      } else composition.dataFields.push(resolved);
    }
    const removed = new Set(
      layers
        .filter(
          (layer) =>
            !definition.layers.some((source) => source.id === layer.componentLink?.sourceLayerId),
        )
        .map((layer) => layer.id),
    );
    const external = referencesOutside(composition, removed);
    for (const layer of layers.filter((item) => removed.has(item.id))) {
      const paths = [
        ...new Set([
          ...(layer.componentLink?.overridePaths ?? []),
          ...differences(snapshot(layer), layer.componentLink?.baseline),
        ]),
      ];
      if (external.has(layer.id) || paths.length)
        retainRemovedChildAsPrivateAsset(composition, layer);
      else {
        composition.layers.splice(
          composition.layers.findIndex((item) => item.id === layer.id),
          1,
        );
        for (const folder of composition.layout.timelineFolders)
          folder.layerIds = folder.layerIds.filter((id) => id !== layer.id);
      }
      changed.add(layer.id);
    }
    for (const source of definition.layers) {
      const existing = composition.layers.find((layer) => layer.id === layerIds[source.id]);
      const link = existing?.componentLink;
      const keyIds = { ...contextKeys, ...cloneComponentValue(link?.keyIds ?? {}) };
      const inherited = materializeLayer(
        source,
        definition,
        layerIds,
        fieldIds,
        keyIds,
        offset,
        existing ? existing.groupId : (layers[0]?.groupId ?? createId('group')),
        context,
      );
      const local = existing ? snapshot(existing) : snapshot(inherited);
      const paths = [
        ...new Set([
          ...(link?.overridePaths ?? []),
          ...(link?.baseline ? differences(local, link.baseline) : []),
        ]),
      ];
      const resolved = existing
        ? mergeOverrides(inherited, { ...local, componentLink: null }, paths)
        : inherited;
      if (existing) {
        resolved.id = existing.id;
        resolved.groupId = existing.groupId;
        if (existing.exportKey !== undefined) resolved.exportKey = existing.exportKey;
      }
      preserveRequiredEffects(resolved, existing ?? inherited);
      aggregate(resolved, existing, keyIds);
      resolved.componentLink = {
        componentId: definition.id,
        instanceId,
        sourceLayerId: source.id,
        baseline: snapshot(inherited),
        overridePaths: paths,
        fieldIds: cloneComponentValue(fieldIds),
        keyIds,
        fieldBaselines: cloneComponentValue(fieldBaselines),
        fieldOverridePaths: cloneComponentValue(fieldOverrides),
        offset: { ...offset },
      };
      if (!existing) {
        const last = Math.max(
          -1,
          ...composition.layers.map((layer, index) =>
            layer.componentLink?.instanceId === instanceId ? index : -1,
          ),
        );
        composition.layers.splice(last + 1, 0, resolved);
        changed.add(resolved.id);
      } else if (!equal(existing, resolved)) {
        for (const key of Object.keys(existing))
          if (!(key in resolved)) delete (existing as unknown as Record<string, unknown>)[key];
        Object.assign(existing, resolved);
        changed.add(existing.id);
      }
    }
  }
  return [...changed];
}

export function reconcileProjectComponentInstances(
  project: Project,
  previousProject?: Project,
): string[] {
  if (previousProject) {
    const edits = new Map<string, ComponentDefinition>();
    for (const composition of project.compositions)
      for (const definition of composition.components) {
        if (definition.scope !== 'set') continue;
        const previous = previousProject.compositions
          .find((item) => item.id === composition.id)
          ?.components.find((item) => item.id === definition.id);
        if (equal(previous, definition)) continue;
        const other = edits.get(definition.id);
        if (other && !equal(other, definition))
          throw new Error(`Shared component "${definition.name}" was edited inconsistently.`);
        edits.set(definition.id, definition);
      }
    for (const composition of project.compositions)
      for (const definition of edits.values()) {
        const index = composition.components.findIndex((item) => item.id === definition.id);
        if (index < 0) composition.components.push(cloneComponentValue(definition));
        else if (
          composition.components[index]?.scope !== 'local' &&
          !equal(composition.components[index], definition)
        )
          composition.components[index] = cloneComponentValue(definition);
      }
  }
  return [
    ...new Set(
      project.compositions.flatMap((composition) =>
        reconcileComponentInstances(
          composition,
          previousProject?.compositions.find((item) => item.id === composition.id),
        ),
      ),
    ),
  ];
}

/** Restore this source pose's missing channel keys without discarding other local track edits. */
function restoreDeletedPoseTracks(
  restored: Layer,
  baseline: Omit<Layer, 'componentLink'>,
  resetPaths: readonly string[],
): void {
  const ids = new Set(
    Object.values(restored.animationTracks).flatMap((keys) => (keys ?? []).map((key) => key.id)),
  );
  for (const path of resetPaths) {
    const parts = path.split('/').slice(1).map(unescape);
    if (parts.length !== 2 || parts[0] !== 'keyframes' || !parts[1]?.startsWith('@')) continue;
    const frame = baseline.keyframes.find((key) => key.id === parts[1]!.slice(1))?.frame;
    if (frame === undefined) continue;
    for (const [property, baselineKeys] of Object.entries(baseline.animationTracks)) {
      const sourceKey = baselineKeys?.find((key) => key.frame === frame);
      if (!sourceKey) continue;
      const name = property as keyof LayerAnimationTracks;
      const track = restored.animationTracks[name] ?? [];
      if (track.some((key) => key.frame === frame)) continue;
      const key = cloneComponentValue(sourceKey);
      if (ids.has(key.id)) key.id = createId('property-key');
      ids.add(key.id);
      restored.animationTracks[name] = [...track, key].sort((a, b) => a.frame - b.frame);
    }
  }
}

/** Reset named JSON Pointer overrides, or all overrides on the selected materialized children. */
export function resetComponentInstanceOverrides(
  composition: Composition,
  layerIds: string[],
  paths?: string[],
): string[] {
  const wanted = new Set(layerIds);
  for (const layer of composition.layers) {
    if (!wanted.has(layer.id) || !layer.componentLink?.baseline) continue;
    const link = layer.componentLink;
    const baseline = link.baseline!;
    const matches = (path: string) =>
      !paths || paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    const all = [
      ...new Set([...(link.overridePaths ?? []), ...differences(snapshot(layer), link.baseline)]),
    ];
    const keep = all.filter((path) => !matches(path));
    const restored = mergeOverrides(
      { ...cloneComponentValue(baseline), componentLink: null },
      layer,
      keep,
    );
    if (layer.exportKey === undefined) delete restored.exportKey;
    else restored.exportKey = layer.exportKey;
    if (paths) restoreDeletedPoseTracks(restored, baseline, all.filter(matches));
    restored.componentLink = { ...cloneComponentValue(link), overridePaths: keep };
    assignJson(layer, restored);
    if (!paths) {
      const consumed = new Set([
        ...layer.bindings.map((binding) => binding.fieldId),
        ...(layer.visualRules ?? []).flatMap(visualRuleFieldIds),
      ]);
      for (const field of composition.dataFields)
        if (field.generatedShaderParameter?.layerId === layer.id) consumed.add(field.id);
      const resetFields: string[] = [];
      for (const [sourceId, baseline] of Object.entries(link.fieldBaselines ?? {})) {
        const field = composition.dataFields.find((item) => item.id === link.fieldIds?.[sourceId]);
        if (field && consumed.has(field.id)) {
          assignJson(field, cloneComponentValue(baseline));
          resetFields.push(sourceId);
        }
      }
      for (const sibling of composition.layers.filter(
        (item) => item.componentLink?.instanceId === link.instanceId,
      ))
        for (const id of resetFields) delete sibling.componentLink!.fieldOverridePaths?.[id];
    }
  }
  return reconcileComponentInstances(composition);
}

/** A private component asset captures the current resolved appearance without replacing instances. */
export function makeComponentInstanceUnique(
  composition: Composition,
  instanceId: string,
): ComponentDefinition {
  const layers = composition.layers.filter(
    (layer) => layer.componentLink?.instanceId === instanceId,
  );
  const link = layers[0]?.componentLink;
  if (!link) throw new Error('Component instance not found.');
  const previous = composition.components.find((item) => item.id === link.componentId);
  if (!previous) throw new Error('Component asset not found.');
  const definition = buildComponentDefinition(
    composition,
    layers.map((layer) => layer.id),
    `${previous.name} copy`,
    previous.id,
  );
  definition.id = createId('component');
  definition.scope = 'local';
  composition.components.push(definition);
  for (const layer of layers) {
    const next = layer.componentLink!;
    next.componentId = definition.id;
    delete next.baseline;
    delete next.fieldBaselines;
    next.overridePaths = [];
    next.fieldOverridePaths = {};
  }
  initializeComponentInheritance(composition);
  reconcileComponentInstances(composition);
  return definition;
}
