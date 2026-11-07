import {
  getElementShaderPaint,
  getElementShaderPaints,
  getEffectStack,
  effectEnabled,
  inspectShaderElement,
  inspectShaderResourcePaint,
  inspectShaderSource,
  normalizeShaderParameterValue,
  type ComponentDefinition,
  type Composition,
  type Layer,
  type Project,
  type ShaderPaint,
  type ShaderPaintSlot,
  type ShaderParameterValue,
  type ShaderResource,
  type TickerItem,
  isShaderPaint,
} from '@ograf-editor/scene-model';

/** Persist only identity when opening a resource editor; resolve the current paint before writing. */
export interface ShaderUsageTarget {
  compositionId: string;
  layerId: string;
  slot: ShaderPaintSlot;
  componentId?: string;
  itemId?: string;
  tickerBackground?: true;
}
export interface ShaderEffectUsageTarget extends Omit<ShaderUsageTarget, 'slot'> {
  slot: 'effect';
  effectId: string;
}
export type AppliedShaderResourceTarget = ShaderUsageTarget | ShaderEffectUsageTarget;

export interface StoredShaderResourceTarget {
  shaderId: string;
}
export type ShaderResourceTarget = AppliedShaderResourceTarget | StoredShaderResourceTarget;

export function isStoredShaderResourceTarget(
  target: ShaderResourceTarget,
): target is StoredShaderResourceTarget {
  return 'shaderId' in target;
}

/** Drop display metadata when retaining or transferring a resource identity. */
export function shaderResourceTarget(target: ShaderResourceTarget): ShaderResourceTarget {
  if (isStoredShaderResourceTarget(target)) return { shaderId: target.shaderId };
  const identity = {
    compositionId: target.compositionId,
    layerId: target.layerId,
    ...(target.componentId === undefined ? {} : { componentId: target.componentId }),
    ...(target.itemId === undefined ? {} : { itemId: target.itemId }),
    ...(target.tickerBackground ? { tickerBackground: true as const } : {}),
  };
  return target.slot === 'effect'
    ? { ...identity, slot: 'effect', effectId: target.effectId }
    : { ...identity, slot: target.slot };
}

export type ShaderResourcePatch = Partial<Omit<ShaderPaint, 'type' | 'packProvenance'>>;

export type ShaderResourceUsage = ShaderResourceTarget & {
  key: string;
  label: string;
  usageLabel: string;
  paint: ShaderPaint;
  locked: boolean;
  compositionName: string;
  componentName?: string;
};

export function shaderResourceKey(target: ShaderResourceTarget): string {
  if (isStoredShaderResourceTarget(target)) return JSON.stringify(['library', target.shaderId]);
  const identity = [target.compositionId, target.componentId ?? null, target.layerId, target.slot];
  if (target.itemId) identity.push('ticker-item', target.itemId);
  if (target.tickerBackground) identity.push('ticker-background');
  if (target.slot === 'effect') identity.push(target.effectId);
  return JSON.stringify(identity);
}

/** An effect-only shader needs the preceding stack image rather than a stored image input. */
export function shaderResourceIsEffectOnly(paint: ShaderPaint): boolean {
  return (
    !inspectShaderElement(paint).valid &&
    inspectShaderElement(paint, { channel0Provided: true }).valid
  );
}

// Inert 8×8 checkerboard, used only to show effect-only resources outside a layer stack.
const EFFECT_PREVIEW_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIUlEQVR4nGM4e/bsfxDW1dUFY3Q+A0EFuCRgfMIKBoEbAAsHnYFFmaZlAAAAAElFTkSuQmCC';

/** Never persist the preview texture: saved shaders reserve iChannel0 for their future stack. */
export function shaderResourcePreviewPaint(paint: ShaderPaint): ShaderPaint {
  if (!shaderResourceIsEffectOnly(paint)) return paint;
  return {
    ...structuredClone(paint),
    inputImage: {
      source: EFFECT_PREVIEW_IMAGE,
      name: 'Preview checkerboard — not applied',
      wrap: 'repeat',
      filter: 'nearest',
    },
  };
}

/** Saved project library shaders, independent of their applied copies. */
export function collectStoredShaderResources(project: Project): ShaderResourceUsage[] {
  return (project.shaders ?? []).map((resource) => ({
    shaderId: resource.id,
    key: shaderResourceKey({ shaderId: resource.id }),
    label:
      (typeof resource.paint.name === 'string' ? resource.paint.name.trim() : '') ||
      'Project shader',
    usageLabel: shaderResourceIsEffectOnly(resource.paint) ? 'Effect shader' : 'Project shader',
    compositionName: 'Project library',
    paint: resource.paint,
    locked: false,
  }));
}

/** Each usage is independent, even when two objects use identical GLSL or share a source layer ID. */
export function collectShaderResources(project: Project): ShaderResourceUsage[] {
  return [
    ...collectStoredShaderResources(project),
    ...project.compositions.flatMap((composition) => {
      const collect = (layers: Layer[], component?: ComponentDefinition) =>
        layers.flatMap((layer) => {
          const usage = (
            target: AppliedShaderResourceTarget,
            paint: ShaderPaint,
            usageLabel: string,
          ) => ({
            ...target,
            key: shaderResourceKey(target),
            label: (typeof paint.name === 'string' ? paint.name.trim() : '') || usageLabel,
            usageLabel,
            paint,
            locked: layer.isLocked,
            compositionName: composition.name,
            ...(component ? { componentName: component.name } : {}),
          });
          const scope = {
            compositionId: composition.id,
            layerId: layer.id,
            ...(component ? { componentId: component.id } : {}),
          };
          const paints = getElementShaderPaints(layer.element).map(({ slot, paint }) => {
            const target: ShaderResourceTarget = {
              ...scope,
              slot,
            };
            const usageLabel = `${layer.name} · ${slot === 'stroke' ? 'Outline' : 'Fill'}`;
            return usage(target, paint, usageLabel);
          });
          const effects = getEffectStack(layer.effects).flatMap((effect) => {
            if (effect.type !== 'shader' || !effect.shader) return [];
            const target: ShaderEffectUsageTarget = {
              ...scope,
              slot: 'effect',
              effectId: effect.id,
            };
            const usageLabel = `${layer.name} · Effect: ${effect.name}${effectEnabled(effect, layer.effects) ? '' : ' (Bypassed)'}`;
            return [usage(target, effect.shader, usageLabel)];
          });
          const nested =
            layer.element.type === 'ticker'
              ? layer.element.items.flatMap((item) => {
                  const itemScope = { ...scope, itemId: item.id };
                  const label = `${layer.name} · ${item.name ?? item.id}`;
                  const itemPaints = getElementShaderPaints(item.element).map(({ slot, paint }) =>
                    usage(
                      { ...itemScope, slot },
                      paint,
                      `${label} · ${slot === 'stroke' ? 'Outline' : 'Fill'}`,
                    ),
                  );
                  const itemEffects = item.effects
                    ? getEffectStack(item.effects).flatMap((effect) =>
                        effect.type === 'shader' && effect.shader
                          ? [
                              usage(
                                { ...itemScope, slot: 'effect', effectId: effect.id },
                                effect.shader,
                                `${label} · Effect: ${effect.name}${effectEnabled(effect, item.effects!) ? '' : ' (Bypassed)'}`,
                              ),
                            ]
                          : [],
                      )
                    : [];
                  return [...itemPaints, ...itemEffects];
                })
              : [];
          const background =
            layer.element.type === 'ticker' && isShaderPaint(layer.element.background)
              ? [
                  usage(
                    { ...scope, slot: 'fill', tickerBackground: true },
                    layer.element.background,
                    `${layer.name} · Background`,
                  ),
                ]
              : [];
          return [...paints, ...effects, ...nested, ...background];
        });
      return [
        ...collect(composition.layers),
        ...composition.components.flatMap((component) => collect(component.layers, component)),
      ];
    }),
  ];
}

export function defaultShaderResourceName(project: Project): string {
  const names = new Set(
    collectShaderResources(project).map((resource) => resource.label.toLowerCase()),
  );
  let index = 1;
  let name = 'New Shader';
  while (names.has(name.toLowerCase())) {
    index += 1;
    name = `New Shader ${index}`;
  }
  return name;
}

interface ResolvedShaderUsage {
  scope: 'usage';
  composition: Composition;
  component?: ComponentDefinition;
  layer: Layer;
  paint: ShaderPaint;
  item?: TickerItem;
}
interface ResolvedStoredShader {
  scope: 'library';
  resource: ShaderResource;
  paint: ShaderPaint;
}

/** Read-only lookup; callers decide whether viewing a locked resource is useful. */
export function resolveShaderResource(
  project: Project,
  target: StoredShaderResourceTarget,
): ResolvedStoredShader;
export function resolveShaderResource(
  project: Project,
  target: AppliedShaderResourceTarget,
): ResolvedShaderUsage;
export function resolveShaderResource(
  project: Project,
  target: ShaderResourceTarget,
): ResolvedShaderUsage | ResolvedStoredShader;
export function resolveShaderResource(
  project: Project,
  target: ShaderResourceTarget,
): ResolvedShaderUsage | ResolvedStoredShader {
  if (isStoredShaderResourceTarget(target)) {
    const resource = project.shaders?.find((item) => item.id === target.shaderId);
    if (!resource) throw new Error('The project shader resource no longer exists.');
    return { scope: 'library', resource, paint: resource.paint };
  }
  if (target.slot !== 'fill' && target.slot !== 'stroke' && target.slot !== 'effect')
    throw new Error('Unknown shader paint slot.');
  const composition = project.compositions.find((item) => item.id === target.compositionId);
  if (!composition) throw new Error('The shader resource composition no longer exists.');
  const component =
    target.componentId === undefined
      ? undefined
      : composition.components.find((item) => item.id === target.componentId);
  if (target.componentId !== undefined && !component)
    throw new Error('The saved shader component no longer exists.');
  const layer = (component?.layers ?? composition.layers).find(
    (item) => item.id === target.layerId,
  );
  if (!layer) throw new Error('The shader resource object no longer exists.');
  if (target.itemId && target.tickerBackground)
    throw new Error('Choose a ticker item or background.');
  const item =
    target.itemId && layer.element.type === 'ticker'
      ? layer.element.items.find((candidate) => candidate.id === target.itemId)
      : undefined;
  if (target.itemId && !item) throw new Error('The ticker item no longer exists.');
  if (target.tickerBackground) {
    if (
      target.slot !== 'fill' ||
      layer.element.type !== 'ticker' ||
      !isShaderPaint(layer.element.background)
    )
      throw new Error('The ticker no longer uses a background shader.');
    return { scope: 'usage', composition, component, layer, paint: layer.element.background };
  }
  const paint =
    target.slot === 'effect'
      ? (item
          ? item.effects
            ? getEffectStack(item.effects)
            : []
          : getEffectStack(layer.effects)
        ).find((effect) => effect.id === target.effectId && effect.type === 'shader')?.shader
      : getElementShaderPaint(item?.element ?? layer.element, target.slot);
  if (!paint) throw new Error('This object no longer uses a shader in the selected paint slot.');
  return { scope: 'usage', composition, component, layer, paint, ...(item ? { item } : {}) };
}

/** Preserve compatible controls using the latest values, dropping removed or retyped symbols. */
export function preserveShaderParameterValues(
  previous: ShaderPaint,
  nextSource: string,
): Record<string, ShaderParameterValue> {
  const next = inspectShaderSource(nextSource);
  if (!next.valid) throw new Error(next.errors.join('\n'));
  const before = new Map(
    inspectShaderSource(previous.fragmentSource).parameters.map((definition) => [
      definition.name,
      definition,
    ]),
  );
  const parameters: Record<string, ShaderParameterValue> = {};
  for (const definition of next.parameters) {
    const oldDefinition = before.get(definition.name);
    if (
      oldDefinition?.glslType !== definition.glslType ||
      oldDefinition.control !== definition.control
    )
      continue;
    const value = previous.parameters?.[definition.name];
    if (value === undefined) continue;
    try {
      parameters[definition.name] = normalizeShaderParameterValue(definition, value);
    } catch {
      // A newly compatible source can repair a stale malformed value using its own default.
    }
  }
  return parameters;
}

/** Merge a minimal edit into the latest paint; never replace unrelated values from a dialog snapshot. */
export function shaderPaintWithPatch(
  current: ShaderPaint,
  patch: ShaderResourcePatch,
  options: { channel0Provided?: boolean; libraryResource?: boolean } = {},
): ShaderPaint {
  if ('type' in patch) throw new Error('A shader resource edit cannot change its paint type.');
  for (const key of Object.keys(patch)) {
    if (
      !['name', 'fragmentSource', 'speed', 'resolutionScale', 'parameters', 'inputImage'].includes(
        key,
      )
    )
      throw new Error(`Unknown shader resource property: ${key}.`);
  }
  if (
    patch.parameters !== undefined &&
    (!patch.parameters || typeof patch.parameters !== 'object' || Array.isArray(patch.parameters))
  )
    throw new Error('Shader parameter edits must be an object keyed by exposed name.');
  const source = patch.fragmentSource ?? current.fragmentSource;
  const parameters =
    source !== current.fragmentSource
      ? preserveShaderParameterValues(current, source)
      : Object.fromEntries(
          Object.entries(current.parameters ?? {}).map(([name, value]) => [
            name,
            Array.isArray(value) ? [...value] : value,
          ]),
        );
  for (const [name, value] of Object.entries(patch.parameters ?? {}))
    parameters[name] = Array.isArray(value) ? [...value] : value;
  const suppliedName = patch.name !== undefined ? patch.name : current.name;
  if (suppliedName !== undefined && typeof suppliedName !== 'string')
    throw new Error('Shader name must be a string.');
  const name = suppliedName?.trim();
  const inputImage = Object.prototype.hasOwnProperty.call(patch, 'inputImage')
    ? patch.inputImage
    : current.inputImage;
  const inputImageChanged = Object.prototype.hasOwnProperty.call(patch, 'inputImage');
  const next: ShaderPaint = {
    type: 'shader',
    ...(name ? { name } : {}),
    fragmentSource: source,
    speed: patch.speed ?? current.speed,
    resolutionScale: patch.resolutionScale ?? current.resolutionScale,
    parameters,
    ...(current.packProvenance
      ? {
          packProvenance: {
            ...current.packProvenance,
            reference: { ...current.packProvenance.reference },
          },
        }
      : {}),
    ...(inputImage
      ? { inputImage: inputImageChanged ? structuredClone(inputImage) : inputImage }
      : {}),
  };
  const inspection = options.libraryResource
    ? inspectShaderResourcePaint(next)
    : inspectShaderElement(next, options);
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  return next;
}

/** Build a save delta against the opening snapshot, so untouched current values are retained. */
export function shaderResourcePatchBetween(
  baseline: ShaderPaint,
  draft: ShaderPaint,
): ShaderResourcePatch {
  const patch: ShaderResourcePatch = {};
  for (const key of ['fragmentSource', 'speed', 'resolutionScale'] as const) {
    if (draft[key] !== baseline[key]) Object.assign(patch, { [key]: draft[key] });
  }
  const draftName = draft.name?.trim() ?? '';
  if (draftName !== (baseline.name?.trim() ?? '')) patch.name = draftName;
  if (JSON.stringify(draft.inputImage) !== JSON.stringify(baseline.inputImage))
    patch.inputImage = draft.inputImage ? structuredClone(draft.inputImage) : undefined;

  const inspection = inspectShaderSource(draft.fragmentSource);
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  const preserved =
    draft.fragmentSource === baseline.fragmentSource
      ? baseline.parameters
      : preserveShaderParameterValues(baseline, draft.fragmentSource);
  const parameters: Record<string, ShaderParameterValue> = {};
  for (const definition of inspection.parameters) {
    const before = preserved?.[definition.name] ?? definition.defaultValue;
    const after = draft.parameters?.[definition.name] ?? definition.defaultValue;
    // A raw source draft may still carry its opening values before adaptation. Those values
    // are not explicit edits, even if a declaration changed type or narrowed its range.
    if (
      draft.fragmentSource !== baseline.fragmentSource &&
      draft.parameters?.[definition.name] !== undefined &&
      JSON.stringify(draft.parameters[definition.name]) ===
        JSON.stringify(baseline.parameters?.[definition.name])
    )
      continue;
    if (JSON.stringify(before) !== JSON.stringify(after))
      parameters[definition.name] = Array.isArray(after) ? [...after] : after;
  }
  if (Object.keys(parameters).length) patch.parameters = parameters;
  return patch;
}
