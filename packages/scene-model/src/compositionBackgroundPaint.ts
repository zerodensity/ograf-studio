import { createDefaultTransform, createLayerKeyframe, createRectangleLayer } from './factory';
import { validatePaint } from './paint';
import type { Composition, Layer, Paint } from './types';

/** Validate authoring catalogs without allowing malformed imported paint data to throw. */
export function backgroundStylesErrors(styles: unknown): string[] {
  if (!Array.isArray(styles)) return ['Background styles must be an array.'];
  if (styles.length > 256) return ['Use at most 256 background styles.'];
  const errors: string[] = [],
    ids = new Set<string>();
  for (const style of styles) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      errors.push('Background styles must be objects.');
      continue;
    }
    if (Object.keys(style).some((key) => !['id', 'name', 'paint'].includes(key)))
      errors.push('Background styles contain only id, name and paint.');
    if (typeof style.id !== 'string' || !/^[-A-Za-z0-9_.]{1,100}$/.test(style.id))
      errors.push('Background style IDs must be simple identifiers of 1 to 100 characters.');
    else {
      if (ids.has(style.id)) errors.push(`Duplicate background style ID: ${style.id}.`);
      ids.add(style.id);
    }
    if (typeof style.name !== 'string' || !style.name.trim() || style.name.length > 256)
      errors.push('Background style names must contain 1 to 256 characters.');
    try {
      errors.push(
        ...validatePaint(style.paint as Paint).map((error) => `Background style paint: ${error}.`),
      );
    } catch {
      errors.push('Background style contains malformed paint data.');
    }
  }
  return errors;
}

/** Render-only identity: never inserts a selectable layer into the authored composition. */
export function compositionBackgroundLayer(composition: Composition): Layer | null {
  if (composition.backgroundPaint === undefined) return null;
  const baseId = `ograf-background-${composition.id}`;
  const usedIds = new Set(composition.layers.map((layer) => layer.id));
  let id = baseId;
  let suffix = 1;
  while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
  const layer = createRectangleLayer();
  layer.id = id;
  layer.name = 'Composition background';
  layer.isLocked = true;
  if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle background.');
  layer.element.fill = structuredClone(composition.backgroundPaint);
  layer.keyframes = [
    createLayerKeyframe(
      0,
      createDefaultTransform({
        x: 0,
        y: 0,
        width: composition.width,
        height: composition.height,
        opacity: 1,
      }),
      { id: `${id}-pose` },
    ),
  ];
  return layer;
}

/** The background is a standard paintable rectangle below every authored layer and collection. */
export function compositionLayersWithBackground(composition: Composition): Layer[] {
  const background = compositionBackgroundLayer(composition);
  return background ? [background, ...composition.layers] : [...composition.layers];
}
