import { hasTextAnimationSettings, textAnimationTotalFrames } from '@ograf-editor/scene-model';
import { migrateShaderElement, migrateShaderBindingTarget } from '@ograf-editor/scene-model';
import {
  compileCustomActions,
  compileDataExposure,
  fieldValueForExport,
} from './compileDataSchema';
import {
  coerceVisualRuleSetDataValue,
  isVisualRuleMouseFieldId,
  isVisualRuleStateAction,
  computeKeyframeFrames,
  assessStaticExitHold,
  compositionWithShaderParameterFields,
  compositionLayersWithBackground,
  getResolvedLayerAnimationTracks,
  bakeChartMarkAnimations,
  layerMotionWindows,
  layerModifierGeometryReferences,
  isContainerModifier,
  layerModifierFieldIds,
  normalizeLayerAutoLayout,
  normalizeTextAnimation,
  textPathCompatibilityErrors,
  textPathReferenceErrors,
  rendererPluginKey,
  validateRendererPluginSnapshot,
  resolveElementAssetReferences,
  resolveAssetValue,
  resolvePatternElement,
  type Composition,
  type VisualRuleAction,
  type VisualRuleCondition,
} from '@ograf-editor/scene-model';
import type {
  CompiledGraphicDescriptor,
  CompiledKeyframe,
  CompiledLayer,
  CompiledPaintOrderEntry,
  CompiledRuntimeCollection,
  CompiledVisualRuleCondition,
} from '@ograf-editor/ograf-types';

export type {
  CompiledGraphicDescriptor,
  CompiledKeyframe,
  CompiledLayer,
} from '@ograf-editor/ograf-types';

/**
 * Project/Composition -> CompiledGraphicDescriptor. Resolves each layer binding's `fieldId` to the
 * field's `key` (the name the runtime `data` payload actually uses), and drops guide layers
 * (design-time-only, excluded from anything that ships).
 */
export function compileDescriptor(
  composition: Composition,
  options: { includeGuides?: boolean } = {},
): CompiledGraphicDescriptor {
  const exitHold =
    composition.shortOutFrames === undefined
      ? undefined
      : assessStaticExitHold(composition, composition.shortOutFrames);
  composition = compositionWithShaderParameterFields(composition);
  composition = { ...composition, layers: compositionLayersWithBackground(composition) };
  const keyframeFrames = computeKeyframeFrames(composition);
  const frameByKeyframeId = new Map(keyframeFrames.map((k) => [k.keyframeId, k.frame]));
  const fieldKeyById = new Map(composition.dataFields.map((f) => [f.id, f.key]));
  const dataExposure = compileDataExposure(composition.dataFields);
  const modifierGroups = new Set(
    composition.layers.flatMap((layer) =>
      layerModifierGeometryReferences(layer).flatMap((reference) =>
        reference.kind === 'group' ? [reference.groupId] : [],
      ),
    ),
  );
  const modifierFields = new Set(composition.layers.flatMap(layerModifierFieldIds));
  // Arrange/Justify move whole child subtrees, so their hierarchy survives compilation.
  const modifierHierarchy = composition.layers.some((layer) =>
    layer.modifiers?.some(isContainerModifier),
  );

  const keyframes: CompiledKeyframe[] = composition.keyframes.map((keyframe) => ({
    id: keyframe.id,
    frame: frameByKeyframeId.get(keyframe.id) ?? 0,
    role: keyframe.role,
  }));

  const startKeyframeId = keyframes.find((keyframe) => keyframe.role === 'start')?.id;
  const endKeyframeId = keyframes.find((keyframe) => keyframe.role === 'end')?.id;
  if (!startKeyframeId || !endKeyframeId) {
    throw new Error('Composition must contain exactly one explicit start and end keyframe.');
  }
  const stepKeyframeIds = keyframes
    .filter((keyframe) => keyframe.role === 'step')
    .map((keyframe) => keyframe.id);

  const compiledLayerIds = new Set(
    composition.layers
      .filter((layer) => options.includeGuides || !layer.isGuide)
      .map((layer) => layer.id),
  );
  const compileRuleCondition = (
    condition: VisualRuleCondition,
  ): CompiledVisualRuleCondition | null => {
    const dataKey = isVisualRuleMouseFieldId(condition.fieldId)
      ? condition.fieldId
      : fieldKeyById.get(condition.fieldId);
    if (dataKey === undefined) return null;
    const compareDataKey = condition.compareFieldId
      ? isVisualRuleMouseFieldId(condition.compareFieldId)
        ? condition.compareFieldId
        : fieldKeyById.get(condition.compareFieldId)
      : undefined;
    return {
      dataKey,
      sourcePath: [...condition.sourcePath],
      operator: condition.operator,
      ...(condition.value !== undefined ? { value: structuredClone(condition.value) } : {}),
      ...(compareDataKey !== undefined
        ? { compareDataKey, compareSourcePath: [...(condition.compareSourcePath ?? [])] }
        : {}),
      ...(condition.ignoreCase ? { ignoreCase: true } : {}),
    };
  };

  const compileLayer = (layer: Composition['layers'][number]): CompiledLayer => {
    if (layer.textPath) {
      const errors = textPathReferenceErrors(layer, layer.textPath, composition.layers);
      if (layer.element.type === 'text') errors.push(...textPathCompatibilityErrors(layer.element));
      if (errors.length) throw new Error(`Text on a path "${layer.name}": ${errors.join(' ')}`);
    }
    const autoLayout = normalizeLayerAutoLayout(layer.autoLayout);
    const animationTracks = getResolvedLayerAnimationTracks(layer);
    const clipParent = layer.parentId
      ? composition.layers.find(
          (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
        )
      : undefined;
    const layoutParent = layer.parentId
      ? composition.layers.find(
          (candidate) =>
            candidate.id === layer.parentId &&
            normalizeLayerAutoLayout(candidate.autoLayout).direction !== 'none',
        )
      : undefined;
    const mediaCue = composition.mediaCues.find(
      (candidate) => candidate.visual.targetLayerId === layer.id,
    );
    const activeMediaSource = mediaCue?.sources.find(
      (source) => source.id === mediaCue.activeSourceId,
    );
    const mediaTriggerFrame =
      mediaCue?.trigger.type === 'timeline'
        ? mediaCue.trigger.startFrame
        : mediaCue?.trigger.type === 'lifecycle'
          ? (frameByKeyframeId.get(mediaCue.trigger.keyframeId) ?? 0)
          : 0;
    const element =
      mediaCue &&
      activeMediaSource &&
      !(activeMediaSource.kind === 'clip' && activeMediaSource.mediaType === 'audio') &&
      'fill' in layer.element
        ? {
            ...layer.element,
            fill: {
              type: 'media' as const,
              source:
                activeMediaSource.kind === 'clip'
                  ? { kind: 'clip' as const, src: activeMediaSource.src }
                  : {
                      kind: 'live' as const,
                      tag: activeMediaSource.tag,
                      ...(activeMediaSource.fallback
                        ? { fallback: activeMediaSource.fallback }
                        : {}),
                    },
              fit: mediaCue.visual.fit,
              ...(mediaCue.visual.crop ? { crop: mediaCue.visual.crop } : {}),
              positionX: mediaCue.visual.positionX,
              positionY: mediaCue.visual.positionY,
              loop: mediaCue.loop,
              speed: mediaCue.speed,
              offsetMs: mediaCue.trimStartMs,
              trimEndMs: mediaCue.trimEndMs,
              timelineStartMs: (mediaTriggerFrame / composition.frameRate) * 1000,
              muted: true as const,
            },
          }
        : layer.element;
    const chartMarkAnimations =
      element.type === 'chart'
        ? bakeChartMarkAnimations(
            element,
            composition.animationPresetPlugins ?? [],
            layerMotionWindows(composition),
          )
        : undefined;
    return {
      id: layer.id,
      ...(layer.exportKey ? { exportKey: layer.exportKey } : {}),
      ...(element.type === 'ticker' ? { name: layer.name } : {}),
      ...(chartMarkAnimations ? { chartMarkAnimations } : {}),
      ...(layer.groupId && modifierGroups.has(layer.groupId) ? { groupId: layer.groupId } : {}),
      ...(layer.modifiers?.length ? { modifiers: structuredClone(layer.modifiers) } : {}),
      isVisible: layer.isVisible,
      blendMode: layer.blendMode,
      element: resolvePatternElement(
        resolveElementAssetReferences(migrateShaderElement(element), composition.assets),
        composition.patterns,
      ),
      effects: layer.effects,
      ...(layer.lighting
        ? {
            lighting: {
              ...layer.lighting,
              definition: structuredClone(
                composition.patterns.find((p) => p.id === layer.lighting!.patternId)!,
              ),
            },
          }
        : {}),
      keyframes: layer.keyframes.map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        transform: keyframe.transform,
        easing: keyframe.easing,
      })),
      animationTracks: Object.fromEntries(
        Object.entries(animationTracks).map(([property, keyframes]) => [
          property,
          keyframes?.map((keyframe) => ({ ...keyframe })) ?? [],
        ]),
      ),
      loop: layer.loop
        ? {
            ...layer.loop,
            ...(layer.loop.timing
              ? {
                  holdDataKey: fieldKeyById.get(layer.loop.timing.holdFieldId)!,
                  frameRate: composition.frameRate,
                }
              : {}),
            activation: { ...layer.loop.activation },
            tracks: Object.fromEntries(
              Object.entries(layer.loop.tracks).map(([property, keys]) => [
                property,
                keys?.map((key) => ({
                  ...key,
                  ...(key.curve ? { curve: { ...key.curve } } : {}),
                })) ?? [],
              ]),
            ),
          }
        : null,
      bindings: layer.bindings.flatMap((binding) => {
        const dataKey = fieldKeyById.get(binding.fieldId);
        return dataKey === undefined
          ? []
          : [
              {
                dataKey,
                targetProperty: migrateShaderBindingTarget(binding.targetProperty),
                ...(binding.sourcePath?.length ? { sourcePath: [...binding.sourcePath] } : {}),
                ...(binding.valueMap ? { valueMap: structuredClone(binding.valueMap) } : {}),
              },
            ];
      }),
      visualRules: (layer.visualRules ?? []).flatMap((rule) => {
        const scopeLayerIds = rule.hostGroupId
          ? composition.layers
              .filter(
                (member) => member.groupId === rule.hostGroupId && compiledLayerIds.has(member.id),
              )
              .map((member) => member.id)
          : undefined;
        const isData = !rule.trigger || rule.trigger === 'data';
        const primary = compileRuleCondition(rule);
        if (isData && !primary) return [];
        const conditions = (rule.conditions ?? []).flatMap((condition) => {
          const compiled = compileRuleCondition(condition);
          return compiled ? [compiled] : [];
        });
        const actions = structuredClone(rule.actions).flatMap((action): VisualRuleAction[] => {
          if (
            scopeLayerIds &&
            isVisualRuleStateAction(action) &&
            !action.targetLayerId &&
            !action.targetGroupId
          )
            return scopeLayerIds.map((targetLayerId) => ({ ...action, targetLayerId }));
          if ('targetGroupId' in action && action.targetGroupId) {
            // The runtime knows layers, not editor groups: one action per exported member.
            const { targetGroupId, ...single } = action;
            return composition.layers
              .filter((layer) => layer.groupId === targetGroupId && compiledLayerIds.has(layer.id))
              .map((layer) => ({ ...single, targetLayerId: layer.id }));
          }
          if ('targetLayerId' in action && action.targetLayerId)
            return compiledLayerIds.has(action.targetLayerId) ? [action] : [];
          if (action.type !== 'set-data') return [action];
          // The runtime addresses data by key; a `set` value is stored as the field's type.
          const field = composition.dataFields.find((entry) => entry.id === action.fieldId);
          if (!field) return [];
          const compiled: VisualRuleAction = { ...action, dataKey: field.key };
          if (action.mode === 'set')
            compiled.value = coerceVisualRuleSetDataValue(field.type, action.value);
          return [compiled];
        });
        if (actions.length === 0) return [];
        return [
          {
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled,
            ...(scopeLayerIds ? { scopeLayerIds } : {}),
            ...(rule.trigger ? { trigger: rule.trigger } : {}),
            ...(rule.timerAlarm ? { timerAlarm: structuredClone(rule.timerAlarm) } : {}),
            ...(rule.keyboard ? { keyboard: structuredClone(rule.keyboard) } : {}),
            ...(primary && isData
              ? primary
              : { dataKey: '', sourcePath: [], operator: rule.operator }),
            ...(conditions.length ? { conditions } : {}),
            ...(rule.match ? { match: rule.match } : {}),
            ...(rule.eventId ? { eventId: rule.eventId } : {}),
            ...(rule.delayFrames ? { delayFrames: rule.delayFrames } : {}),
            actions,
          },
        ];
      }),
      clipParentId: clipParent?.id ?? null,
      ...(layer.crop ? { crop: structuredClone(layer.crop) } : {}),
      layoutParentId: layoutParent?.id ?? null,
      ...(modifierHierarchy && layer.parentId ? { modifierParentId: layer.parentId } : {}),
      autoLayout,
      updateTransition: structuredClone(
        layer.updateTransition ?? { style: 'inherit', durationFrames: 0, distance: 24 },
      ),
      motionPath:
        layer.motionPath &&
        composition.layers.some((candidate) => candidate.id === layer.motionPath!.sourceLayerId)
          ? structuredClone(layer.motionPath)
          : null,
      textPath: layer.textPath ? structuredClone(layer.textPath) : null,
      ...(layer.motionBlur?.enabled ? { motionBlur: structuredClone(layer.motionBlur) } : {}),
      isMaskOnly: layer.isMaskOnly,
      mask: layer.mask ? { ...layer.mask } : null,
    };
  };

  const prototypeOwnerByLayerId = new Map<string, string>();
  for (const collection of composition.runtimeCollections) {
    for (const layerId of collection.prototypeLayerIds) {
      prototypeOwnerByLayerId.set(layerId, collection.id);
    }
  }

  const layers: CompiledLayer[] = composition.layers
    .filter(
      (layer) =>
        (options.includeGuides || !layer.isGuide) && !prototypeOwnerByLayerId.has(layer.id),
    )
    .map(compileLayer);

  const collections: CompiledRuntimeCollection[] = composition.runtimeCollections.map(
    (collection) => {
      const dataKey = fieldKeyById.get(collection.fieldId);
      if (!dataKey) throw new Error(`Runtime collection field is missing: ${collection.fieldId}`);
      const prototypeLayers = collection.prototypeLayerIds.map((layerId) => {
        const layer = composition.layers.find((candidate) => candidate.id === layerId);
        if (!layer) throw new Error(`Runtime collection prototype layer is missing: ${layerId}`);
        return compileLayer(layer);
      });
      return {
        id: collection.id,
        name: collection.name,
        dataKey,
        prototypeGroupId:
          composition.layers.find((layer) => layer.id === collection.prototypeLayerIds[0])
            ?.groupId ?? null,
        prototypeLayers,
        offsetPerItem: { ...collection.offsetPerItem },
        capacity: collection.capacity,
        overflow: collection.overflow,
        itemKeyPath: [...(collection.itemKeyPath ?? [])],
        sortPath: [...(collection.sortPath ?? [])],
        sortDirection: collection.sortDirection ?? 'none',
        pageSize: collection.pageSize ?? 0,
        page: collection.page ?? 0,
      };
    },
  );

  const paintOrder: CompiledPaintOrderEntry[] = [];
  const emittedCollections = new Set<string>();
  for (const layer of composition.layers) {
    if (!options.includeGuides && layer.isGuide) continue;
    const collectionId = prototypeOwnerByLayerId.get(layer.id);
    if (collectionId) {
      if (!emittedCollections.has(collectionId)) {
        paintOrder.push({ type: 'collection', id: collectionId });
        emittedCollections.add(collectionId);
      }
    } else {
      paintOrder.push({ type: 'layer', id: layer.id });
    }
  }

  return {
    width: composition.width,
    height: composition.height,
    ...(composition.crop ? { crop: { ...composition.crop } } : {}),
    backgroundColor:
      composition.backgroundPaint === undefined ? composition.backgroundColor : 'transparent',
    frameRate: composition.frameRate,
    ...(composition.functions?.length
      ? {
          functions: composition.functions.map((definition) => ({
            ...structuredClone(definition),
            inputs: Object.fromEntries(
              Object.entries(definition.inputs).map(([alias, fieldId]) => [
                alias,
                fieldKeyById.get(fieldId) ?? '',
              ]),
            ),
            outputs: Object.fromEntries(
              Object.entries(definition.outputs).map(([alias, fieldId]) => [
                alias,
                fieldKeyById.get(fieldId) ?? '',
              ]),
            ),
          })),
        }
      : {}),
    updateTransitionFrames: composition.updateTransitionFrames,
    ...(exitHold && !exitHold.reason ? { exitTailStartFrame: exitHold.startFrame } : {}),
    updateInterruption: composition.updateInterruption ?? 'queue',
    ...(dataExposure
      ? {
          dataExposure,
          sourceDataFields: structuredClone(composition.dataFields),
          dataDefaults: Object.fromEntries(
            composition.dataFields.map((field) => [
              field.key,
              fieldValueForExport(field, field.defaultValue),
            ]),
          ),
        }
      : {}),
    rendererPlugins: (Array.isArray(composition.rendererPlugins) ? composition.rendererPlugins : [])
      .filter((snapshot) => {
        if (validateRendererPluginSnapshot(snapshot).length) return false;
        const key = rendererPluginKey({ ...snapshot.manifest, sha256: snapshot.sha256 });
        return [...layers, ...collections.flatMap((collection) => collection.prototypeLayers)].some(
          (layer) =>
            layer.element.type === 'chart' &&
            layer.element.provider &&
            rendererPluginKey(layer.element.provider) === key,
        );
      })
      .map((snapshot) => structuredClone(snapshot)),
    fonts: composition.assets
      .filter((asset) => asset.kind === 'font')
      .map((asset) => ({
        family: asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
        source: `asset:${asset.id}`,
        mimeType: asset.mimeType,
        weight: asset.fontWeight || '100 900',
        style: asset.fontStyle || 'normal',
      })),
    mediaCues: composition.mediaCues.map((cue) => ({
      ...structuredClone(cue),
      sources: cue.sources.map((source) =>
        source.kind === 'clip'
          ? { ...source, src: resolveAssetValue(source.src, composition.assets) }
          : {
              ...source,
              ...(source.fallback
                ? { fallback: resolveAssetValue(source.fallback, composition.assets) }
                : {}),
            },
      ),
    })),
    ...(modifierFields.size
      ? {
          modifierDataKeys: Object.fromEntries(
            [...fieldKeyById].filter(([id]) => modifierFields.has(id)),
          ),
          modifierDataDefaults: Object.fromEntries(
            composition.dataFields
              .filter((field) => modifierFields.has(field.id))
              .map((field) => [field.id, structuredClone(field.defaultValue)]),
          ),
        }
      : {}),
    layers,
    collections,
    paintOrder,
    keyframes,
    transitions: composition.transitions.map((t) => ({
      fromKeyframeId: t.fromKeyframeId,
      toKeyframeId: t.toKeyframeId,
      durationFrames: t.durationFrames,
      easing: t.easing,
    })),
    stepKeyframeIds,
    stepCount: stepKeyframeIds.length,
    startKeyframeId,
    endKeyframeId,
    customActions: compileCustomActions(composition).map((action) => ({
      id: action.id,
      name: action.name,
      durationFrames: Math.max(
        composition.layers.reduce((longest, layer) => {
          if (layer.element.type === 'text') {
            const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
            if (
              hasTextAnimationSettings(textAnimation) &&
              textAnimation.customActionId === action.id
            ) {
              longest = Math.max(longest, textAnimationTotalFrames(textAnimation));
            }
          }
          const loop = layer.loop;
          if (
            loop?.activation.type !== 'customAction' ||
            loop.activation.customActionId !== action.id
          ) {
            return longest;
          }
          return Math.max(longest, loop.durationFrames * (loop.repeatCount ?? 1));
        }, 0),
        ...composition.mediaCues
          .filter(
            (cue) => cue.trigger.type === 'customAction' && cue.trigger.actionId === action.id,
          )
          .map((cue) => cue.transition.durationFrames),
        ...composition.mediaCues
          .filter(
            (cue) => cue.trigger.type === 'customAction' && cue.trigger.actionId === action.id,
          )
          .map((cue) => cue.durationFrames ?? 0),
      ),
    })),
  };
}
