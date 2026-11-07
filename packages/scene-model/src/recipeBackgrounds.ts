import { applyDesignTokenBinding } from './designSystem';
import { createShaderPaint, isShaderPaint } from './shader';
import { syncShaderParameterFields } from './shaderFields';
import { shaderColorToHex } from './shaderParameters';
import { readColor } from './stylePackColorLinks';
import type { StylePackId } from './stylePacks';
import type { Composition, DesignTokenBinding, FieldDefinition, Layer, ShaderPaint } from './types';

const HEADER = `#pragma ograf ink color
vec4 ink = vec4(0.05, 0.09, 0.15, 1.0);
#pragma ograf accent color
vec4 accent = vec4(0.15, 0.65, 0.85, 1.0);
#pragma ograf strength slider min(0) max(0.5) step(0.01)
float strength = 0.18;
#pragma ograf speed slider min(0) max(2) step(0.05)
float speed = 1.0;

void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy;
  vec2 p = vec2(uv.x * iResolution.x / iResolution.y, uv.y);
  float aa = 1.5 / max(1.0, iResolution.y);
  float t = iTime * speed;
`;

const FOOTER = `
  // Keep the text area calm and preserve the original panel's subtle alpha falloff.
  float edge = 0.40 + 0.60 * pow(abs(uv.y - 0.5) * 2.0, 2.0);
  vec3 surface = ink.rgb * mix(1.06, 0.90, uv.x);
  float reflectionDistance = abs(uv.x + uv.y * 0.18 - mix(-0.35, 1.35, fract(t / 7.0)));
  float reflection = pow(max(0.0, 1.0 - reflectionDistance / 0.24), 3.0);
  surface = mix(surface, vec3(1.0), reflection * strength * 0.32 * edge);
  float light = clamp(motif * strength * accent.a * edge, 0.0, 0.35);
  color = vec4(mix(surface, accent.rgb, light), ink.a * mix(0.97, 0.78, uv.x));
}`;

/** Original single-pass motifs: no images, input textures, loops or post-processing. */
const BACKGROUNDS: Record<StylePackId, { name: string; source: string }> = {
  news: {
    name: 'News / Signal grid',
    source:
      HEADER +
      `  vec2 cell = abs(fract(p / 0.34 + 0.5) - 0.5) * 0.34;
  float grid = 1.0 - smoothstep(aa, aa * 2.0, min(cell.x, cell.y));
  float signal = pow(0.5 + 0.5 * sin(p.x * 1.2 - t * 0.32), 8.0);
  float horizon = exp(-abs(uv.y - 0.22) * 14.0);
  float motif = grid * (0.25 + signal * 0.45) + horizon * signal * 0.45;` +
      FOOTER,
  },
  sports: {
    name: 'Sports / Velocity diagonals',
    source:
      HEADER +
      `  float diagonal = p.x * 0.68 + p.y;
  float lane = abs(fract(diagonal / 0.38 + 0.5) - 0.5) * 0.38;
  float stripes = 1.0 - smoothstep(0.025, 0.025 + aa, lane);
  float energy = 0.5 + 0.5 * sin(diagonal * 2.1 - t * 0.58);
  float motif = stripes * (0.25 + energy * 0.55) + energy * 0.12;` +
      FOOTER,
  },
  entertainment: {
    name: 'Entertainment / Studio ribbons',
    source:
      HEADER +
      `  float wave = sin(p.x * 0.9 - t * 0.18) * 0.18;
  float ribbonDistance = (uv.y - 0.35 - wave) * 9.0;
  float secondDistance = (uv.y - 0.72 + wave * 0.7) * 12.0;
  float ribbon = exp(-ribbonDistance * ribbonDistance);
  float second = exp(-secondDistance * secondDistance);
  vec2 lightPosition = vec2(0.68 + 0.12 * sin(t * 0.13), 0.18);
  float bloom = exp(-dot(uv - lightPosition, uv - lightPosition) * 8.0);
  float motif = ribbon * 0.60 + second * 0.38 + bloom * 0.24;` +
      FOOTER,
  },
  documentary: {
    name: 'Documentary / Contour atlas',
    source:
      HEADER +
      `  float terrain = p.y + sin(p.x * 0.8 + t * 0.035) * 0.17
    + sin(p.x * 1.9 - t * 0.025) * 0.045;
  float contours = abs(fract(terrain * 7.0 + 0.5) - 0.5) / 7.0;
  float lines = 1.0 - smoothstep(aa * 0.65, aa * 1.5, contours);
  float motif = lines * 0.42 + (0.5 + 0.5 * sin(p.x * 0.45)) * 0.10;` +
      FOOTER,
  },
};

function shaderColor(value: string): number[] | undefined {
  const color = readColor(value);
  if (!color) return undefined;
  return [
    ...color.rgb.map((channel) => Math.max(0, Math.min(1, channel / 255))),
    Math.max(0, Math.min(1, color.alpha)),
  ];
}

/** Palette inputs retain alpha; the resulting editable shader is an ordinary native fill. */
export function createRecipeBackgroundPaint(
  packId: StylePackId,
  base: string,
  accent: string,
): ShaderPaint | undefined {
  const ink = shaderColor(base);
  const accentColor = shaderColor(accent);
  if (!ink || !accentColor) return undefined;
  const background = BACKGROUNDS[packId];
  return createShaderPaint({
    name: background.name,
    fragmentSource: background.source,
    parameters: { ink, accent: accentColor, strength: 0.18, speed: 1 },
  });
}

function recipeBackgroundPack(paint: ShaderPaint): StylePackId | undefined {
  return (Object.keys(BACKGROUNDS) as StylePackId[]).find(
    (packId) => paint.fragmentSource === BACKGROUNDS[packId].source,
  );
}

/** Recognize only unedited built-in sources; authored replacements keep their own behavior. */
export function isRecipeBackgroundPaint(value: unknown): value is ShaderPaint {
  return isShaderPaint(value) && recipeBackgroundPack(value) !== undefined;
}

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const intersects = (left: string, right: string) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

function backgroundColorField(
  layer: Layer,
  fields: FieldDefinition[],
  property: string,
): FieldDefinition | undefined {
  const binding = layer.bindings.find((binding) => binding.targetProperty === property);
  return fields.find((field) => field.id === binding?.fieldId);
}

/** Never replace an ordinary user field, a detached default edit, or a component field override. */
function colorFieldIsInherited(
  composition: Composition,
  layer: Layer,
  fields: FieldDefinition[],
  property: string,
  tokenId: string,
): boolean {
  const field = backgroundColorField(layer, fields, property);
  if (!field) return true;
  const generated = field.generatedShaderParameter;
  if (!generated || field.type !== 'color') return false;
  if (field.defaultTokenId && field.defaultTokenId !== tokenId) return false;
  const link = layer.componentLink;
  const sourceId = Object.entries(link?.fieldIds ?? {}).find(([, id]) => id === field.id)?.[0];
  if (link && sourceId) {
    const controlled = ['/defaultValue', '/defaultTokenId', '/generatedShaderParameter/value'];
    for (const sibling of composition.layers) {
      if (sibling.componentLink?.instanceId !== link.instanceId) continue;
      if (
        sibling.componentLink.fieldOverridePaths?.[sourceId]?.some((override) =>
          controlled.some((path) => intersects(override, path)),
        )
      )
        return false;
    }
    const baseline = link.fieldBaselines?.[sourceId];
    if (baseline && !sameValue(field.defaultTokenId, baseline.defaultTokenId)) return false;
  }
  if (field.defaultTokenId === tokenId) return true;
  const color =
    typeof field.defaultValue === 'string' ? shaderColor(field.defaultValue) : undefined;
  return color !== undefined && sameValue(color, generated.value);
}

/** Keep generated defaults and inheritance snapshots in step with the native paint uniform. */
function syncBackgroundColorField(
  composition: Composition,
  layer: Layer,
  fields: FieldDefinition[],
  property: string,
  tokenId: string,
  allowed?: ReadonlySet<string>,
): void {
  const field = backgroundColorField(layer, fields, property);
  const paint = layer.element.type === 'rectangle' ? layer.element.fill : undefined;
  if (!field?.generatedShaderParameter || !isShaderPaint(paint)) return;
  const name = property.slice('fill.parameters.'.length);
  const color = paint.parameters?.[name];
  if (!Array.isArray(color)) return;
  const link = layer.componentLink;
  const selectedOnly = allowed && link && !allowed.has(link.sourceLayerId);
  field.defaultValue = shaderColorToHex(color);
  field.generatedShaderParameter.value = [...color];
  if (selectedOnly) delete field.defaultTokenId;
  else field.defaultTokenId = tokenId;
  const sourceId = Object.entries(link?.fieldIds ?? {}).find(([, id]) => id === field.id)?.[0];
  if (!link || !sourceId) return;
  for (const sibling of composition.layers) {
    const siblingLink = sibling.componentLink;
    if (siblingLink?.instanceId !== link.instanceId) continue;
    if (selectedOnly) {
      siblingLink.fieldOverridePaths ??= {};
      siblingLink.fieldOverridePaths[sourceId] = [
        ...new Set([
          ...(siblingLink.fieldOverridePaths[sourceId] ?? []),
          '/defaultValue',
          '/defaultTokenId',
          '/generatedShaderParameter/value',
        ]),
      ];
      continue;
    }
    const baseline = siblingLink.fieldBaselines?.[sourceId];
    if (!baseline) continue;
    baseline.defaultValue = field.defaultValue;
    baseline.defaultTokenId = tokenId;
    if (baseline.generatedShaderParameter) baseline.generatedShaderParameter.value = [...color];
  }
}

/** Convert only the recipe's default solid panel; custom gradient/media/shader paints stay intact. */
export function finishRecipeBackground(composition: Composition, panel: Layer): boolean {
  if (panel.element.type !== 'rectangle' || typeof panel.element.fill !== 'string') return false;
  const fillBinding = panel.designTokenBindings.find(
    (binding) => binding.targetProperty === 'fill',
  );
  // Explicit recipe-theme colors deliberately detach this link before finishing.
  if (!fillBinding) return false;
  const tokens = composition.designSystem.tokens;
  const packId = tokens.find((token) => token.key === 'brand.pack.id')?.value;
  if (typeof packId !== 'string' || !Object.hasOwn(BACKGROUNDS, packId)) return false;
  const accent = tokens.find((token) => token.key === 'brand.color.accent');
  const paint = createRecipeBackgroundPaint(
    packId as StylePackId,
    panel.element.fill,
    typeof accent?.value === 'string' ? accent.value : '#31b7d4',
  );
  if (!paint) return false;
  panel.element.fill = paint;
  panel.designTokenBindings = panel.designTokenBindings.filter(
    (binding) => binding.targetProperty !== 'fill',
  );
  const inkBinding: DesignTokenBinding = { ...fillBinding, targetProperty: 'fill.parameters.ink' };
  const inkToken = tokens.find((token) => token.id === inkBinding.tokenId);
  if (inkToken) applyDesignTokenBinding(panel, inkBinding, inkToken);
  panel.designTokenBindings.push(inkBinding);
  if (accent) {
    const binding: DesignTokenBinding = {
      tokenId: accent.id,
      targetProperty: 'fill.parameters.accent',
    };
    // Use the same parameter validation and color normalization as authored Brand Kit links.
    applyDesignTokenBinding(panel, binding, accent);
    panel.designTokenBindings.push(binding);
  }
  if (composition.designSystem.stylePackColors)
    composition.designSystem.stylePackColors = composition.designSystem.stylePackColors
      .map((link) => ({
        ...link,
        targets: link.targets.filter(
          (target) => target.layerId !== panel.id || target.property !== 'fill',
        ),
      }))
      .filter((link) => link.targets.length > 0);
  // Create linked generated controls before component capture, so portable sources include
  // the same palette defaults as their scene instances from the beginning.
  syncShaderParameterFields(composition, panel);
  for (const binding of panel.designTokenBindings)
    if (['fill.parameters.ink', 'fill.parameters.accent'].includes(binding.targetProperty))
      syncBackgroundColorField(
        composition,
        panel,
        composition.dataFields,
        binding.targetProperty,
        binding.tokenId,
      );
  return true;
}

/** A kit change swaps its untouched built-in motif while retaining colors and local controls. */
export function syncRecipeBackgroundStyle(
  composition: Composition,
  packId: StylePackId,
  allowed?: ReadonlySet<string>,
): string[] {
  const affected: string[] = [];
  for (const { layer, fields } of [
    ...composition.layers.map((layer) => ({ layer, fields: composition.dataFields })),
    ...composition.components.flatMap((component) =>
      component.layers.map((layer) => ({ layer, fields: component.dataFields })),
    ),
  ]) {
    if (allowed && !allowed.has(layer.id)) continue;
    if (layer.element.type !== 'rectangle' || !isShaderPaint(layer.element.fill)) continue;
    const paint = layer.element.fill;
    const current = recipeBackgroundPack(paint);
    if (!current) continue;
    const baseline = layer.componentLink?.baseline;
    const baselinePaint =
      baseline?.element.type === 'rectangle' && isShaderPaint(baseline.element.fill)
        ? baseline.element.fill
        : undefined;
    const overrides = layer.componentLink?.overridePaths ?? [];
    const overridesPath = (path: string) =>
      overrides.some(
        (override) =>
          override === path || path.startsWith(`${override}/`) || override.startsWith(`${path}/`),
      );
    type Property = 'fragmentSource' | 'name' | 'ink' | 'accent';
    const propertyPath = (property: Property) =>
      `/element/fill/${
        property === 'ink' || property === 'accent' ? `parameters/${property}` : property
      }`;
    const value = (source: ShaderPaint, property: Property) =>
      property === 'ink' || property === 'accent'
        ? source.parameters?.[property]
        : source[property];
    const inherited = (property: Property) => {
      return (
        !overridesPath(propertyPath(property)) &&
        (!baseline ||
          (baselinePaint &&
            JSON.stringify(value(paint, property)) ===
              JSON.stringify(value(baselinePaint, property))))
      );
    };
    const advanceBaseline = (property: Property) => {
      if (layer.element.type !== 'rectangle') return;
      const updated = layer.element.fill;
      if (!isShaderPaint(updated)) return;
      const link = layer.componentLink;
      if (allowed && link && !allowed.has(link.sourceLayerId)) {
        // A selected instance can receive a different kit without editing its asset. Keep
        // this deliberate local change through reconciliation against the unchanged source.
        const path = propertyPath(property);
        if (
          (!baselinePaint ||
            JSON.stringify(value(updated, property)) !==
              JSON.stringify(value(baselinePaint, property))) &&
          !link.overridePaths?.includes(path)
        )
          link.overridePaths = [...(link.overridePaths ?? []), path];
        return;
      }
      if (!baselinePaint) return;
      if (property === 'ink' || property === 'accent') {
        const parameter = updated.parameters?.[property];
        baselinePaint.parameters = {
          ...baselinePaint.parameters,
          [property]: Array.isArray(parameter) ? [...parameter] : parameter!,
        };
      } else if (property === 'fragmentSource')
        baselinePaint.fragmentSource = updated.fragmentSource;
      else if (updated.name === undefined) delete baselinePaint.name;
      else baselinePaint.name = updated.name;
    };
    let changed = current !== packId && inherited('fragmentSource');
    if (changed) {
      // Change the source before parameter updates, which replace the element immutably.
      if (paint.name === BACKGROUNDS[current].name && inherited('name')) {
        paint.name = BACKGROUNDS[packId].name;
        advanceBaseline('name');
      }
      paint.fragmentSource = BACKGROUNDS[packId].source;
      advanceBaseline('fragmentSource');
    }
    for (const binding of layer.designTokenBindings) {
      if (
        binding.overridden ||
        !['fill.parameters.ink', 'fill.parameters.accent'].includes(binding.targetProperty) ||
        !inherited(binding.targetProperty === 'fill.parameters.ink' ? 'ink' : 'accent') ||
        !colorFieldIsInherited(composition, layer, fields, binding.targetProperty, binding.tokenId)
      )
        continue;
      const token = composition.designSystem.tokens.find((token) => token.id === binding.tokenId);
      if (token) {
        applyDesignTokenBinding(layer, binding, token);
        // A kit edit is a new inherited default, not a local override. Advancing only the
        // previously inherited field keeps reconcileComponentInstances from inventing one.
        advanceBaseline(binding.targetProperty === 'fill.parameters.ink' ? 'ink' : 'accent');
        syncBackgroundColorField(
          composition,
          layer,
          fields,
          binding.targetProperty,
          binding.tokenId,
          allowed,
        );
        changed = true;
      }
    }
    if (changed) affected.push(layer.id);
  }
  return affected;
}
