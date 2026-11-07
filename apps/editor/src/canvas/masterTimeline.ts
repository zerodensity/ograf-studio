import type { Composition, TextElement } from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { buildRuntimeTimeline, publishRuntimeVisualRuleEffect } from '@ograf-editor/ograf-runtime';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import { editorVisualRuleEffects, previewBindingData } from '../state/dataBinding';
import { useTestDataStore } from '../state/testDataStore';

/** Publish cross-object/group and simulated rule results before the shared pose sampler reads. */
export function editorRuntimeData(composition: Composition, layers: readonly CompiledLayer[]) {
  const state = useTestDataStore.getState();
  const effects = editorVisualRuleEffects(
    composition.layers,
    composition.dataFields,
    state.values,
    state.visualRuleStateOverrides,
  );
  for (const layer of layers) publishRuntimeVisualRuleEffect(layer, effects.get(layer.id) ?? null);
  return previewBindingData(composition.dataFields, state.values);
}

/**
 * Build the paused OGraf frame player used by the editor transport. Seeking evaluates the
 * descriptor at the requested composition frame, independent of the previous DOM pose.
 */
export function buildMasterTimeline(
  composition: Composition,
  layerRefs: Map<string, HTMLElement>,
  clockTextProvider?: () => ReadonlyMap<string, TextElement>,
  compiledDescriptor?: CompiledGraphicDescriptor,
): ReturnType<typeof buildRuntimeTimeline> {
  // One compiler and one timeline interpreter now power both authoring and the exported graphic.
  // Guides are retained only for the editor canvas; export uses compileDescriptor's default.
  const descriptor = compiledDescriptor ?? compileDescriptor(composition, { includeGuides: true });
  return buildRuntimeTimeline(
    descriptor,
    layerRefs,
    () => editorRuntimeData(composition, descriptor.layers),
    clockTextProvider ? () => ({ clockText: clockTextProvider() }) : undefined,
  );
}
