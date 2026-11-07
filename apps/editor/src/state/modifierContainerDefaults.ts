import {
  getLayerPropertyValueAtFrame,
  MODIFIER_CATALOG,
  type Composition,
  type Layer,
  type LayerModifierType,
} from '@ograf-editor/scene-model';

/** Start arrangements with legible spacing without exceeding their editable numeric range. */
export function containerModifierDefaults(
  type: LayerModifierType,
  layer: Layer,
  composition: Composition,
  frame = 0,
): Record<string, number> {
  const children = composition.layers.filter((entry) => entry.parentId === layer.id);
  const bounded = (parameter: string, value: number) => {
    const spec = MODIFIER_CATALOG[type].params[parameter]!;
    return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
  };
  const size = (property: 'width' | 'height') =>
    Math.max(0, ...children.map((child) => getLayerPropertyValueAtFrame(child, property, frame)));
  if (type === 'grid-arrange' && children.length)
    return {
      columns: Math.min(3, children.length),
      spreadX: bounded('spreadX', size('width') + 16),
      spreadY: bounded('spreadY', size('height') + 16),
    };
  if (type === 'radial-arrange' && children.length) {
    const radius = Math.round(
      Math.max(size('width'), size('height'), (children.length * size('width')) / (2 * Math.PI)),
    );
    return {
      innerRadius: bounded('innerRadius', radius),
      outerRadius: bounded('outerRadius', radius * 2),
    };
  }
  return {};
}
