import {
  MAX_EFFECTS,
  getEffectStack,
  inspectShaderResourcePaint,
  resolveShaderPackPresetPaint,
  type Layer,
  type ShaderPackPluginSnapshot,
  type ShaderPackPreset,
  type ShaderPackPresetTarget,
  type ShaderPaint,
} from '@ograf-editor/scene-model';
import { filterPluginTemplates } from '../components/pluginTemplateFilter';

export const SHADER_PACK_TARGET_LABELS: Record<ShaderPackPresetTarget, string> = {
  fill: 'Fill',
  outline: 'Outline',
  effect: 'Effect',
};

/** The standard paint editor supports these visual elements; charts retain their own provider. */
export function shaderPackLayerTargetReason(layer: Layer, target: ShaderPackPresetTarget): string {
  if (layer.isLocked) return `“${layer.name}” is locked.`;
  if (target === 'outline')
    return layer.element.type === 'text' ? '' : 'Outline shaders can only be applied to text.';
  if (target === 'effect') {
    if (layer.element.type === 'audio') return 'Audio objects do not have a visual effect surface.';
    return getEffectStack(layer.effects).length >= MAX_EFFECTS
      ? `“${layer.name}” already has the maximum ${MAX_EFFECTS} effects.`
      : '';
  }
  return [
    'rectangle',
    'ellipse',
    'path',
    'pattern',
    'text',
    'image',
    'image-sequence',
    'lottie',
  ].includes(layer.element.type)
    ? ''
    : `“${layer.name}” does not support a shader fill.`;
}

export function shaderPackTargetReason(
  preset: ShaderPackPreset,
  target: ShaderPackPresetTarget,
  layers: readonly Layer[],
): string {
  if (!preset.targets.includes(target))
    return `This shader is not available as ${SHADER_PACK_TARGET_LABELS[target].toLowerCase()}.`;
  if (!layers.length) return 'Select an object to apply this shader.';
  return layers.map((layer) => shaderPackLayerTargetReason(layer, target)).find(Boolean) ?? '';
}

export function filterShaderPackPresets(
  presets: readonly ShaderPackPreset[],
  target: ShaderPackPresetTarget,
  query: string,
): ShaderPackPreset[] {
  return filterPluginTemplates(
    presets.filter((preset) => preset.targets.includes(target)),
    query,
  );
}

/** Resources can store standalone paints or effect sources awaiting a stack's incoming image. */
export function shaderPackResourceTarget(
  preset: ShaderPackPreset,
  preferred: ShaderPackPresetTarget,
): ShaderPackPresetTarget | undefined {
  if (!inspectShaderResourcePaint(preset.paint).valid) return undefined;
  if (preset.targets.includes(preferred)) return preferred;
  return preset.targets.includes('fill')
    ? 'fill'
    : preset.targets.includes('outline')
      ? 'outline'
      : preset.targets.includes('effect')
        ? 'effect'
        : undefined;
}

// Inert 8×8 PNG fixture. It is a temporary preview texture, never copied into an effect.
const EFFECT_PREVIEW_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIUlEQVR4nGM4e/bsfxDW1dUFY3Q+A0EFuCRgfMIKBoEbAAsHnYFFmaZlAAAAAElFTkSuQmCC';

/** Prepare only the selected locally trusted preset. This copies data without allocating a GPU canvas. */
export function shaderPackPreviewPaint(
  snapshot: ShaderPackPluginSnapshot,
  presetId: string,
  target: ShaderPackPresetTarget,
): ShaderPaint {
  const paint = resolveShaderPackPresetPaint(snapshot, presetId, target);
  if (target === 'effect')
    paint.inputImage = {
      source: EFFECT_PREVIEW_IMAGE,
      name: 'Preview checkerboard — not applied',
      wrap: 'repeat',
      filter: 'nearest',
    };
  return paint;
}

export const shaderPackSelectionKey = (ids: readonly string[]): string =>
  JSON.stringify([...new Set(ids)].sort());
