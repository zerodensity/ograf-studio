import { createId } from './id';
import { walkElementContents } from './ticker';
import { getLayerTransformAtFrame, getResolvedLayerAnimationTracks } from './layerAnimation';
import { isVisualRuleStateAction, remapVisualRule, visualRuleFieldIds } from './visualRules';
import {
  cloneComponentValue,
  materializeComponentInstance,
  reconcileComponentInstances,
  componentLifecycleIds,
  componentFrameMapper,
  adoptComponentSourceLayers,
  initializeComponentInheritance,
  type ComponentInstanceIdentity,
} from './componentInheritance';
import { computeKeyframeFrames } from './keyframeTiming';
import { layerMotionWindows } from './layerMotion';
import { retimeChartMarkAnimations } from './chartMarkAnimation';
import { refreshComponentDependencies } from './componentDependencies';
import { remapClockTimerActionId, remapClockTimerLayerActions } from './clockTimer';
import {
  layerModifierFieldIds,
  layerModifierGeometryReferences,
  remapLayerModifierReferences,
} from './modifiers';
import type {
  ComponentDefinition,
  ComponentSourceContext,
  Composition,
  FieldDefinition,
  Layer,
} from './types';

export interface ComponentInstantiation {
  instanceId: string;
  groupId: string;
  layers: Layer[];
  dataFields: FieldDefinition[];
  layerIds: Record<string, string>;
  fieldIds: Record<string, string>;
}

function canonicalField(
  source: FieldDefinition,
  ids: Map<string, string>,
  layerIds: Map<string, string>,
  existing?: ComponentDefinition,
): FieldDefinition {
  const field = cloneComponentValue(source);
  field.id = ids.get(source.id) ?? source.id;
  const old = existing?.dataFields.find((item) => item.id === field.id);
  if (old) field.key = old.key;
  field.properties = source.properties.map((child) => canonicalField(child, ids, layerIds));
  if (source.items) field.items = canonicalField(source.items, ids, layerIds);
  if (field.generatedShaderParameter)
    field.generatedShaderParameter.layerId =
      layerIds.get(field.generatedShaderParameter.layerId) ??
      field.generatedShaderParameter.layerId;
  return field;
}

/** Saves canonical child identities, including when promoting an edited linked instance. */
export function buildComponentDefinition(
  composition: Composition,
  layerIds: string[],
  name: string,
  id = createId('component'),
): ComponentDefinition {
  const wanted = new Set(layerIds);
  if (!wanted.size) throw new Error('A reusable component requires at least one layer.');
  if (wanted.size !== layerIds.length) throw new Error('Component layer IDs cannot repeat.');
  const selected = composition.layers.filter((layer) => wanted.has(layer.id));
  if (selected.length !== wanted.size)
    throw new Error('Component selection contains missing layers.');
  const existing = composition.components.find((item) => item.id === id);
  const linkedInstances = new Set(
    selected.flatMap((layer) =>
      layer.componentLink?.componentId === id ? [layer.componentLink.instanceId] : [],
    ),
  );
  if (linkedInstances.size > 1)
    throw new Error('Update a component asset from one instance at a time.');
  const canonicalLayers = new Map(
    selected.map((layer) => [
      layer.id,
      layer.componentLink?.componentId === id ? layer.componentLink.sourceLayerId : layer.id,
    ]),
  );
  if (new Set(canonicalLayers.values()).size !== selected.length)
    throw new Error('Component children need distinct canonical identities.');
  const canonicalFields = new Map<string, string>();
  const canonicalGroups = new Map<string, string>();
  for (const source of selected) {
    const canonical = canonicalLayers.get(source.id)!;
    const original = existing?.layers.find((layer) => layer.id === canonical);
    for (const rule of source.visualRules ?? [])
      if (
        rule.trigger === 'timer-alarm' &&
        rule.timerAlarm?.sourceLayerId &&
        !wanted.has(rule.timerAlarm.sourceLayerId)
      )
        throw new Error(
          `Include the timer alarm source when saving component layer "${source.name}".`,
        );
    if (source.groupId) canonicalGroups.set(source.groupId, original?.groupId ?? source.groupId);
    for (const reference of layerModifierGeometryReferences(source)) {
      if (reference.kind === 'layer') {
        if (!wanted.has(reference.layerId))
          throw new Error(
            `Include the modifier source/target when saving component layer "${source.name}".`,
          );
      } else {
        const members = composition.layers.filter((layer) => layer.groupId === reference.groupId);
        if (members.length !== selected.length || members.some((layer) => !wanted.has(layer.id)))
          throw new Error(
            'A component modifier group reference must cover exactly the complete component selection. Subgroup references cannot be widened to the whole component.',
          );
      }
    }
  }
  const canonicalCues = new Map<string, string>();
  for (const layer of selected)
    if (layer.componentLink?.componentId === id)
      for (const [sourceId, instanceId] of Object.entries(layer.componentLink.fieldIds ?? {}))
        canonicalFields.set(instanceId, sourceId);
  for (const layer of selected)
    if (layer.componentLink?.componentId === id)
      for (const [key, actual] of Object.entries(layer.componentLink.keyIds ?? {}))
        if (key.startsWith('__cue:')) canonicalCues.set(actual, key.slice(6));
  const reverseLifecycle = existing
    ? new Map(
        [...componentLifecycleIds(composition, existing)].map(([source, actual]) => [
          actual,
          source,
        ]),
      )
    : new Map<string, string>();
  // Updating an asset from a ported instance must return its resolved animation to the
  // asset's original clock. Keeping host frames would retime them a second time on reuse.
  const sourceClock = linkedInstances.size ? existing?.context : undefined;
  const sourceReference = selected.find((layer) => layer.componentLink?.componentId === id);
  const sourceOriginal = existing?.layers.find(
    (layer) => layer.id === sourceReference?.componentLink?.sourceLayerId,
  );
  const sourceOffset =
    sourceReference?.componentLink?.offset ??
    (sourceReference && sourceOriginal
      ? {
          x:
            getLayerTransformAtFrame(sourceReference, 0).x -
            getLayerTransformAtFrame(sourceOriginal, 0).x,
          y:
            getLayerTransformAtFrame(sourceReference, 0).y -
            getLayerTransformAtFrame(sourceOriginal, 0).y,
        }
      : { x: 0, y: 0 });
  const canonicalFrame =
    sourceClock && existing
      ? componentFrameMapper(composition, existing, 'source')
      : (frame: number) => frame;
  const canonicalRate = sourceClock ? sourceClock.frameRate / composition.frameRate : 1;
  const hostFrames = new Map(
    computeKeyframeFrames(composition).map((key) => [key.keyframeId, key.frame]),
  );
  const sourceBoundaries =
    sourceClock &&
    computeKeyframeFrames({
      ...composition,
      keyframes: sourceClock.keyframes,
      transitions: sourceClock.transitions,
    });
  const lifecycle = existing && componentLifecycleIds(composition, existing);
  const fieldIds = new Set(
    selected.flatMap((layer) => [
      ...layer.bindings.map((binding) => binding.fieldId),
      ...(layer.visualRules ?? []).flatMap(visualRuleFieldIds),
      ...layerModifierFieldIds(layer),
      ...(layer.loop?.timing ? [layer.loop.timing.holdFieldId] : []),
    ]),
  );
  const fields = composition.dataFields.filter((field) => fieldIds.has(field.id));
  if (fields.length !== fieldIds.size)
    throw new Error('Component selection contains a binding to an unknown data field.');
  const dataFields = fields.map((field) =>
    canonicalField(field, canonicalFields, canonicalLayers, existing),
  );
  const layers = selected.map((source) => {
    if (source.mask && !wanted.has(source.mask.sourceLayerId))
      throw new Error(`Include the mask source when saving component layer "${source.name}".`);
    if (source.motionPath && !wanted.has(source.motionPath.sourceLayerId))
      throw new Error(`Include the motion path when saving component layer "${source.name}".`);
    if (source.textPath && !wanted.has(source.textPath.sourceLayerId))
      throw new Error(`Include the text path when saving component layer "${source.name}".`);
    const layer = cloneComponentValue(source);
    const link = source.componentLink?.componentId === id ? source.componentLink : null;
    const keys = new Map(
      Object.entries(link?.keyIds ?? {}).map(([canonical, actual]) => [actual, canonical]),
    );
    const canonicalId = canonicalLayers.get(source.id)!;
    const oldSource = existing?.layers.find((item) => item.id === canonicalId);
    const offset =
      link?.offset ??
      (link && oldSource
        ? {
            x: getLayerTransformAtFrame(source, 0).x - getLayerTransformAtFrame(oldSource, 0).x,
            y: getLayerTransformAtFrame(source, 0).y - getLayerTransformAtFrame(oldSource, 0).y,
          }
        : sourceOffset);
    layer.id = canonicalId;
    if (layer.groupId) layer.groupId = canonicalGroups.get(layer.groupId) ?? layer.groupId;
    if (link && existing && layer.name.startsWith(`${existing.name} — `))
      layer.name = layer.name.slice(existing.name.length + 3);
    layer.componentLink = null;
    remapClockTimerLayerActions(layer, canonicalLayers);
    layer.parentId =
      source.parentId && wanted.has(source.parentId) ? canonicalLayers.get(source.parentId)! : null;
    if (layer.mask)
      layer.mask.sourceLayerId =
        canonicalLayers.get(layer.mask.sourceLayerId) ?? layer.mask.sourceLayerId;
    if (layer.motionPath)
      layer.motionPath.sourceLayerId =
        canonicalLayers.get(layer.motionPath.sourceLayerId) ?? layer.motionPath.sourceLayerId;
    if (layer.textPath)
      layer.textPath.sourceLayerId =
        canonicalLayers.get(layer.textPath.sourceLayerId) ?? layer.textPath.sourceLayerId;
    if (layer.modifiers)
      layer.modifiers = remapLayerModifierReferences(layer.modifiers, {
        layers: canonicalLayers,
        groups: canonicalGroups,
        fields: canonicalFields,
      })!;
    layer.animationTracks = cloneComponentValue(
      source.animationTrackMode === 'independent'
        ? source.animationTracks
        : getResolvedLayerAnimationTracks(source),
    );
    for (const key of layer.keyframes) {
      key.id = keys.get(key.id) ?? key.id;
      key.frame = canonicalFrame(key.frame);
      key.transform.x -= offset.x;
      key.transform.y -= offset.y;
    }
    for (const tracks of [layer.animationTracks, layer.loop?.tracks])
      for (const [property, entries] of Object.entries(tracks ?? {}))
        for (const key of entries ?? []) {
          key.id = keys.get(key.id) ?? key.id;
          key.frame =
            tracks === layer.animationTracks
              ? canonicalFrame(key.frame)
              : Math.round(key.frame * canonicalRate);
          if (property === 'x') key.value -= offset.x;
          if (property === 'y') key.value -= offset.y;
        }
    if (layer.loop) {
      layer.loop.id = keys.get(layer.loop.id) ?? layer.loop.id;
      layer.loop.durationFrames = Math.max(
        1,
        Math.round(layer.loop.durationFrames * canonicalRate),
      );
      layer.loop.phaseOffsetFrames = Math.round(layer.loop.phaseOffsetFrames * canonicalRate);
      if (layer.loop.timing) {
        if (source.groupId && layer.loop.timing.groupId.startsWith(`${source.groupId}:`))
          layer.loop.timing.groupId = layer.loop.timing.groupId.slice(source.groupId.length + 1);
        layer.loop.timing.holdFieldId =
          canonicalFields.get(layer.loop.timing.holdFieldId) ?? layer.loop.timing.holdFieldId;
        for (const range of layer.loop.timing.holdRanges) {
          range.startFrame = Math.round(range.startFrame * canonicalRate);
          range.endFrame = Math.round(range.endFrame * canonicalRate);
        }
      }
    }
    if (sourceClock && layer.loop?.activation.type === 'step')
      layer.loop.activation.stepKeyframeId =
        reverseLifecycle.get(layer.loop.activation.stepKeyframeId) ??
        layer.loop.activation.stepKeyframeId;
    if (sourceClock) {
      if (layer.element.type === 'chart')
        retimeChartMarkAnimations(layer.element, layerMotionWindows(composition), canonicalFrame);
      for (const side of ['in', 'out'] as const) {
        const sourceBoundary =
          side === 'in'
            ? sourceBoundaries?.find((key) =>
                sourceClock.keyframes.some(
                  (state) => state.id === key.keyframeId && state.role === 'step',
                ),
              )
            : sourceBoundaries?.at(-1);
        const hostBoundary =
          sourceBoundary && hostFrames.get(lifecycle?.get(sourceBoundary.keyframeId) ?? '');
        if (hostBoundary !== undefined) {
          for (const spec of [layer.motion?.[side], layer.animationPresets?.[side]]) {
            if (!spec) continue;
            const end = hostBoundary - (spec.offsetFrames ?? 0);
            spec.durationFrames = Math.max(
              1,
              canonicalFrame(end) - canonicalFrame(end - spec.durationFrames),
            );
            if (spec.offsetFrames !== undefined)
              spec.offsetFrames = Math.max(0, canonicalFrame(hostBoundary) - canonicalFrame(end));
          }
        }
      }
      layer.updateTransition.durationFrames = Math.max(
        0,
        Math.round(layer.updateTransition.durationFrames * canonicalRate),
      );
      if (layer.element.type === 'text') {
        layer.element.textAnimation.durationFrames = Math.max(
          1,
          Math.round(layer.element.textAnimation.durationFrames * canonicalRate),
        );
        layer.element.textAnimation.cursorBlinkFrames = Math.max(
          1,
          Math.round(layer.element.textAnimation.cursorBlinkFrames * canonicalRate),
        );
      }
      if (layer.element.type === 'chart' && layer.element.animation) {
        layer.element.animation.durationFrames = Math.max(
          1,
          Math.round(layer.element.animation.durationFrames * canonicalRate),
        );
        layer.element.animation.delayFrames = Math.round(
          layer.element.animation.delayFrames * canonicalRate,
        );
        layer.element.animation.staggerFrames = Math.round(
          layer.element.animation.staggerFrames * canonicalRate,
        );
      }
    }
    layer.bindings = layer.bindings.map((binding) => ({
      ...binding,
      fieldId: canonicalFields.get(binding.fieldId) ?? binding.fieldId,
    }));
    layer.visualRules = (layer.visualRules ?? []).flatMap((rule) => {
      if (sourceClock && rule.trigger === 'step' && rule.eventId)
        rule.eventId = reverseLifecycle.get(rule.eventId) ?? rule.eventId;
      if (sourceClock && rule.delayFrames !== undefined)
        rule.delayFrames = Math.round(rule.delayFrames * canonicalRate);
      for (const action of rule.actions) {
        if (action.type === 'play-sound' || action.type === 'take-media')
          action.cueId = canonicalCues.get(action.cueId) ?? action.cueId;
        if (sourceClock && 'transitionFrames' in action && action.transitionFrames !== undefined)
          action.transitionFrames = Math.round(action.transitionFrames * canonicalRate);
      }
      const actions = rule.actions.filter(
        (action) =>
          !isVisualRuleStateAction(action) ||
          !action.targetLayerId ||
          wanted.has(action.targetLayerId),
      );
      return actions.length || (rule.trigger === 'timer-alarm' && rule.actions.length === 0)
        ? [
            remapVisualRule(
              { ...rule, actions },
              {
                id: keys.get(rule.id) ?? rule.id,
                layerIds: canonicalLayers,
                fieldIds: canonicalFields,
                groupIds: canonicalGroups,
              },
            ),
          ]
        : [];
    });
    return layer;
  });
  const assetIds = new Set<string>();
  const cueIds = new Set(
    layers.flatMap((layer) =>
      (layer.visualRules ?? []).flatMap((rule) =>
        rule.actions.flatMap((action) =>
          action.type === 'play-sound' || action.type === 'take-media' ? [action.cueId] : [],
        ),
      ),
    ),
  );
  const context: ComponentSourceContext =
    linkedInstances.size && existing?.context
      ? cloneComponentValue(existing.context)
      : {
          frameRate: composition.frameRate,
          keyframes: cloneComponentValue(composition.keyframes),
          transitions: cloneComponentValue(composition.transitions),
          customActions: cloneComponentValue(composition.customActions),
          rendererPlugins: cloneComponentValue(composition.rendererPlugins ?? []),
          animationPresetPlugins: cloneComponentValue(composition.animationPresetPlugins ?? []),
          designSystem: cloneComponentValue(composition.designSystem),
        };
  if (!linkedInstances.size || !existing?.context) {
    context.mediaCues = (composition.mediaCues ?? [])
      .filter(
        (cue) =>
          cueIds.has(cue.id) ||
          Boolean(cue.visual.targetLayerId && wanted.has(cue.visual.targetLayerId)),
      )
      .map((source) => {
        const cue = cloneComponentValue(source);
        if (cue.trigger.type === 'customAction')
          cue.trigger.actionId = remapClockTimerActionId(cue.trigger.actionId, canonicalLayers);
        if (cue.visual.targetLayerId) {
          const target = canonicalLayers.get(cue.visual.targetLayerId);
          if (!target)
            throw new Error('Include the media target when saving a component that controls it.');
          cue.visual.targetLayerId = target;
        }
        return cue;
      });
  }
  const rendererRefs = layers.flatMap((layer) =>
    layer.element.type === 'chart' && layer.element.provider ? [layer.element.provider] : [],
  );
  const presetRefs = layers.flatMap((layer) =>
    [
      ...Object.values(layer.animationPresets ?? {}),
      ...Object.values(layer.element.type === 'chart' ? (layer.element.markAnimations ?? {}) : {}),
    ].flatMap((preset) => (preset ? [preset.reference] : [])),
  );
  const matchesReference = (
    snapshot: { sha256: string; manifest: { id: string; version: string } },
    reference: { id: string; version: string; sha256: string },
  ) =>
    snapshot.sha256 === reference.sha256 &&
    snapshot.manifest.id === reference.id &&
    snapshot.manifest.version === reference.version;
  context.rendererPlugins = cloneComponentValue(
    [...(composition.rendererPlugins ?? []), ...(context.rendererPlugins ?? [])].filter(
      (plugin, index, all) =>
        rendererRefs.some((reference) => matchesReference(plugin, reference)) &&
        all.findIndex(
          (other) =>
            other.sha256 === plugin.sha256 &&
            other.manifest.id === plugin.manifest.id &&
            other.manifest.version === plugin.manifest.version,
        ) === index,
    ),
  );
  context.animationPresetPlugins = cloneComponentValue(
    [
      ...(composition.animationPresetPlugins ?? []),
      ...(context.animationPresetPlugins ?? []),
    ].filter(
      (plugin, index, all) =>
        presetRefs.some((reference) => matchesReference(plugin, reference)) &&
        all.findIndex(
          (other) =>
            other.sha256 === plugin.sha256 &&
            other.manifest.id === plugin.manifest.id &&
            other.manifest.version === plugin.manifest.version,
        ) === index,
    ),
  );
  const actionIds = new Set(
    layers.flatMap((layer) => [
      ...(layer.loop?.activation.type === 'customAction'
        ? [layer.loop.activation.customActionId]
        : []),
      ...(layer.element.type === 'text' && layer.element.textAnimation.customActionId
        ? [layer.element.textAnimation.customActionId]
        : []),
      ...(layer.visualRules ?? []).flatMap((rule) => [
        ...(rule.trigger === 'custom-action' && rule.eventId ? [rule.eventId] : []),
        ...rule.actions.flatMap((action) =>
          action.type === 'custom-action' || action.type === 'shader-animation'
            ? [action.actionId]
            : [],
        ),
      ]),
    ]),
  );
  for (const cue of context.mediaCues ?? [])
    if (cue.trigger.type === 'customAction') actionIds.add(cue.trigger.actionId);
  context.customActions = context.customActions.filter((action) => actionIds.has(action.actionId));
  const collect = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith('asset:')) assetIds.add(value.slice(6));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(layers);
  collect(dataFields);
  collect(context.mediaCues ?? []);
  const fonts = new Set(
    layers.flatMap((layer) =>
      walkElementContents(layer.element).flatMap((element) =>
        element.type === 'text'
          ? element.fontFamily.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
          : [],
      ),
    ),
  );
  const resources = (composition.assets ?? [])
    .filter(
      (asset) =>
        assetIds.has(asset.id) ||
        (asset.kind === 'font' && Boolean(asset.fontFamily && fonts.has(asset.fontFamily))),
    )
    .map(cloneComponentValue);
  const patternIds = new Set(
    layers.flatMap((layer) => [
      ...walkElementContents(layer.element).flatMap((element) =>
        element.type === 'pattern' ? [element.patternId] : [],
      ),
      ...(layer.lighting ? [layer.lighting.patternId] : []),
    ]),
  );
  const patterns = composition.patterns
    .filter((pattern) => patternIds.has(pattern.id))
    .map(cloneComponentValue);
  const definition: ComponentDefinition = {
    id,
    name: name.trim() || `Component ${composition.components.length + 1}`,
    layers,
    dataFields,
    context,
    ...(existing?.scope ? { scope: existing.scope } : {}),
    ...(resources.length ? { resources } : {}),
    ...(patterns.length ? { patterns } : {}),
  };
  refreshComponentDependencies(composition, definition);
  return definition;
}

/**
 * Promote one edited instance and any newly added layers without making copies of those layers.
 * An entirely independent selection becomes the asset's new source instance. Work is staged so
 * validation failures leave the document unchanged, including when called outside an Immer draft.
 */
export function updateComponentDefinitionFromLayers(
  composition: Composition,
  componentId: string,
  layerIds: string[],
): { definition: ComponentDefinition; sourceInstanceId: string; adoptedLayerIds: string[] } {
  const index = composition.components.findIndex((component) => component.id === componentId);
  const existing = composition.components[index];
  if (!existing) throw new Error(`Component not found: ${componentId}`);
  const selectedIds = new Set(layerIds);
  const selected = composition.layers.filter((layer) => selectedIds.has(layer.id));
  if (
    !selected.length ||
    selected.length !== selectedIds.size ||
    selectedIds.size !== layerIds.length
  )
    throw new Error('Component update requires a nonempty selection of distinct existing layers.');
  for (const layer of selected) {
    if (layer.isLocked) throw new Error(`Layer is locked: ${layer.name}`);
    if (layer.componentLink && layer.componentLink.componentId !== componentId)
      throw new Error(
        'Update a component from its own instance or independent layers. Layers from another component cannot be adopted.',
      );
  }
  const instances = new Set(
    selected.flatMap((layer) => (layer.componentLink ? [layer.componentLink.instanceId] : [])),
  );
  if (instances.size > 1) throw new Error('Update a component asset from one instance at a time.');
  const staged = cloneComponentValue(composition);
  initializeComponentInheritance(staged);
  const sourceGroup =
    staged.layers.find((layer) => selectedIds.has(layer.id) && layer.componentLink)?.groupId ??
    selected.find((layer) => layer.groupId)?.groupId ??
    createId('group');
  for (const layer of staged.layers) if (selectedIds.has(layer.id)) layer.groupId ??= sourceGroup;
  const definition = buildComponentDefinition(staged, layerIds, existing.name, existing.id);
  definition.scope = existing.scope ?? 'local';
  staged.components[index] = definition;
  const adoptedLayerIds = selected.filter((layer) => !layer.componentLink).map((layer) => layer.id);
  const sourceInstanceId = adoptComponentSourceLayers(staged, definition, layerIds);
  Object.assign(composition, staged);
  return { definition, sourceInstanceId, adoptedLayerIds };
}

/** New insertions are live; explicit false retains independent legacy/repeater copy behavior. */
export function instantiateComponentDefinition(
  composition: Composition,
  definition: ComponentDefinition,
  offset: { x: number; y: number } = { x: 40, y: 40 },
  linked = true,
  identity?: ComponentInstanceIdentity,
): ComponentInstantiation {
  return materializeComponentInstance(composition, definition, offset, linked, identity);
}

export interface RefreshedComponentInstance {
  instanceId: string;
  removedLayerIds: string[];
  removedFieldIds: string[];
  instance: ComponentInstantiation;
}

/** Compatibility action: live reconciliation refreshes defaults without replacing scene identities. */
export function refreshComponentInstances(
  composition: Composition,
  definition: ComponentDefinition,
  requestedInstanceIds?: string[],
): RefreshedComponentInstance[] {
  const available = new Set(
    composition.layers.flatMap((layer) =>
      layer.componentLink?.componentId === definition.id ? [layer.componentLink.instanceId] : [],
    ),
  );
  const instances = requestedInstanceIds ?? [...available];
  if (instances.some((id) => !available.has(id)))
    throw new Error('Linked component instance not found.');
  const before = new Map(
    instances.map((id) => [
      id,
      composition.layers
        .filter((layer) => layer.componentLink?.instanceId === id)
        .map((layer) => layer.id),
    ]),
  );
  reconcileComponentInstances(composition);
  return instances.map((instanceId) => {
    const layers = composition.layers.filter(
      (layer) => layer.componentLink?.instanceId === instanceId,
    );
    const link = layers[0]?.componentLink;
    const fields = cloneComponentValue(link?.fieldIds ?? {});
    return {
      instanceId,
      removedLayerIds: (before.get(instanceId) ?? []).filter(
        (id) => !composition.layers.some((layer) => layer.id === id),
      ),
      removedFieldIds: [],
      instance: {
        instanceId,
        groupId: layers[0]?.groupId ?? link?.baseline?.groupId ?? instanceId,
        layers,
        dataFields: composition.dataFields.filter((field) =>
          Object.values(fields).includes(field.id),
        ),
        layerIds: Object.fromEntries(
          layers.map((layer) => [layer.componentLink!.sourceLayerId, layer.id]),
        ),
        fieldIds: fields,
      },
    };
  });
}
