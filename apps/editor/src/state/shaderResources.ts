import {
  getElementShaderPaint,
  getElementShaderPaints,
  inspectShaderElement,
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
} from '@ograf-editor/scene-model';

/** Persist only identity when opening a resource editor; resolve the current paint before writing. */
export interface ShaderUsageTarget {
  compositionId: string;
  layerId: string;
  slot: ShaderPaintSlot;
  componentId?: string;
}

export interface StoredShaderResourceTarget {
  shaderId: string;
}
export type ShaderResourceTarget = ShaderUsageTarget | StoredShaderResourceTarget;

export function isStoredShaderResourceTarget(
  target: ShaderResourceTarget,
): target is StoredShaderResourceTarget {
  return 'shaderId' in target;
}

/** Drop display metadata when retaining or transferring a resource identity. */
export function shaderResourceTarget(target: ShaderResourceTarget): ShaderResourceTarget {
  return isStoredShaderResourceTarget(target)
    ? { shaderId: target.shaderId }
    : {
        compositionId: target.compositionId,
        layerId: target.layerId,
        slot: target.slot,
        ...(target.componentId === undefined ? {} : { componentId: target.componentId }),
      };
}

export type ShaderResourcePatch = Partial<Omit<ShaderPaint, 'type'>>;

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
  return JSON.stringify([
    target.compositionId,
    target.componentId ?? null,
    target.layerId,
    target.slot,
  ]);
}

/** Saved project shaders shown in Resources. Applied object paints are edited in Properties. */
export function collectStoredShaderResources(project: Project): ShaderResourceUsage[] {
  return (project.shaders ?? []).map((resource) => ({
    shaderId: resource.id,
    key: shaderResourceKey({ shaderId: resource.id }),
    label:
      (typeof resource.paint.name === 'string' ? resource.paint.name.trim() : '') ||
      'Project shader',
    usageLabel: 'Project shader',
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
        layers.flatMap((layer) =>
          getElementShaderPaints(layer.element).map(({ slot, paint }) => {
            const target: ShaderResourceTarget = {
              compositionId: composition.id,
              layerId: layer.id,
              slot,
              ...(component ? { componentId: component.id } : {}),
            };
            const usageLabel = `${layer.name} · ${slot === 'stroke' ? 'Outline' : 'Fill'}`;
            return {
              ...target,
              key: shaderResourceKey(target),
              label: (typeof paint.name === 'string' ? paint.name.trim() : '') || usageLabel,
              usageLabel,
              paint,
              locked: layer.isLocked,
              compositionName: composition.name,
              ...(component ? { componentName: component.name } : {}),
            };
          }),
        );
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
  target: ShaderUsageTarget,
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
  if (target.slot !== 'fill' && target.slot !== 'stroke')
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
  const paint = getElementShaderPaint(layer.element, target.slot);
  if (!paint) throw new Error('This object no longer uses a shader in the selected paint slot.');
  return { scope: 'usage', composition, component, layer, paint };
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
  options: { channel0Provided?: boolean } = {},
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
    ...(inputImage
      ? { inputImage: inputImageChanged ? structuredClone(inputImage) : inputImage }
      : {}),
  };
  const inspection = inspectShaderElement(next, options);
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
