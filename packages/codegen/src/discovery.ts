import type {
  CompiledTransitionLogicDescriptor,
  OGrafDiscoveryCatalog,
  OGrafManifest,
} from '@ograf-editor/ograf-types';
import { coordinatedSharedTimerActions, coordinatedTemplateActions } from './coordinatedActions';
import { publicPatchDataSchema } from './compileDataSchema';

export type DiscoveryStateSchemas = Record<string, Record<string, Record<string, unknown>>>;
const EMPTY_LIST = [] as const;

/** Use the final packaged descriptor and the same public forms used by the exported controls. */
export function buildPackageDiscoveryCatalog(
  descriptor: CompiledTransitionLogicDescriptor,
  manifest: OGrafManifest,
  stateSchemas: DiscoveryStateSchemas,
): OGrafDiscoveryCatalog {
  const patchProperties = manifest.customActions?.find((action) => action.id === 'transition.patch')
    ?.schema?.properties as Record<string, Record<string, unknown>> | undefined;
  const patchData = patchProperties?.data ?? {};
  const templates = new Map(descriptor.templates.map((template) => [template.id, template]));
  const layoutWhen = new Map<string, Set<string>>();
  for (const rule of descriptor.definition.layoutRules ?? EMPTY_LIST) {
    if (!rule.sharedOffsets.some((offset) => Number.isFinite(offset.value) && offset.value !== 0))
      continue;
    const dependencies = layoutWhen.get(rule.slotId) ?? new Set<string>();
    dependencies.add(rule.whenSlotId);
    layoutWhen.set(rule.slotId, dependencies);
  }
  return structuredClone({
    version: 1,
    id: descriptor.id,
    name: descriptor.name || manifest.name,
    templates: descriptor.templates.map(({ id, name }) => ({ id, name: name || id })),
    slots: descriptor.definition.slots.map((slot) => ({
      id: slot.id,
      name: slot.name || slot.id,
      stateIds: descriptor.definition.states
        .filter((state) => state.slotId === slot.id)
        .map((state) => state.id),
      requireOn: slot.admission?.requireOnSlotIds ?? [],
      blockWhileActive: slot.admission?.blockWhileActiveSlotIds ?? [],
      ...(layoutWhen.has(slot.id) ? { layoutWhen: [...layoutWhen.get(slot.id)!] } : {}),
    })),
    states: descriptor.definition.states.map((state) => {
      const schema = stateSchemas[state.slotId]?.[state.id];
      if (
        !schema ||
        !schema.default ||
        typeof schema.default !== 'object' ||
        Array.isArray(schema.default)
      )
        throw new Error(`Missing public discovery defaults for state "${state.id}".`);
      const template = templates.get(state.templateId);
      if (!template) throw new Error(`Missing discovery template "${state.templateId}".`);
      // These public defaults already apply the runtime's shallow state-preset replacement.
      const defaults = schema.default as Record<string, unknown>;
      return {
        id: state.id,
        name: state.name || state.id,
        slotId: state.slotId,
        templateId: state.templateId,
        schema: { ...patchData, ...publicPatchDataSchema(schema), default: defaults },
        defaults,
        actions: [
          ...coordinatedTemplateActions(descriptor, template, state.slotId),
          ...coordinatedSharedTimerActions(descriptor, [template], state.slotId),
        ].map((action) => ({
          id: action.id,
          name: action.name || action.id,
        })),
      };
    }),
    actions: manifest.customActions ?? [],
    defaults: (manifest.schema?.default ?? {}) as Record<string, unknown>,
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left))
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(right)
  )
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}

/** Run inside export certification against the actual imported module, before lifecycle checks. */
export function discoveryModuleErrors(
  manifest: OGrafManifest,
  graphic: unknown,
  stateSchemas?: DiscoveryStateSchemas,
): string[] {
  const discovery = manifest.v_ografDiscovery;
  if (!discovery) return [];
  const exported = graphic as {
    prototype?: { getPlayoutSnapshot?: unknown; subscribePlayout?: unknown };
    transitionDescriptor?: CompiledTransitionLogicDescriptor;
  };
  const coordinated =
    typeof exported?.prototype?.getPlayoutSnapshot === 'function' &&
    typeof exported?.prototype?.subscribePlayout === 'function';
  if (discovery.kind === 'graphic')
    return coordinated || exported?.transitionDescriptor != null
      ? [
          'v_ografDiscovery declares an ordinary graphic but main exports coordinated package capabilities.',
        ]
      : [];
  if (!coordinated || !exported?.transitionDescriptor || !stateSchemas)
    return [
      'v_ografDiscovery declares a package but its coordinated methods, descriptor or public state schemas are missing.',
    ];
  try {
    const catalog = buildPackageDiscoveryCatalog(
      exported.transitionDescriptor,
      manifest,
      stateSchemas,
    );
    return sameJson(discovery.catalog, catalog)
      ? []
      : ['v_ografDiscovery catalog does not match the exported coordinated package.'];
  } catch (error) {
    return [
      `v_ografDiscovery catalog could not be verified: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}
