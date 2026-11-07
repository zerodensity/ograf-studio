import {
  inspectShaderElement,
  inspectShaderResourcePaint,
  isShaderPackPluginSnapshot,
  rendererPluginKey,
  resolveShaderPackPresetPaint,
  studioPluginReference,
  type Layer,
  type ShaderPackPresetTarget,
  type ShaderPaint,
} from '@ograf-editor/scene-model';
import {
  shaderPackLayerTargetReason,
  SHADER_PACK_TARGET_LABELS,
} from '../panels/shaderPackGalleryHelpers';
import { runDiscreteHistoryStep } from './historyStore';
import { assertStudioPluginsAllowed, useRendererPluginSettingsStore } from './pluginSettingsStore';
import { getActiveComposition, useProjectStore } from './projectStore';
import { decodeShaderPluginPresetDrag, type ShaderCanvasDragData } from './shaderCanvasDrag';
import { shaderPaintFromResourceDrag } from './shaderDrag';

export interface ShaderCanvasDropContext {
  projectId: string;
  compositionId: string;
  layerIds: readonly string[];
}

function resolveSource(source: ShaderCanvasDragData): {
  paint: ShaderPaint;
  targets: readonly ShaderPackPresetTarget[];
} {
  const project = useProjectStore.getState().project;
  if (source.kind === 'resource')
    return {
      paint: shaderPaintFromResourceDrag(project, source.payload),
      targets: ['fill', 'outline', 'effect'],
    };
  if (source.kind !== 'plugin') throw new Error('Unknown shader drag source.');
  const { reference, presetId } = decodeShaderPluginPresetDrag(project, source.payload);
  const entry = useRendererPluginSettingsStore
    .getState()
    .installed.find(
      (candidate) =>
        candidate.enabled &&
        candidate.trusted &&
        isShaderPackPluginSnapshot(candidate.snapshot) &&
        rendererPluginKey(studioPluginReference(candidate.snapshot)) ===
          rendererPluginKey(reference),
    );
  if (!entry || !isShaderPackPluginSnapshot(entry.snapshot))
    throw new Error('Install, review and enable this exact shader pack in Plugins first.');
  assertStudioPluginsAllowed([entry.snapshot]);
  const preset = entry.snapshot.shaders.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error('This shader pack preset no longer exists.');
  return {
    paint: resolveShaderPackPresetPaint(entry.snapshot, preset.id, preset.targets[0]!),
    targets: preset.targets,
  };
}

function resolveTargets(context: ShaderCanvasDropContext): Layer[] {
  const state = useProjectStore.getState();
  if (state.project.id !== context.projectId)
    throw new Error('The project changed while choosing how to apply the shader.');
  if (state.activeCompositionId !== context.compositionId)
    throw new Error('The active composition changed while choosing how to apply the shader.');
  const composition = getActiveComposition(state.project, context.compositionId);
  const ids = new Set(context.layerIds);
  if (!ids.size) throw new Error('Drop the shader on an object or select an object first.');
  const layers = composition.layers.filter((layer) => ids.has(layer.id));
  if (layers.length !== ids.size) throw new Error('A shader drop target no longer exists.');
  return layers;
}

/** Opening a choice popup is read-only. Disabled choices explain source and target restrictions. */
export function shaderCanvasDropChoices(
  source: ShaderCanvasDragData,
  context: ShaderCanvasDropContext,
): {
  name: string;
  options: Array<{ target: ShaderPackPresetTarget; label: string; reason: string }>;
} {
  const layers = resolveTargets(context);
  const { paint, targets } = resolveSource(source);
  const resourceInspection = inspectShaderResourcePaint(paint);
  if (!resourceInspection.valid) throw new Error(resourceInspection.errors.join('\n'));
  return {
    name: paint.name?.trim() || 'Shader',
    options: (['fill', 'outline', 'effect'] as const).map((target) => {
      let reason = targets.includes(target)
        ? (layers.map((layer) => shaderPackLayerTargetReason(layer, target)).find(Boolean) ?? '')
        : `This shader is not available as ${SHADER_PACK_TARGET_LABELS[target].toLowerCase()}.`;
      if (!reason) {
        const copy = structuredClone(paint);
        if (target === 'effect') delete copy.inputImage;
        const inspection = inspectShaderElement(copy, { channel0Provided: target === 'effect' });
        if (!inspection.valid) reason = inspection.errors.join(' ');
      }
      return { target, label: SHADER_PACK_TARGET_LABELS[target], reason };
    }),
  };
}

/** Re-resolve identities and authorization at click time, then save and apply in one undo step. */
export function applyShaderCanvasDrop(
  source: ShaderCanvasDragData,
  context: ShaderCanvasDropContext,
  target: ShaderPackPresetTarget,
): void {
  const choices = shaderCanvasDropChoices(source, context);
  const choice = choices.options.find((option) => option.target === target);
  if (!choice) throw new Error('Unknown shader application target.');
  if (choice.reason) throw new Error(choice.reason);
  const { paint } = resolveSource(source);
  runDiscreteHistoryStep(
    () =>
      useProjectStore
        .getState()
        .applyShaderPaintToLayers(context.layerIds, paint, target, { saveResource: true }),
    `Apply ${choices.name} as ${choice.label}`,
  );
}

/** Dropping a template into Resources only saves an independent editable library copy. */
export function importShaderCanvasDragToResources(source: ShaderCanvasDragData): void {
  const { paint } = resolveSource(source);
  const inspection = inspectShaderResourcePaint(paint);
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  runDiscreteHistoryStep(
    () => useProjectStore.getState().ensureShaderResource(paint),
    `Add ${paint.name?.trim() || 'Shader'} to Resources`,
  );
}
