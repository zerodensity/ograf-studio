import { getEffectStack, effectParams, effectProperty } from './effectStack';
import {
  colorLinkKey,
  layerColorValue,
  readColor,
  syncStylePackColorLinks,
} from './stylePackColorLinks';
import {
  rememberPackProperty,
  rememberPackToken,
  rememberPackColorField,
} from './stylePackRestore';
import type { Composition, DesignTokenTargetProperty, Layer, StylePackColorLink } from './types';

const KEYS = {
  background: 'brand.color.background',
  surface: 'brand.color.surface',
  accent: 'brand.color.accent',
  primary: 'brand.color.text.primary',
  secondary: 'brand.color.text.secondary',
  outline: 'brand.color.text.outline',
} as const;
type Role = keyof typeof KEYS;
interface PlannedColor extends Omit<StylePackColorLink, 'sourceTokenId'> {
  role: Role;
  priority: number;
}

function roleFor(
  layer: Layer,
  property: string,
  brightness: number,
  highlightGradient: boolean,
): { role: Role; priority: number } {
  if (property === 'color') {
    if (layer.semantics.role === 'label' && brightness < 128)
      return { role: 'outline', priority: 100 };
    return {
      role: ['subheadline', 'label', 'ticker'].includes(layer.semantics.role)
        ? 'secondary'
        : 'primary',
      priority: 80,
    };
  }
  if (property === 'dropShadowColor' || property.startsWith('effects.')) {
    const glow = getEffectStack(layer.effects).some(
      (e) => e.type === 'glow' && property === effectProperty(e, 'color'),
    );
    return glow || (layer.lighting && brightness > 0)
      ? { role: 'accent', priority: 90 }
      : { role: 'outline', priority: 10 };
  }
  if (layer.lighting || ['accent', 'icon'].includes(layer.semantics.role))
    return { role: 'accent', priority: 90 };
  if (highlightGradient && property.startsWith('fill.stops['))
    return { role: 'accent', priority: 75 };
  if (property === 'strokeColor')
    return { role: layer.element.type === 'pattern' ? 'accent' : 'outline', priority: 50 };
  if (layer.element.type === 'pattern') return { role: 'surface', priority: 60 };
  if (layer.semantics.role === 'background' || brightness === 0)
    return { role: 'background', priority: 30 };
  return { role: 'surface', priority: 40 };
}

/** Plan before materializing a pack so shared fields and original gradient tones stay authoritative. */
export function planStylePackPalette(
  composition: Composition,
  allowed?: Set<string>,
): PlannedColor[] {
  const channels = new Map<string, PlannedColor>();
  const restore = composition.designSystem.stylePackRestore;
  for (const layer of composition.layers) {
    if ((allowed && !allowed.has(layer.id)) || layer.isMaskOnly || layer.semantics.role === 'mask')
      continue;
    const properties: DesignTokenTargetProperty[] = [];
    if ('fill' in layer.element) {
      if (typeof layer.element.fill === 'string') properties.push('fill');
      else layer.element.fill.stops.forEach((_, i) => properties.push(`fill.stops[${i}].color`));
    }
    if (layer.element.type === 'text') properties.push('color');
    if ('strokeColor' in layer.element && layer.element.strokeWidth > 0)
      properties.push('strokeColor');
    if (layer.effects.dropShadowEnabled) properties.push('dropShadowColor');
    for (const effect of getEffectStack(layer.effects))
      if (!effect.legacy)
        for (const [key, value] of Object.entries(effectParams(effect, layer.effects)))
          if (typeof value === 'string')
            properties.push(effectProperty(effect, key) as DesignTokenTargetProperty);
    const uses = properties
      .map((property) => {
        const binding = layer.bindings.find(
          (b) => b.targetProperty === property && !b.sourcePath?.length && !b.valueMap,
        );
        const field = composition.dataFields.find(
          (f) => f.id === binding?.fieldId && f.type === 'color',
        );
        const fieldToken = field?.defaultTokenId
          ? composition.designSystem.tokens.find(
              (t) => t.id === field.defaultTokenId && t.type === 'color',
            )
          : undefined;
        const styleBinding = layer.designTokenBindings.find((b) => b.targetProperty === property);
        const styleToken = composition.designSystem.tokens.find(
          (t) => t.id === styleBinding?.tokenId && t.type === 'color',
        );
        const token = fieldToken ?? styleToken;
        const customToken =
          token && !Object.values(KEYS).includes(token.key as (typeof KEYS)[Role])
            ? token
            : undefined;
        const original = customToken
          ? (restore?.tokens.find((t) => t.token.id === customToken.id)?.token.value ??
            customToken.value)
          : field
            ? (restore?.fields.find((f) => f.fieldId === field.id)?.defaultValue ??
              field.defaultValue)
            : (restore?.layers
                .find((l) => l.layerId === layer.id)
                ?.properties.find((p) => p.property === property)?.value ??
              layerColorValue(layer, property));
        return { property, field, fieldToken, token, customToken, color: readColor(original) };
      })
      .filter((use) => use.color);
    const maximum = Math.max(
      0,
      ...uses
        .filter((u) => u.property.startsWith('fill.stops['))
        .map((u) => Math.max(...u.color!.rgb)),
    );
    const highlightGradient =
      maximum > 127 &&
      'fill' in layer.element &&
      typeof layer.element.fill !== 'string' &&
      layer.element.fill.stops.some((s) => s.opacity < 0.05) &&
      layer.element.fill.stops.some((s) => s.opacity > 0.1);
    for (const use of uses) {
      const brightness = Math.max(...use.color!.rgb);
      const role = roleFor(layer, use.property, brightness, highlightGradient);
      const explicitRole =
        use.fieldToken &&
        (Object.entries(KEYS).find(([, key]) => key === use.fieldToken!.key)?.[0] as
          Role | undefined);
      // An existing custom field may intentionally join an accent and a container; accent wins.
      const selected = use.field && explicitRole ? { role: explicitRole, priority: 1000 } : role;
      const factor =
        layer.lighting && use.property !== 'dropShadowColor'
          ? brightness / 255
          : use.property.startsWith('fill.stops[') && maximum > 0
            ? brightness / maximum
            : 1;
      const target = { layerId: layer.id, property: use.property };
      const proposed: PlannedColor = {
        ...selected,
        factor,
        alpha: use.color!.alpha,
        targets: [target],
        ...(use.customToken
          ? { targetTokenId: use.customToken.id }
          : use.field
            ? { targetFieldId: use.field.id }
            : {}),
      };
      const key = colorLinkKey(proposed),
        prior = channels.get(key);
      if (prior) {
        prior.targets.push(target);
        if (selected.priority > prior.priority)
          Object.assign(prior, selected, { factor, alpha: use.color!.alpha });
      } else channels.set(key, proposed);
      rememberPackProperty(composition, layer, use.property);
      if (use.customToken) {
        rememberPackToken(composition, use.customToken.id);
        for (const consumer of [
          ...composition.layers,
          ...composition.components.flatMap((c) => c.layers),
        ]) {
          for (const binding of consumer.designTokenBindings)
            if (binding.tokenId === use.customToken.id)
              rememberPackProperty(composition, consumer, binding.targetProperty);
        }
        for (const field of [
          ...composition.dataFields,
          ...composition.components.flatMap((c) => c.dataFields),
        ])
          if (field.defaultTokenId === use.customToken.id)
            rememberPackColorField(composition, field.id);
      }
      if (use.field) rememberPackColorField(composition, use.field.id);
    }
  }
  return [...channels.values()];
}

export function applyStylePackPalette(
  composition: Composition,
  planned: PlannedColor[],
  replaceAll = true,
): string[] {
  const links = new Map(
    (replaceAll ? [] : (composition.designSystem.stylePackColors ?? [])).map((link) => [
      colorLinkKey(link),
      link,
    ]),
  );
  for (const plan of planned) {
    const source = composition.designSystem.tokens.find(
      (t) => t.key === KEYS[plan.role] && t.type === 'color',
    );
    if (!source) continue;
    const { role: _role, priority: _priority, ...rest } = plan;
    const link = { ...rest, sourceTokenId: source.id };
    links.set(colorLinkKey(link), link);
    for (const target of link.targets) {
      const layer = composition.layers.find((l) => l.id === target.layerId)!;
      const tokenId =
        link.targetTokenId ??
        (!link.targetFieldId && link.factor === 1 && link.alpha === 1 ? source.id : undefined);
      layer.designTokenBindings = layer.designTokenBindings.filter(
        (b) => b.targetProperty !== target.property,
      );
      if (tokenId) layer.designTokenBindings.push({ tokenId, targetProperty: target.property });
    }
  }
  if (links.size) composition.designSystem.stylePackColors = [...links.values()];
  else delete composition.designSystem.stylePackColors;
  return syncStylePackColorLinks(composition);
}
