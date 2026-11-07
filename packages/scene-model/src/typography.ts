import { syncDesignerBindingDefaults, type DesignerBindingPreviewReset } from './designerBindings';
import type { Composition, Layer, TypographyPreset, TypographyProperty } from './types';

export const TYPOGRAPHY_PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
] as const satisfies readonly TypographyProperty[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Presets contain only combined typography; colors and paints retain independent palette links. */
export function typographyPresetErrors(preset: unknown): string[] {
  if (!isRecord(preset)) return ['Typography presets must be objects.'];
  const errors: string[] = [];
  if (Object.keys(preset).some((key) => !['id', 'name', 'properties'].includes(key)))
    errors.push('Typography presets contain only id, name and properties.');
  if (typeof preset.id !== 'string' || !/^[-A-Za-z0-9_.]{1,100}$/.test(preset.id))
    errors.push('Typography preset IDs must be simple identifiers of 1 to 100 characters.');
  if (typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 256)
    errors.push('Typography preset names must contain 1 to 256 characters.');
  if (!isRecord(preset.properties))
    return [...errors, 'Typography preset properties must be an object.'];
  const properties = preset.properties;
  if (
    Object.keys(properties).some(
      (key) => !(TYPOGRAPHY_PROPERTIES as readonly string[]).includes(key),
    )
  )
    errors.push(
      'Typography presets cannot contain colors, paints or other non-typography properties.',
    );
  if (
    typeof properties.fontFamily !== 'string' ||
    !properties.fontFamily.trim() ||
    properties.fontFamily.length > 1024
  )
    errors.push('Typography font family must contain 1 to 1024 characters.');
  const inRange = (property: string, minimum: number, maximum: number) => {
    const value = properties[property];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
      errors.push(`Typography ${property} must be finite and between ${minimum} and ${maximum}.`);
  };
  inRange('fontSize', 1, 32768);
  inRange('fontWeight', 1, 1000);
  if (typeof properties.fontWeight === 'number' && !Number.isInteger(properties.fontWeight))
    errors.push('Typography fontWeight must be a whole number.');
  inRange('lineHeight', 0.5, 10);
  inRange('letterSpacing', -1024, 1024);
  if (
    typeof properties.textAlign !== 'string' ||
    !['left', 'center', 'right'].includes(properties.textAlign)
  )
    errors.push('Typography textAlign must be left, center or right.');
  if (
    typeof properties.textTransform !== 'string' ||
    !['none', 'uppercase', 'lowercase', 'capitalize'].includes(properties.textTransform)
  )
    errors.push('Typography textTransform must be none, uppercase, lowercase or capitalize.');
  return errors;
}

export function typographyPresetsErrors(presets: unknown): string[] {
  if (!Array.isArray(presets)) return ['Typography presets must be an array.'];
  if (presets.length > 256) return ['Use at most 256 typography presets.'];
  const errors: string[] = [],
    ids = new Set<string>();
  for (const preset of presets) {
    errors.push(...typographyPresetErrors(preset));
    if (!isRecord(preset) || typeof preset.id !== 'string') continue;
    if (ids.has(preset.id)) errors.push(`Duplicate typography preset ID: ${preset.id}.`);
    ids.add(preset.id);
  }
  return errors;
}

export function createDefaultTypographyPresets(fontFamily = 'Arial'): TypographyPreset[] {
  const base = {
    fontFamily: fontFamily.trim(),
    letterSpacing: 0,
    textAlign: 'left' as const,
    textTransform: 'none' as const,
  };
  const presets: TypographyPreset[] = [
    {
      id: 'typography-headline',
      name: 'Headline',
      properties: { ...base, fontSize: 64, fontWeight: 700, lineHeight: 1.05 },
    },
    {
      id: 'typography-body',
      name: 'Body',
      properties: { ...base, fontSize: 32, fontWeight: 400, lineHeight: 1.2 },
    },
    {
      id: 'typography-caption',
      name: 'Caption',
      properties: { ...base, fontSize: 24, fontWeight: 400, lineHeight: 1.2 },
    },
  ];
  const errors = typographyPresetsErrors(presets);
  if (errors.length) throw new Error(errors.join(' '));
  return presets;
}

export function typographyBindingErrors(
  layer: Pick<Layer, 'element' | 'typographyBinding'>,
  presets: readonly TypographyPreset[] = [],
): string[] {
  if (layer.typographyBinding === undefined) return [];
  const binding: unknown = layer.typographyBinding;
  if (!isRecord(binding)) return ['Typography binding must be an object.'];
  const errors: string[] = [];
  if (layer.element.type !== 'text') errors.push('Typography presets apply only to text layers.');
  if (Object.keys(binding).some((key) => !['presetId', 'overrides'].includes(key)))
    errors.push('Typography bindings contain only presetId and overrides.');
  if (
    typeof binding.presetId !== 'string' ||
    !presets.some((preset) => preset.id === binding.presetId)
  )
    errors.push('Typography binding references a missing preset.');
  if (
    binding.overrides !== undefined &&
    (!Array.isArray(binding.overrides) ||
      binding.overrides.length > TYPOGRAPHY_PROPERTIES.length ||
      new Set(binding.overrides).size !== binding.overrides.length ||
      binding.overrides.some(
        (property) => !(TYPOGRAPHY_PROPERTIES as readonly unknown[]).includes(property),
      ))
  )
    errors.push('Typography overrides must be unique supported typography properties.');
  return errors;
}

/** Mark only the seven exact typography properties, not content, palette, sizing or animation. */
export function markTypographyOverrides(layer: Layer, editedProperties: readonly string[]): void {
  if (layer.element.type !== 'text' || !layer.typographyBinding) return;
  const edits = editedProperties.filter((property): property is TypographyProperty =>
    (TYPOGRAPHY_PROPERTIES as readonly string[]).includes(property),
  );
  if (!edits.length) return;
  layer.typographyBinding.overrides = [
    ...new Set([...(layer.typographyBinding.overrides ?? []), ...edits]),
  ];
}

/**
 * Materialize a combined style while retaining content, local runs, geometry and property keys.
 * Explicit application owns typography token links. Later synchronization respects independent
 * token links as local precedence without deleting them. JSON snapshots also support Immer drafts.
 */
export function applyTypographyPresetBinding(
  composition: Composition,
  layer: Layer,
  preset: TypographyPreset,
  bind = true,
): DesignerBindingPreviewReset[] {
  const errors = typographyPresetErrors(preset);
  if (errors.length) throw new Error(errors.join(' '));
  if (layer.element.type !== 'text')
    throw new Error('Typography presets apply only to text layers.');
  const samePreset = layer.typographyBinding?.presetId === preset.id;
  if (samePreset) {
    const bindingErrors = typographyBindingErrors(layer, [preset]);
    if (bindingErrors.length) throw new Error(bindingErrors.join(' '));
  }
  const overrides = samePreset ? (layer.typographyBinding?.overrides ?? []) : [];
  if (bind) {
    layer.typographyBinding = {
      presetId: preset.id,
      ...(overrides.length ? { overrides: [...overrides] } : {}),
    };
    layer.designTokenBindings = layer.designTokenBindings.filter(
      (binding) => !(TYPOGRAPHY_PROPERTIES as readonly string[]).includes(binding.targetProperty),
    );
  }
  const localTokens = new Set<string>(
    !bind ? layer.designTokenBindings.map((binding) => binding.targetProperty) : [],
  );
  const inherited = TYPOGRAPHY_PROPERTIES.filter(
    (property) => !overrides.includes(property) && !localTokens.has(property),
  );
  const before = JSON.parse(JSON.stringify({ element: layer.element, effects: layer.effects }));
  if (inherited.includes('fontSize')) {
    const ratio = layer.element.minFontSize / Math.max(1, layer.element.fontSize);
    layer.element.minFontSize = Math.min(
      preset.properties.fontSize,
      Math.max(1, preset.properties.fontSize * ratio),
    );
  }
  for (const property of inherited) {
    // Every preset property has already been checked against the canonical text property type.
    (layer.element as unknown as Record<TypographyProperty, unknown>)[property] =
      preset.properties[property];
  }
  return syncDesignerBindingDefaults(composition, layer, before, inherited);
}

/** Reapply authored styles to ordinary layers and component prototypes, leaving runtime logic intact. */
export function syncTypographyPresets(composition: Composition): DesignerBindingPreviewReset[] {
  const presets = composition.designSystem.typography ?? [];
  const errors = typographyPresetsErrors(presets);
  if (errors.length) throw new Error(errors.join(' '));
  const resets: DesignerBindingPreviewReset[] = [];
  const apply = (scope: Composition) => {
    for (const layer of scope.layers) {
      if (!layer.typographyBinding) continue;
      const problems = typographyBindingErrors(layer, presets);
      if (problems.length) throw new Error(problems.join(' '));
      const preset = presets.find((item) => item.id === layer.typographyBinding!.presetId)!;
      resets.push(...applyTypographyPresetBinding(scope, layer, preset, false));
    }
  };
  apply(composition);
  for (const component of composition.components)
    apply({
      ...composition,
      layers: component.layers,
      dataFields: component.dataFields,
      components: [],
    });
  return resets.filter(
    (reset, index) =>
      resets.findIndex(
        (item) =>
          item.fieldId === reset.fieldId &&
          JSON.stringify(item.sourcePath) === JSON.stringify(reset.sourcePath),
      ) === index,
  );
}
