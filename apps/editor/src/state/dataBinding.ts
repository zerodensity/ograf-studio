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
  effectProperty,
  readColor,
  type LayerEffects,
  type TilingPattern,
  valueAtSourcePath,
  type Asset,
  type Element,
  type ElementType,
  type FieldDefinition,
  type FieldType,
  type Layer,
} from '@ograf-editor/scene-model';
import type { TestValue } from './testDataStore';

export interface BindableProperty {
  value: string;
  label: string;
  fieldTypes: readonly FieldType[];
  selectValues?: 'any' | 'color' | 'font-family' | readonly string[];
}

const TEXT_FIELDS: FieldType[] = ['text', 'textarea', 'select'];
const NUMBER_FIELDS: FieldType[] = ['number', 'integer', 'duration-ms', 'percentage'];
const TEXT_NUMBER_FIELDS: FieldType[] = ['number', 'integer'];
const COLOR_FIELDS: FieldType[] = ['color', 'select'];
const TEXT_ALIGN_VALUES = ['left', 'center', 'right'] as const;
const VERTICAL_ALIGN_VALUES = ['top', 'middle', 'bottom'] as const;
const TEXT_TRANSFORM_VALUES = ['none', 'uppercase', 'lowercase', 'capitalize'] as const;
const OVERFLOW_VALUES = ['visible', 'clip', 'ellipsis'] as const;
const AUTO_FIT_VALUES = ['auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'] as const;
const TEXT_ENUM_VALUES = new Set<string>([
  ...TEXT_ALIGN_VALUES,
  ...VERTICAL_ALIGN_VALUES,
  ...TEXT_TRANSFORM_VALUES,
  ...OVERFLOW_VALUES,
  ...AUTO_FIT_VALUES,
]);
const FILL_PROPERTY: BindableProperty = {
  value: 'fill',
  label: 'Fill Paint',
  fieldTypes: ['color', 'gradient', 'select'],
  selectValues: 'color',
};

/** Layer properties a data field can drive — deliberately just the "content" surface of each element type. */
export const BINDABLE_PROPERTIES: Record<ElementType, BindableProperty[]> = {
  text: [
    { value: 'content', label: 'Text Content', fieldTypes: TEXT_FIELDS, selectValues: 'any' },
    { value: 'color', label: 'Text Color', fieldTypes: COLOR_FIELDS, selectValues: 'color' },
    {
      value: 'fontFamily',
      label: 'Font family',
      fieldTypes: ['select'],
      selectValues: 'font-family',
    },
    { value: 'fontSize', label: 'Font size', fieldTypes: TEXT_NUMBER_FIELDS },
    { value: 'fontWeight', label: 'Font weight', fieldTypes: TEXT_NUMBER_FIELDS },
    { value: 'strokeWidth', label: 'Outline width', fieldTypes: TEXT_NUMBER_FIELDS },
    {
      value: 'textAlign',
      label: 'Text alignment',
      fieldTypes: ['select'],
      selectValues: TEXT_ALIGN_VALUES,
    },
    {
      value: 'verticalAlign',
      label: 'Vertical alignment',
      fieldTypes: ['select'],
      selectValues: VERTICAL_ALIGN_VALUES,
    },
    { value: 'lineHeight', label: 'Line height', fieldTypes: TEXT_NUMBER_FIELDS },
    { value: 'letterSpacing', label: 'Letter spacing', fieldTypes: TEXT_NUMBER_FIELDS },
    { value: 'baselineShift', label: 'Baseline shift', fieldTypes: TEXT_NUMBER_FIELDS },
    {
      value: 'textTransform',
      label: 'Text transform',
      fieldTypes: ['select'],
      selectValues: TEXT_TRANSFORM_VALUES,
    },
    { value: 'minFontSize', label: 'Minimum font size', fieldTypes: TEXT_NUMBER_FIELDS },
    {
      value: 'overflowPolicy',
      label: 'Overflow',
      fieldTypes: ['select'],
      selectValues: OVERFLOW_VALUES,
    },
    {
      value: 'autoFit',
      label: 'Text sizing',
      fieldTypes: ['select'],
      selectValues: AUTO_FIT_VALUES,
    },
  ],
  image: [{ value: 'src', label: 'Image URL', fieldTypes: ['image-url', 'file-path', 'text'] }],
  rectangle: [FILL_PROPERTY],
  ellipse: [FILL_PROPERTY],
  path: [FILL_PROPERTY],
  pattern: [FILL_PROPERTY],
  // An image sequence's frame list isn't a sensible single-value data-binding target (v1 scope).
  'image-sequence': [],
  lottie: [],
  shader: [],
};

/**
 * The element a layer should render with, given live test data — the authored `element` is left
 * untouched; each bound property is overridden only for display when a test value is present.
 * The shared value applicator preserves paint objects and validated numeric text properties.
 */
export function resolveEffectiveElement(
  layer: Layer,
  testValues: Record<string, TestValue>,
  assets: Asset[] = [],
  dataFields: FieldDefinition[] = [],
  patterns: TilingPattern[] = [],
): Element {
  const element = layer.bindings.reduce<Element>((resolved, binding) => {
    const hasTestValue = Object.prototype.hasOwnProperty.call(testValues, binding.fieldId);
    const rootValue = hasTestValue
      ? testValues[binding.fieldId]
      : dataFields.find((field) => field.id === binding.fieldId)?.defaultValue;
    const field = dataFields.find((candidate) => candidate.id === binding.fieldId);
    const itemValue =
      field?.type === 'array' && Array.isArray(rootValue) ? rootValue[0] : rootValue;
    const value = valueAtSourcePath(itemValue, binding.sourcePath);
    if (value === undefined) return resolved;
    const mapped = binding.valueMap?.[String(value)] ?? value;
    return applyElementDataValue(resolved, binding.targetProperty, mapped);
  }, layer.element);
  return resolvePatternElement(resolveElementAssetReferences(element, assets), patterns);
}

export function bindableProperties(element: Element, effects?: LayerEffects): BindableProperty[] {
  const shaderPaints = getElementShaderPaints(element);
  const result: BindableProperty[] = [
    ...BINDABLE_PROPERTIES[element.type].filter(
      (property) => !shaderPaintConflictsWithBinding(element, property.value),
    ),
    ...shaderPaints.flatMap(({ slot, paint }) =>
      inspectShaderSource(paint.fragmentSource).parameters.map((parameter) => {
        const color = parameter.control === 'color';
        return {
          value: shaderParameterTarget(parameter.name, slot),
          label: slot === 'stroke' ? `Outline: ${parameter.name}` : parameter.name,
          fieldTypes:
            parameter.control === 'toggle'
              ? (['boolean'] as const)
              : color
                ? COLOR_FIELDS
                : parameter.control === 'vector2'
                  ? []
                  : NUMBER_FIELDS,
          ...(color ? { selectValues: 'color' as const } : {}),
        };
      }),
    ),
    {
      value: 'dropShadowColor',
      label: 'Shadow Color',
      fieldTypes: COLOR_FIELDS,
      selectValues: 'color',
    },
  ];
  if (effects)
    for (const effect of getEffectStack(effects).filter((e) => !e.legacy))
      for (const [key, spec] of Object.entries(EFFECT_CATALOG[effect.type].params))
        result.push({
          value: effectProperty(effect, key),
          label: `${effect.name} · ${spec.label}`,
          fieldTypes: typeof spec.default === 'number' ? NUMBER_FIELDS : COLOR_FIELDS,
          ...(typeof spec.default === 'number' ? {} : { selectValues: 'color' as const }),
        });
  if ('strokeColor' in element && !shaderPaintConflictsWithBinding(element, 'strokeColor'))
    result.push({
      value: 'strokeColor',
      label: 'Outline Color',
      fieldTypes: COLOR_FIELDS,
      selectValues: 'color',
    });
  if ('fill' in element && isGradientPaint(element.fill))
    result.push(
      ...element.fill.stops.map((_, i) => ({
        value: `fill.stops[${i}].color`,
        label: `Gradient Stop ${i + 1} Color`,
        fieldTypes: COLOR_FIELDS,
        selectValues: 'color' as const,
      })),
    );
  return result;
}

export function propertyAcceptsFieldType(property: BindableProperty, type: FieldType): boolean {
  return property.fieldTypes.includes(type);
}

export function propertyAcceptsField(
  property: BindableProperty,
  field: Pick<FieldDefinition, 'type' | 'options'>,
): boolean {
  if (!propertyAcceptsFieldType(property, field.type)) return false;
  if (field.type !== 'select') return true;
  const values = field.options.map((option) => option.value);
  if (values.length === 0) return property.selectValues === 'any';
  if (property.selectValues === 'any') return true;
  if (property.selectValues === 'color') return values.every((value) => readColor(value) !== null);
  if (property.selectValues === 'font-family') {
    return values.every((value) => readColor(value) === null && !TEXT_ENUM_VALUES.has(value));
  }
  return Array.isArray(property.selectValues)
    ? values.every((value) => property.selectValues!.includes(value))
    : false;
}

export function previewBindingData(
  fields: FieldDefinition[],
  values: Record<string, TestValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [f.key, Object.hasOwn(values, f.id) ? values[f.id] : f.defaultValue]),
  );
}

export function resolveEffectiveEffects(
  layer: Layer,
  effects: LayerEffects,
  testValues: Record<string, TestValue>,
  dataFields: FieldDefinition[],
): LayerEffects {
  let resolved = effects;
  for (const binding of layer.bindings) {
    if (
      binding.targetProperty !== 'dropShadowColor' &&
      !parseEffectProperty(binding.targetProperty)
    )
      continue;
    const field = dataFields.find((f) => f.id === binding.fieldId);
    const root = Object.hasOwn(testValues, binding.fieldId)
      ? testValues[binding.fieldId]
      : field?.defaultValue;
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
