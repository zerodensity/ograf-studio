import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  CompiledTransitionLogicTemplate,
} from '@ograf-editor/ograf-types';
import {
  clockTimerActionId,
  parseClockTimerActionId,
  type ClockTimerCommand,
} from '@ograf-editor/scene-model';

export function coordinatedLayers(graphic: CompiledGraphicDescriptor) {
  return [
    ...graphic.layers,
    ...(graphic.collections ?? []).flatMap((collection) =>
      collection.capacity > 0 ? collection.prototypeLayers : [],
    ),
  ];
}

export function executableTimerAction(
  layer: ReturnType<typeof coordinatedLayers>[number] | undefined,
  command: ClockTimerCommand,
): boolean {
  return (
    layer?.element.type === 'text' &&
    !!layer.element.clock &&
    layer.element.clock.mode !== 'clock' &&
    (layer.element.clock.source === 'automatic' || command === 'reset' || command === 'restart')
  );
}

/** Shared by manifest command generation and discovery so timer ownership cannot diverge. */
export function coordinatedTemplateActions(
  descriptor: CompiledTransitionLogicDescriptor,
  template: CompiledTransitionLogicTemplate,
  slotId: string,
) {
  const layers = coordinatedLayers(template.descriptor);
  return template.descriptor.customActions.filter((action) => {
    const clock = parseClockTimerActionId(action.id);
    if (!clock) return true;
    const link = template.sharedLayers.find((candidate) => candidate.layerId === clock.layerId);
    const instance =
      link &&
      descriptor.definition.sharedInstances.find((candidate) => candidate.id === link.instanceId);
    if (instance?.slotId && instance.slotId !== slotId) return false;
    const source = link
      ? descriptor.sharedInstances.find((candidate) => candidate.id === link.instanceId)?.descriptor
      : undefined;
    const clockLayers = source ? coordinatedLayers(source) : layers;
    return executableTimerAction(
      clockLayers.find((layer) => layer.id === (link?.sourceLayerId ?? clock.layerId)),
      clock.command,
    );
  });
}

/** Qualified retained timers needed by any related template without its own executable proxy. */
export function coordinatedSharedTimerActions(
  descriptor: CompiledTransitionLogicDescriptor,
  templates: readonly CompiledTransitionLogicTemplate[],
  slotId: string,
) {
  const candidates = templates.map((template) => ({
    template,
    aliases: new Set(
      coordinatedTemplateActions(descriptor, template, slotId).flatMap((action) => {
        const clock = parseClockTimerActionId(action.id);
        const link =
          clock && template.sharedLayers.find((candidate) => candidate.layerId === clock.layerId);
        return clock && link
          ? [
              clockTimerActionId(
                JSON.stringify([link.instanceId, link.sourceLayerId]),
                clock.command,
              ),
            ]
          : [];
      }),
    ),
  }));
  return descriptor.definition.sharedInstances.flatMap((instance) => {
    if (instance.slotId && instance.slotId !== slotId) return [];
    const related = candidates.filter(
      ({ template }) =>
        template.sharedLayers.some((link) => link.instanceId === instance.id) ||
        template.sharedDataBindings.some((link) => link.instanceId === instance.id),
    );
    if (!related.length) return [];
    const shared = descriptor.sharedInstances.find((candidate) => candidate.id === instance.id)!;
    const layers = coordinatedLayers(shared.descriptor);
    return shared.descriptor.customActions.flatMap((action) => {
      const clock = parseClockTimerActionId(action.id);
      if (
        !clock ||
        !executableTimerAction(
          layers.find((layer) => layer.id === clock.layerId),
          clock.command,
        )
      )
        return [];
      const id = clockTimerActionId(JSON.stringify([instance.id, clock.layerId]), clock.command);
      if (related.every((candidate) => candidate.aliases.has(id))) return [];
      return [{ ...action, id, name: `${instance.name} / ${action.name}` }];
    });
  });
}
