import {
  cloneComponentValue,
  componentFrameMapper,
  componentLifecycleIds,
} from './componentInheritance';
import type { ComponentDefinition, Composition } from './types';
import { walkElementContents } from './ticker';

/** Keep a source's portable resource closure current when its content or parameters change. */
export function refreshComponentDependencies(
  composition: Composition,
  definition: ComponentDefinition,
): void {
  const context = (definition.context ??= {
    frameRate: composition.frameRate,
    keyframes: cloneComponentValue(composition.keyframes),
    transitions: cloneComponentValue(composition.transitions),
    customActions: [],
    designSystem: cloneComponentValue(composition.designSystem),
  });
  const childIds = new Set(definition.layers.map((layer) => layer.id));
  const cueIds = new Set(
    definition.layers.flatMap((layer) =>
      layer.visualRules.flatMap((rule) =>
        rule.actions.flatMap((action) =>
          action.type === 'play-sound' || action.type === 'take-media' ? [action.cueId] : [],
        ),
      ),
    ),
  );
  const capturedCues = new Map((context.mediaCues ?? []).map((cue) => [cue.id, cue]));
  for (const cueId of cueIds) {
    if (capturedCues.has(cueId)) continue;
    const source = composition.mediaCues.find((cue) => cue.id === cueId);
    if (!source) continue; // Ordinary validation reports an unavailable referenced cue.
    const cue = cloneComponentValue(source);
    if (cue.visual.targetLayerId && !childIds.has(cue.visual.targetLayerId)) {
      const layer = composition.layers.find((item) => item.id === cue.visual.targetLayerId);
      const target =
        layer?.componentLink?.componentId === definition.id
          ? layer.componentLink.sourceLayerId
          : undefined;
      if (!target || !childIds.has(target))
        throw new Error('Include the media target when adding its cue to a component.');
      cue.visual.targetLayerId = target;
    }
    const sourceFrame = componentFrameMapper(composition, definition, 'source');
    if (cue.trigger.type === 'timeline')
      cue.trigger.startFrame = sourceFrame(cue.trigger.startFrame);
    else if (cue.trigger.type === 'lifecycle')
      cue.trigger.keyframeId =
        new Map(
          [...componentLifecycleIds(composition, definition)].map(([canonical, actual]) => [
            actual,
            canonical,
          ]),
        ).get(cue.trigger.keyframeId) ?? cue.trigger.keyframeId;
    const ratio = context.frameRate / composition.frameRate;
    if (cue.durationFrames !== null)
      cue.durationFrames = Math.max(1, Math.round(cue.durationFrames * ratio));
    cue.transition.durationFrames = Math.max(0, Math.round(cue.transition.durationFrames * ratio));
    capturedCues.set(cue.id, cue);
  }
  context.mediaCues = [...capturedCues.values()]
    .filter(
      (cue) =>
        cueIds.has(cue.id) ||
        (!!cue.visual.targetLayerId && childIds.has(cue.visual.targetLayerId)),
    )
    .map(cloneComponentValue);
  const actionIds = new Set(
    definition.layers.flatMap((layer) => [
      ...(layer.loop?.activation.type === 'customAction'
        ? [layer.loop.activation.customActionId]
        : []),
      ...(layer.element.type === 'text' && layer.element.textAnimation.customActionId
        ? [layer.element.textAnimation.customActionId]
        : []),
      ...layer.visualRules.flatMap((rule) => [
        ...(rule.trigger === 'custom-action' && rule.eventId ? [rule.eventId] : []),
        ...rule.actions.flatMap((action) =>
          action.type === 'custom-action' || action.type === 'shader-animation'
            ? [action.actionId]
            : [],
        ),
      ]),
    ]),
  );
  for (const cue of context.mediaCues)
    if (cue.trigger.type === 'customAction') actionIds.add(cue.trigger.actionId);
  context.customActions = [
    ...new Map(
      [...composition.customActions, ...context.customActions].map((action) => [
        action.actionId,
        action,
      ]),
    ).values(),
  ]
    .filter((action) => actionIds.has(action.actionId))
    .map(cloneComponentValue);
  const rendererRefs = definition.layers.flatMap((layer) =>
    layer.element.type === 'chart' && layer.element.provider ? [layer.element.provider] : [],
  );
  const presetRefs = definition.layers.flatMap((layer) =>
    [
      ...Object.values(layer.animationPresets ?? {}),
      ...Object.values(layer.element.type === 'chart' ? (layer.element.markAnimations ?? {}) : {}),
    ].flatMap((preset) => (preset ? [preset.reference] : [])),
  );
  const identity = (value: { sha256: string; manifest: { id: string; version: string } }) =>
    `${value.manifest.id}\0${value.manifest.version}\0${value.sha256}`;
  const matches = (
    snapshot: { sha256: string; manifest: { id: string; version: string } },
    ref: { id: string; version: string; sha256: string },
  ) =>
    snapshot.sha256 === ref.sha256 &&
    snapshot.manifest.id === ref.id &&
    snapshot.manifest.version === ref.version;
  context.rendererPlugins = [
    ...new Map(
      [...(composition.rendererPlugins ?? []), ...(context.rendererPlugins ?? [])].map((plugin) => [
        identity(plugin),
        plugin,
      ]),
    ).values(),
  ]
    .filter((plugin) => rendererRefs.some((ref) => matches(plugin, ref)))
    .map(cloneComponentValue);
  context.animationPresetPlugins = [
    ...new Map(
      [
        ...(composition.animationPresetPlugins ?? []),
        ...(context.animationPresetPlugins ?? []),
      ].map((plugin) => [identity(plugin), plugin]),
    ).values(),
  ]
    .filter((plugin) => presetRefs.some((ref) => matches(plugin, ref)))
    .map(cloneComponentValue);
  context.designSystem ??= cloneComponentValue(composition.designSystem);
  const tokenIds = new Set(
    definition.layers.flatMap((layer) =>
      layer.designTokenBindings.map((binding) => binding.tokenId),
    ),
  );
  const collectFieldTokens = (field: ComponentDefinition['dataFields'][number]): void => {
    if (field.defaultTokenId) tokenIds.add(field.defaultTokenId);
    field.properties.forEach(collectFieldTokens);
    if (field.items) collectFieldTokens(field.items);
  };
  definition.dataFields.forEach(collectFieldTokens);
  for (const token of composition.designSystem.tokens)
    if (tokenIds.has(token.id) && !context.designSystem.tokens.some((item) => item.id === token.id))
      context.designSystem.tokens.push(cloneComponentValue(token));
  const typographyIds = new Set(
    definition.layers.flatMap((layer) =>
      layer.typographyBinding ? [layer.typographyBinding.presetId] : [],
    ),
  );
  for (const style of composition.designSystem.typography ?? [])
    if (
      typographyIds.has(style.id) &&
      !(context.designSystem.typography ?? []).some((item) => item.id === style.id)
    ) {
      context.designSystem.typography ??= [];
      context.designSystem.typography.push(cloneComponentValue(style));
    }
  const references = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith('asset:')) references.add(value.slice(6));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(definition.layers);
  collect(definition.dataFields);
  collect(definition.context?.mediaCues);
  const patternIds = new Set(
    definition.layers.flatMap((layer) => [
      ...walkElementContents(layer.element).flatMap((element) =>
        element.type === 'pattern' ? [element.patternId] : [],
      ),
      ...(layer.lighting ? [layer.lighting.patternId] : []),
    ]),
  );
  const patterns = new Map(
    [...composition.patterns, ...(definition.patterns ?? [])].map((pattern) => [
      pattern.id,
      pattern,
    ]),
  );
  const capturedPatterns = [...patterns.values()].filter((pattern) => patternIds.has(pattern.id));
  collect(capturedPatterns);
  const fonts = new Set(
    definition.layers.flatMap((layer) =>
      walkElementContents(layer.element).flatMap((element) =>
        element.type === 'text'
          ? element.fontFamily.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
          : [],
      ),
    ),
  );
  const resources = new Map(
    [...composition.assets, ...(definition.resources ?? [])].map((resource) => [
      resource.id,
      resource,
    ]),
  );
  const capturedResources = [...resources.values()].filter(
    (resource) =>
      references.has(resource.id) ||
      (resource.kind === 'font' && !!resource.fontFamily && fonts.has(resource.fontFamily)),
  );
  if (capturedResources.length) definition.resources = capturedResources.map(cloneComponentValue);
  else delete definition.resources;
  if (capturedPatterns.length) definition.patterns = capturedPatterns.map(cloneComponentValue);
  else delete definition.patterns;
}
