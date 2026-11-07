import {
  resolveElementAssetReferences,
  resolvePatternElement,
  applyElementDataValue,
  shaderPaintConflictsWithBinding,
  inspectShaderSource,
  shaderParameterTarget,
  getElementShaderPaints,
  isGradientPaint,
  parseEffectProperty,
  withEffectParameter,
  getEffectStack,
  EFFECT_CATALOG,
  LAYER_RULE_PROPERTIES,
  LAYER_TRANSFORM_BINDING_PROPERTIES,
  layerTransformBindingChannel,
  applyLayerTransformBindings,
  type LayerTransform,
  visualRuleGroupMembers,
  effectProperty,
  numericModifierProperties,
  modifierParameterSpec,
  parseModifierProperty,
  type LayerEffects,
  type TilingPattern,
  valueAtSourcePath,
  collectVisualRuleStates,
  mergeVisualRuleEffects,
  visualRuleValue,
  isVisualRuleMouseFieldId,
  type Asset,
  type Element,
  type ElementType,
  type FieldDefinition,
  type Layer,
  type LayerVisualRule,
  type VisualRuleCondition,
  type VisualRuleEffect,
  type VisualRuleEngine,
} from '@ograf-editor/scene-model';
import type { TestValue } from './testDataStore';
import { resolvePreviewFieldValue } from './previewFieldValue';

export type EditorVisualRuleEngine = VisualRuleEngine<
  VisualRuleCondition,
  LayerVisualRule,
  Record<string, TestValue>
>;

/**
 * Rule evaluation over Studio test values, keyed by field id. Array fields read their first item,
 * matching how the canvas previews bindings and runtime-collection prototypes.
 */
export function editorVisualRuleEngine(
  layers: readonly Layer[],
  dataFields: readonly FieldDefinition[],
): EditorVisualRuleEngine {
  const fields = new Map(dataFields.map((field) => [field.id, field]));
  const layerIds = new Set(layers.map((layer) => layer.id));
  const groups = visualRuleGroupMembers(layers);
  const root = (fieldId: string, values: Record<string, TestValue>) => {
    if (isVisualRuleMouseFieldId(fieldId)) return values[fieldId];
    const field = fields.get(fieldId);
    const value = resolvePreviewFieldValue(field, values[fieldId]);
    return field?.type === 'array' && Array.isArray(value) ? value[0] : value;
  };
  return {
    hosts: layers
      .filter((layer) => layer.visualRules?.length)
      .map((layer) => ({ layerId: layer.id, rules: layer.visualRules })),
    reader: {
      read: (condition, _host, values) =>
        visualRuleValue(root(condition.fieldId, values), condition.sourcePath),
      readCompare: (condition, _host, values) =>
        condition.compareFieldId
          ? {
              value: visualRuleValue(
                root(condition.compareFieldId, values),
                condition.compareSourcePath ?? [],
              ),
            }
          : null,
    },
    resolveTarget: (target) => (layerIds.has(target) ? [target] : []),
    resolveGroup: (groupId) => groups.get(groupId) ?? [],
  };
}

let effectsMemo: {
  layers: readonly Layer[];
  dataFields: readonly FieldDefinition[];
  values: Record<string, TestValue>;
  overrides: Readonly<Record<string, VisualRuleEffect>>;
  result: ReadonlyMap<string, VisualRuleEffect>;
} | null = null;

/**
 * Rule output for every layer of a composition: state rules from test values, with simulated or
 * data-change event results on top. Memoized on input identity, so every canvas node shares one
 * evaluation per edit.
 */
export function editorVisualRuleEffects(
  layers: readonly Layer[],
  dataFields: readonly FieldDefinition[],
  values: Record<string, TestValue>,
  overrides: Readonly<Record<string, VisualRuleEffect>> = {},
): ReadonlyMap<string, VisualRuleEffect> {
  if (
    effectsMemo &&
    effectsMemo.layers === layers &&
    effectsMemo.dataFields === dataFields &&
    effectsMemo.values === values &&
    effectsMemo.overrides === overrides
  )
    return effectsMemo.result;
  const states = collectVisualRuleStates(editorVisualRuleEngine(layers, dataFields), values);
  const result = new Map<string, VisualRuleEffect>();
  for (const layerId of new Set([...states.keys(), ...Object.keys(overrides)])) {
    const merged = mergeVisualRuleEffects(states.get(layerId), overrides[layerId]);
    if (merged) result.set(layerId, merged);
  }
  effectsMemo = { layers, dataFields, values, overrides, result };
  return result;
}

/** A layer's own rules, for callers that preview one layer without its composition. */
function ownVisualRuleEffect(
  layer: Layer,
  testValues: Record<string, TestValue>,
  dataFields: readonly FieldDefinition[],
): VisualRuleEffect | undefined {
  if (!layer.visualRules?.length) return undefined;
  return collectVisualRuleStates(editorVisualRuleEngine([layer], dataFields), testValues).get(
    layer.id,
  );
}

function isEffectRuleProperty(property: string): boolean {
  return property === 'dropShadowColor' || Boolean(parseEffectProperty(property));
}

interface BindableProperty {
  value: string;
  label: string;
}

/** Layer properties a data field can drive through Studio's binding controls. */
export const BINDABLE_PROPERTIES: Record<ElementType, BindableProperty[]> = {
  ticker: [
    { value: 'speedPixelsPerSecond', label: 'Scroll speed (px/s)' },
    { value: 'gap', label: 'Item gap' },
    { value: 'entryFade', label: 'Entry fade width' },
    { value: 'exitFade', label: 'Exit fade width' },
    { value: 'fadeSoftness', label: 'Fade softness' },
    { value: 'direction', label: 'Scroll direction' },
    { value: 'textDirection', label: 'Text direction' },
    { value: 'updatePolicy', label: 'Apply updates' },
    { value: 'items', label: 'Items (JSON array)' },
  ],
  text: [
    { value: 'content', label: 'Text Content' },
    { value: 'color', label: 'Text Color' },
    { value: 'fontFamily', label: 'Font family' },
    { value: 'fontSize', label: 'Font size' },
    { value: 'fontWeight', label: 'Font weight' },
    { value: 'strokeWidth', label: 'Outline width' },
    { value: 'textAlign', label: 'Text alignment' },
    { value: 'verticalAlign', label: 'Vertical alignment' },
    { value: 'lineHeight', label: 'Line height' },
    { value: 'letterSpacing', label: 'Letter spacing' },
    { value: 'baselineShift', label: 'Baseline shift' },
    { value: 'textTransform', label: 'Text transform' },
    { value: 'minFontSize', label: 'Minimum font size' },
    { value: 'overflowPolicy', label: 'Overflow' },
    { value: 'autoFit', label: 'Text sizing' },
  ],
  image: [{ value: 'src', label: 'Image URL' }],
  chart: [
    { value: 'data', label: 'Chart data (JSON)' },
    { value: 'fill', label: 'Mark fill paint' },
  ],
  rectangle: [
    { value: 'fill', label: 'Fill Paint' },
    { value: 'strokeWidth', label: 'Outline width' },
    { value: 'cornerRadius', label: 'Corner radius' },
  ],
  ellipse: [
    { value: 'fill', label: 'Fill Paint' },
    { value: 'strokeWidth', label: 'Outline width' },
  ],
  path: [
    { value: 'fill', label: 'Fill Paint' },
    { value: 'strokeWidth', label: 'Outline width' },
  ],
  pattern: [
    { value: 'fill', label: 'Fill Paint' },
    { value: 'strokeWidth', label: 'Outline width' },
  ],
  // An image sequence's frame list isn't a sensible single-value data-binding target (v1 scope).
  'image-sequence': [],
  lottie: [],
  audio: [],
  shader: [],
};

/** Bound designer controls show the current field values without applying runtime visual rules. */
export function resolveDesignerElement(
  layer: Layer,
  testValues: Record<string, TestValue>,
  dataFields: readonly FieldDefinition[] = [],
): Element {
  return layer.bindings.reduce<Element>((resolved, binding) => {
    const field = dataFields.find((candidate) => candidate.id === binding.fieldId);
    const previewValue = testValues[binding.fieldId];
    const wholeTickerFeed = resolved.type === 'ticker' && binding.targetProperty === 'items';
    const rootValue =
      wholeTickerFeed && previewValue !== undefined
        ? previewValue
        : resolvePreviewFieldValue(field, previewValue);
    const itemValue =
      field?.type === 'array' &&
      Array.isArray(rootValue) &&
      !(resolved.type === 'ticker' && binding.targetProperty === 'items')
        ? rootValue[0]
        : rootValue;
    const value = valueAtSourcePath(itemValue, binding.sourcePath);
    if (value === undefined) return resolved;
    const mapped = binding.valueMap?.[String(value)] ?? value;
    return applyElementDataValue(resolved, binding.targetProperty, mapped);
  }, layer.element);
}

/** Preview pose bindings from field defaults/test values before Rules/layout are applied. */
export function resolveDesignerTransform(
  layer: Layer,
  pose: LayerTransform,
  testValues: Record<string, TestValue>,
  dataFields: readonly FieldDefinition[],
): LayerTransform {
  return applyLayerTransformBindings(pose, layer.bindings, (binding) => {
    const field = dataFields.find((candidate) => candidate.id === binding.fieldId);
    const root = resolvePreviewFieldValue(field, testValues[binding.fieldId]);
    return valueAtSourcePath(
      field?.type === 'array' && Array.isArray(root) ? root[0] : root,
      binding.sourcePath,
    );
  });
}

/** Render data bindings plus visual-rule output while keeping the authored element untouched. */
export function resolveEffectiveElement(
  layer: Layer,
  testValues: Record<string, TestValue>,
  assets: Asset[] = [],
  dataFields: FieldDefinition[] = [],
  patterns: TilingPattern[] = [],
  ruleEffect: VisualRuleEffect | undefined = ownVisualRuleEffect(layer, testValues, dataFields),
): Element {
  let element = resolveDesignerElement(layer, testValues, dataFields);
  for (const [property, value] of Object.entries(ruleEffect?.properties ?? {})) {
    if (!isEffectRuleProperty(property)) element = applyElementDataValue(element, property, value);
  }
  return resolvePatternElement(resolveElementAssetReferences(element, assets), patterns);
}

export function resolveEffectiveVisibility(
  layer: Layer,
  testValues: Record<string, TestValue>,
  dataFields: FieldDefinition[],
  ruleEffect: VisualRuleEffect | undefined = ownVisualRuleEffect(layer, testValues, dataFields),
): boolean {
  return ruleEffect?.visibility ?? layer.isVisible;
}

export function bindableProperties(
  element: Element,
  effects?: LayerEffects,
  modifiers?: Layer['modifiers'],
): BindableProperty[] {
  const shaderPaints = getElementShaderPaints(element);
  const result = [
    ...BINDABLE_PROPERTIES[element.type].filter(
      (property) =>
        !shaderPaintConflictsWithBinding(element, property.value) &&
        !(element.type === 'text' && element.clock && ['content', 'runs'].includes(property.value)),
    ),
    ...shaderPaints.flatMap(({ slot, paint }) =>
      inspectShaderSource(paint.fragmentSource).parameters.map((parameter) => ({
        value: shaderParameterTarget(parameter.name, slot),
        label: slot === 'stroke' ? `Outline: ${parameter.name}` : parameter.name,
      })),
    ),
    { value: 'dropShadowColor', label: 'Shadow Color' },
  ];
  if (element.type === 'text' && element.clock?.source === 'manual')
    result.unshift({ value: 'clock.manualValue', label: 'Clock / Timer value' });
  if (element.type === 'text' && element.clock) {
    const timer = element.clock.mode !== 'clock';
    result.push(
      { value: 'clock.format', label: 'Time format' },
      ...(timer
        ? [
            { value: 'clock.initialValueMs', label: 'Timer duration' },
            { value: 'clock.endBehavior', label: 'Timer end behaviour' },
          ]
        : [
            { value: 'clock.timeZone', label: 'Time zone' },
            { value: 'clock.hourCycle', label: 'Hour cycle (12/24)' },
            { value: 'clock.showAmPm', label: 'Show AM/PM' },
          ]),
    );
  }
  if (element.type === 'ticker')
    for (const item of element.items)
      result.push(
        { value: `items.${item.id}.width`, label: `${item.name ?? item.id} · Width` },
        { value: `items.${item.id}.height`, label: `${item.name ?? item.id} · Height` },
        ...bindableProperties(item.element, item.effects)
          .filter((property) => !layerTransformBindingChannel(property.value))
          .map((property) => ({
            value: `items.${item.id}.${property.value}`,
            label: `${item.name ?? item.id} · ${property.label}`,
          })),
      );
  if (effects)
    for (const effect of getEffectStack(effects).filter((e) => !e.legacy))
      for (const [key, spec] of Object.entries(EFFECT_CATALOG[effect.type].params))
        result.push({
          value: effectProperty(effect, key),
          label: `${effect.name} · ${spec.label}`,
        });
  if ('strokeColor' in element && !shaderPaintConflictsWithBinding(element, 'strokeColor'))
    result.push({ value: 'strokeColor', label: 'Outline Color' });
  if ('fill' in element && isGradientPaint(element.fill))
    result.push(
      ...element.fill.stops.map((_, i) => ({
        value: `fill.stops[${i}].color`,
        label: `Gradient Stop ${i + 1} Color`,
      })),
    );
  const host = { modifiers };
  for (const property of numericModifierProperties(host)) {
    const path = parseModifierProperty(property)!;
    const modifier = modifiers?.find((entry) => entry.id === path.id);
    const spec = modifierParameterSpec(host, property);
    if (modifier && spec)
      result.push({ value: property, label: `${modifier.name} · ${spec.label}` });
  }
  return [
    ...result,
    ...LAYER_TRANSFORM_BINDING_PROPERTIES.map(({ value, label }) => ({ value, label })),
  ];
}

/**
 * What a rule's property action can change: layer offsets (rules only, composed with animation)
 * first, then the content properties bindings can also drive.
 */
export function ruleProperties(
  element: Element,
  effects?: LayerEffects,
): Array<{ label: string; options: BindableProperty[] }> {
  return [
    {
      label: 'Layer',
      options: LAYER_RULE_PROPERTIES.map((property) => ({
        value: property.value,
        label: `${property.label} (${property.unit})`,
      })),
    },
    {
      label: 'Content',
      options: bindableProperties(element, effects).filter(
        (property) => !layerTransformBindingChannel(property.value),
      ),
    },
  ];
}

export function previewBindingData(
  fields: FieldDefinition[],
  values: Record<string, TestValue>,
): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.key, resolvePreviewFieldValue(f, values[f.id])]));
}

/** Binding-only effect values for designer controls, preserving authored asset references. */
export function resolveDesignerEffects(
  layer: Layer,
  effects: LayerEffects,
  testValues: Record<string, TestValue>,
  dataFields: readonly FieldDefinition[],
): LayerEffects {
  let resolved = effects;
  for (const binding of layer.bindings) {
    if (
      binding.targetProperty !== 'dropShadowColor' &&
      !parseEffectProperty(binding.targetProperty)
    )
      continue;
    const field = dataFields.find((f) => f.id === binding.fieldId);
    const root = resolvePreviewFieldValue(field, testValues[binding.fieldId]);
    const value = valueAtSourcePath(
      field?.type === 'array' && Array.isArray(root) ? root[0] : root,
      binding.sourcePath,
    );
    if (value !== undefined) {
      const mapped = binding.valueMap?.[String(value)] ?? value;
      resolved =
        binding.targetProperty === 'dropShadowColor'
          ? { ...resolved, dropShadowColor: String(mapped) }
          : withEffectParameter(resolved, binding.targetProperty, mapped);
    }
  }
  return resolved;
}

export function resolveEffectiveEffects(
  layer: Layer,
  effects: LayerEffects,
  testValues: Record<string, TestValue>,
  dataFields: FieldDefinition[],
  ruleEffect: VisualRuleEffect | undefined = ownVisualRuleEffect(layer, testValues, dataFields),
): LayerEffects {
  let resolved = resolveDesignerEffects(layer, effects, testValues, dataFields);
  for (const [property, value] of Object.entries(ruleEffect?.properties ?? {})) {
    if (property === 'dropShadowColor') resolved = { ...resolved, dropShadowColor: String(value) };
    else if (parseEffectProperty(property)) {
      try {
        resolved = withEffectParameter(resolved, property, value);
      } catch {
        // The effect was removed after the rule was written.
      }
    }
  }
  return resolved;
}
