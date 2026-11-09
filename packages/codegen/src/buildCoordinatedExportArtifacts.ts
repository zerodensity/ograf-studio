import {
  OGRAF_MANIFEST_SCHEMA_URL,
  type CompiledGraphicDescriptor,
  type CompiledTransitionLogicDescriptor,
  type OGrafManifest,
} from '@ograf-editor/ograf-types';
import {
  compositionWithShaderParameterFields,
  compositionPlayoutActionErrors,
  clockTimerActionId,
  parseClockTimerActionId,
  createComposition,
  createFieldDefinition,
  createProject,
  isMediaPaint,
  elementAssetReferences,
  isElementImageSourceBinding,
  transitionLogicErrors,
  safeTransitionLogicStartupStates,
  type ComponentDefinition,
  type ClockTimerCommand,
  type Composition,
  type LayerVisualRule,
  type Project,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { validateManifest, validateProject } from '@ograf-editor/validation';
import { buildNodosInputContract } from './nodosInputs';
import { assembleManifest } from './assembleManifest';
import { manifestAuthoringPrompts } from './manifestAuthoringPrompts';
import {
  EXPORTED_RESOURCE_URLS_KEY,
  packageDescriptorResources,
  validatePackageLayout,
  type ExportArtifacts,
} from './buildExportArtifacts';
import { compileDataSchema, fieldValueForExport, publicDataForExport } from './compileDataSchema';
import { compileDescriptor } from './compileDescriptor';
import { compileTransitionContentAnimations } from './compileTransitionContentAnimations';
import { projectForExportProfile, type ExportProfile } from './exportProfiles';
import { STUDIO_RUNTIME_NOTICE } from './runtimeLicenses';
import {
  tickerFeedResourceRuntimeSource,
  tickerFeedResourceValues,
  TICKER_FEED_RESOURCE_PATH,
} from './tickerFeedResources';

/** Portable input. Callers resolve inherited set defaults before compiling. */
export interface CoordinatedExportInput {
  id: string;
  name: string;
  definition: TransitionLogicDefinition;
  templates: Array<{ id: string; name: string; project: Project }>;
  componentAssets: ComponentDefinition[];
}

type PackagedComposition = ReturnType<typeof packageDescriptorResources>;

interface DataResourcePaths {
  templates: Record<string, string[][]>;
  shared: Record<string, string[][]>;
}

function dataResourcePaths(packaged: PackagedComposition): string[][] {
  const paths: string[][] = [];
  function fieldPaths(field: Composition['dataFields'][number], path: string[]): void {
    if (field.type === 'image-url') paths.push(path);
    else if (field.type === 'object')
      for (const child of field.properties) fieldPaths(child, [...path, child.key]);
    else if (field.type === 'array' && field.items) fieldPaths(field.items, path);
  }
  for (const field of packaged.composition.dataFields) fieldPaths(field, [field.key]);
  for (const layer of [
    ...packaged.descriptor.layers,
    ...(packaged.descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
  ])
    if (layer.element.type === 'image' || layer.element.type === 'ticker')
      for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : []))
        if (
          layer.element.type === 'ticker' &&
          binding.targetProperty === 'items' &&
          !binding.valueMap
        )
          paths.push([binding.dataKey, ...(binding.sourcePath ?? []), TICKER_FEED_RESOURCE_PATH]);
        else if (
          isElementImageSourceBinding(layer.element, binding.targetProperty) &&
          !binding.valueMap
        )
          paths.push([binding.dataKey, ...(binding.sourcePath ?? [])]);
  return [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()];
}

function resourceValues(packaged: PackagedComposition): string[] {
  const values: string[] = [];
  const descriptor = packaged.descriptor;
  for (const layer of [
    ...descriptor.layers,
    ...(descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
  ]) {
    const element = layer.element;
    values.push(...elementAssetReferences(element));
    if ((element.type === 'image' || element.type === 'audio') && element.src)
      values.push(element.src);
    if (element.type === 'image-sequence') values.push(...element.frames);
    const fill = 'fill' in element ? element.fill : undefined;
    if (isMediaPaint(fill))
      values.push(fill.source.kind === 'clip' ? fill.source.src : (fill.source.fallback ?? ''));
    if (element.type === 'image' || element.type === 'ticker')
      for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : []))
        if (element.type === 'ticker' && binding.targetProperty === 'items')
          values.push(...Object.values(binding.valueMap ?? {}).flatMap(tickerFeedResourceValues));
        else if (isElementImageSourceBinding(element, binding.targetProperty))
          values.push(
            ...Object.values(binding.valueMap ?? {}).filter(
              (value): value is string => typeof value === 'string',
            ),
          );
  }
  values.push(...(descriptor.fonts ?? []).map((font) => font.source));
  values.push(
    ...(descriptor.rendererPlugins ?? []).flatMap((plugin) =>
      plugin.moduleUrl ? [plugin.moduleUrl] : [],
    ),
  );
  const defaults = dataDefaults(packaged.composition);
  function collect(value: unknown, path: string[]): void {
    if (path.length === 1 && path[0] === TICKER_FEED_RESOURCE_PATH)
      values.push(...tickerFeedResourceValues(value));
    else if (Array.isArray(value)) for (const item of value) collect(item, path);
    else if (!path.length && typeof value === 'string') values.push(value);
    else if (value && typeof value === 'object' && path.length)
      collect((value as Record<string, unknown>)[path[0]!], path.slice(1));
  }
  for (const path of dataResourcePaths(packaged)) collect(defaults, path);
  return [...new Set(values.filter(Boolean))];
}

function dataDefaults(composition: Composition): Record<string, unknown> {
  return Object.fromEntries(
    compositionWithShaderParameterFields(composition).dataFields.map((field) => [
      field.key,
      fieldValueForExport(field, field.defaultValue),
    ]),
  );
}

function publicStateDataSchema(
  state: { templateId: string; dataDefaults?: Record<string, unknown> },
  templates: Map<string, PackagedComposition>,
): Record<string, unknown> {
  const composition = templates.get(state.templateId)!.composition;
  return {
    ...compileDataSchema(composition),
    default: publicDataForExport(composition, {
      ...dataDefaults(composition),
      ...state.dataDefaults,
    }),
    additionalProperties: false,
  };
}

/** A patch form must not fill omitted fields from the template's authored defaults. */
function publicStatePatchSchema(
  state: { templateId: string },
  templates: Map<string, PackagedComposition>,
): Record<string, unknown> {
  const schema = publicStateDataSchema(state, templates);
  const stripDefaults = (node: Record<string, unknown>) => {
    delete node.default;
    if (node.properties && typeof node.properties === 'object')
      for (const child of Object.values(node.properties))
        if (child && typeof child === 'object') stripDefaults(child as Record<string, unknown>);
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items))
      stripDefaults(node.items as Record<string, unknown>);
    for (const key of ['allOf', 'anyOf', 'oneOf'])
      if (Array.isArray(node[key]))
        for (const child of node[key])
          if (child && typeof child === 'object') stripDefaults(child as Record<string, unknown>);
  };
  stripDefaults(schema);
  delete schema.required;
  return { ...schema, default: {} };
}

/**
 * The template placement each shared instance drives: the one under its own instance ID, else the
 * template's first unclaimed placement of its component (editor-added elements get fresh IDs).
 * Matches how template-derived element values are read.
 */
function sharedPlacements(
  composition: {
    layers: Array<{
      isGuide: boolean;
      componentLink: { instanceId: string; componentId: string } | null;
    }>;
  },
  definition: {
    sharedInstances: Array<{ id: string; componentAssetId: string; slotId?: string }>;
    states: Array<{ templateId: string; slotId: string }>;
  },
  templateId: string,
): Map<string, string> {
  const links = composition.layers.flatMap((layer) =>
    layer.componentLink && !layer.isGuide ? [layer.componentLink] : [],
  );
  const slotIds = new Set(
    definition.states
      .filter((state) => state.templateId === templateId)
      .map((state) => state.slotId),
  );
  const placements = new Map<string, string>();
  const claimed = new Set<string>();
  for (const instance of definition.sharedInstances)
    if (
      links.some(
        (link) => link.instanceId === instance.id && link.componentId === instance.componentAssetId,
      )
    ) {
      placements.set(instance.id, instance.id);
      claimed.add(instance.id);
    }
  for (const instance of definition.sharedInstances) {
    if (placements.has(instance.id) || (instance.slotId && !slotIds.has(instance.slotId))) continue;
    const first = links.find(
      (link) => link.componentId === instance.componentAssetId && !claimed.has(link.instanceId),
    );
    if (!first) continue;
    placements.set(instance.id, first.instanceId);
    claimed.add(first.instanceId);
  }
  return placements;
}

/** Gate only side effects which the shared coordinator cannot execute yet. */
export function coordinatedVisualRuleIssues(rule: LayerVisualRule): string[] {
  const issues: string[] = [];
  for (const action of rule.actions) {
    if (
      action.type !== 'property' &&
      action.type !== 'visibility' &&
      action.type !== 'toggle-visibility' &&
      action.type !== 'set-data' &&
      action.type !== 'custom-action' &&
      action.type !== 'playout'
    )
      issues.push(`uses unsupported ${action.type} actions`);
  }
  return [...new Set(issues)];
}

/** Coordinated lifecycle playback uses the first on-air Step; reject unsupported later-step actions. */
function coordinatedCompositionErrors(composition: Composition): string[] {
  const errors: string[] = [];
  if (composition.functions?.length)
    errors.push('Functions require standalone real-time export and cannot be coordinated yet.');
  const hold = composition.keyframes.find((key) => key.role === 'step')?.id;
  if (composition.mediaCues.length)
    errors.push('Media cues require standalone template playout and cannot be coordinated yet.');
  for (const layer of composition.layers.filter((candidate) => !candidate.isGuide)) {
    const prefix = `Layer "${layer.name}": `;
    if (layer.element.type === 'audio') errors.push(`${prefix}audio playout is not supported.`);
    if (layer.element.type === 'chart' && !layer.element.provider)
      errors.push(`${prefix}select a pinned chart renderer provider before exporting.`);
    if (layer.loop?.activation.type === 'customAction')
      errors.push(`${prefix}custom-action loop activation is not supported.`);
    if (layer.loop?.activation.type === 'step' && layer.loop.activation.stepKeyframeId !== hold)
      errors.push(
        `${prefix}loops must activate at the first on-air step or for the whole lifecycle.`,
      );
    for (const rule of layer.visualRules ?? []) {
      if (!rule.enabled) continue;
      if (rule.trigger === 'step' && rule.eventId && rule.eventId !== hold)
        errors.push(
          `${prefix}rule "${rule.name}" targets a later template step; coordinated playout supports the first on-air step only.`,
        );
      for (const issue of coordinatedVisualRuleIssues(rule))
        errors.push(`${prefix}rule "${rule.name}" ${issue}.`);
    }
  }
  return errors;
}

function ruleExecutionSignature(rule: LayerVisualRule): string {
  const { id: _id, name: _name, ...behavior } = rule;
  return JSON.stringify(behavior, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
        )
      : value,
  );
}

function sharedComposition(
  asset: ComponentDefinition,
  instance: TransitionLogicDefinition['sharedInstances'][number],
  reference: Composition,
): Composition {
  const context = asset.context;
  return createComposition({
    id: `shared-${instance.id}`,
    name: instance.name,
    width: reference.width,
    height: reference.height,
    ...(reference.crop ? { crop: structuredClone(reference.crop) } : {}),
    frameRate: reference.frameRate,
    backgroundColor: 'transparent',
    layers: structuredClone(asset.layers),
    dataFields: structuredClone(asset.dataFields),
    assets: structuredClone(asset.resources ?? []),
    patterns: structuredClone(asset.patterns ?? []),
    ...(context
      ? {
          keyframes: structuredClone(context.keyframes),
          transitions: structuredClone(context.transitions),
          customActions: structuredClone(context.customActions),
          mediaCues: structuredClone(context.mediaCues ?? []),
          rendererPlugins: structuredClone(context.rendererPlugins ?? []),
          ...(context.designSystem ? { designSystem: structuredClone(context.designSystem) } : {}),
        }
      : {
          // Stable lifecycle identities keep repeated exports byte-stable for context-free assets.
          keyframes: [
            { id: 'shared-start', name: 'Start', role: 'start' as const },
            { id: 'shared-hold', name: 'On air', role: 'step' as const },
            { id: 'shared-end', name: 'End', role: 'end' as const },
          ],
          transitions: [
            {
              id: 'shared-in',
              fromKeyframeId: 'shared-start',
              toKeyframeId: 'shared-hold',
              durationFrames: 0,
              easing: 'linear' as const,
            },
            {
              id: 'shared-out',
              fromKeyframeId: 'shared-hold',
              toKeyframeId: 'shared-end',
              durationFrames: 0,
              easing: 'linear' as const,
            },
          ],
        }),
  });
}

/**
 * A retained component keeps its canonical geometry, animation and rules, but an authored
 * placement can add, remove or redirect its data bindings. Compile those binding profiles into
 * one descriptor: private fields activate only the selected placement's ordered bindings. The
 * runtime skips absent fields and replaces each data snapshot, so one profile cannot leak into
 * the next, including a placement which intentionally removed all bindings.
 */
function sharedBindingProfiles(
  shared: PackagedComposition,
  instance: TransitionLogicDefinition['sharedInstances'][number],
  definition: TransitionLogicDefinition,
  templates: Map<string, Composition>,
  packagedTemplates: Map<string, PackagedComposition>,
  errors: string[],
): Map<string, Record<string, string>> {
  const placements = [...templates].flatMap(([templateId, template]) => {
    const placement = sharedPlacements(template, definition, templateId).get(instance.id);
    return placement
      ? [
          {
            templateId,
            template,
            layers: template.layers.filter(
              (layer) =>
                !layer.isGuide &&
                layer.componentLink?.instanceId === placement &&
                layer.componentLink.componentId === instance.componentAssetId,
            ),
          },
        ]
      : [];
  });
  const templateFields = new Map<string, Record<string, string>>();
  const fieldKeys = new Set(shared.composition.dataFields.map((field) => field.key));
  let fieldIndex = 0;
  for (const source of shared.composition.layers) {
    const profiles = placements.flatMap((placement) => {
      const layer = placement.layers.find(
        (candidate) => candidate.componentLink?.sourceLayerId === source.id,
      );
      return layer ? [{ ...placement, layer }] : [];
    });
    const differs = profiles.some(({ layer }) => {
      const canonicalIds = new Map(
        Object.entries(layer.componentLink?.fieldIds ?? {}).map(([canonical, local]) => [
          local,
          canonical,
        ]),
      );
      const normalized = layer.bindings.map((binding) => ({
        ...binding,
        fieldId: canonicalIds.get(binding.fieldId) ?? binding.fieldId,
      }));
      return JSON.stringify(normalized) !== JSON.stringify(source.bindings);
    });
    if (!differs) continue;
    const compiledSource = shared.descriptor.layers.find((layer) => layer.id === source.id);
    if (!compiledSource) continue;
    // Copy compiled bindings after ordinary authoring validation and resource packaging. This
    // preserves local source paths/maps and their resource URLs without relaxing the designer's
    // one-binding-per-target contract or re-running shader-field synthesis on a transport union.
    compiledSource.bindings = profiles.flatMap(({ templateId, template, layer }) => {
      const compiled = packagedTemplates
        .get(templateId)
        ?.descriptor.layers.find((candidate) => candidate.id === layer.id);
      if (!compiled) {
        errors.push(
          `Shared component "${instance.name}", template "${template.name}", layer "${layer.name}": binding profile has no compiled source.`,
        );
        return [];
      }
      return compiled.bindings.map((binding) => {
        let key: string;
        do key = `__ograf_shared_binding_${++fieldIndex}`;
        while (fieldKeys.has(key));
        fieldKeys.add(key);
        let fields = templateFields.get(templateId);
        if (!fields) templateFields.set(templateId, (fields = {}));
        fields[key] = binding.dataKey;
        return { ...structuredClone(binding), dataKey: key };
      });
    });
  }
  return templateFields;
}

function controlSchema(
  definition: TransitionLogicDefinition,
  templates: Map<string, PackagedComposition>,
  defaults: NonNullable<CompiledTransitionLogicDescriptor['dataDefaults']>,
  errors: string[],
): Record<string, unknown> {
  const publicDefaults = {
    slots: Object.fromEntries(
      Object.entries(defaults.slots).map(([id, value]) => {
        const state =
          definition.states.find((state) => state.id === value.stateId) ??
          definition.states.find((state) => state.slotId === id);
        return [
          id,
          {
            ...value,
            stateId: value.stateId ?? '',
            data: state
              ? publicDataForExport(templates.get(state.templateId)!.composition, value.data)
              : value.data,
          },
        ];
      }),
    ),
  };
  function mergeSchema(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    label: string,
  ): Record<string, unknown> {
    if (JSON.stringify(left) === JSON.stringify(right)) return left;
    if (left.type !== right.type) {
      errors.push(
        `${label} has incompatible data field types across states (${String(left.type)} / ${String(right.type)}). Use distinct public field keys for different types.`,
      );
      return left;
    }
    const merged: Record<string, unknown> = {
      type: left.type,
      ...(left.title ? { title: left.title } : {}),
      ...(left.default !== undefined ? { default: left.default } : {}),
      ...(left.gddType === right.gddType && left.gddType ? { gddType: left.gddType } : {}),
      // GDD color types require their pattern on this object, even when anyOf
      // carries the individual templates' full schemas and shader ownership.
      ...(left.pattern === right.pattern && left.pattern ? { pattern: left.pattern } : {}),
      anyOf: [...(Array.isArray(left.anyOf) ? left.anyOf : [left]), right],
    };
    if (left.type === 'object') {
      const properties = {
        ...(left.properties as Record<string, Record<string, unknown>>),
      };
      for (const [key, property] of Object.entries(
        (right.properties as Record<string, Record<string, unknown>>) ?? {},
      ))
        properties[key] = properties[key]
          ? mergeSchema(properties[key]!, property, `${label}.${key}`)
          : property;
      merged.properties = properties;
    } else if (left.type === 'array') {
      merged.items = mergeSchema(
        left.items as Record<string, unknown>,
        right.items as Record<string, unknown>,
        `${label}[]`,
      );
    }
    if (Array.isArray(left.enum) && Array.isArray(right.enum))
      merged.enum = [...new Set([...left.enum, ...right.enum])];
    if (left.gddOptions || right.gddOptions)
      merged.gddOptions = {
        ...((left.gddOptions ?? {}) as Record<string, unknown>),
        ...((right.gddOptions ?? {}) as Record<string, unknown>),
        labels: {
          ...(left.gddOptions as { labels?: Record<string, string> })?.labels,
          ...(right.gddOptions as { labels?: Record<string, string> })?.labels,
        },
      };
    return merged;
  }
  const slots = Object.fromEntries(
    definition.slots.map((slot) => {
      const states = definition.states.filter((state) => state.slotId === slot.id);
      const stateExposure = states.some((state) =>
        packagedTemplatesHaveExposure(templates.get(state.templateId)!),
      );
      const properties: Record<string, unknown> = {};
      for (const state of states) {
        const schema = compileDataSchema(templates.get(state.templateId)!.composition);
        for (const [key, property] of Object.entries(schema.properties)) {
          if (properties[key] === undefined) properties[key] = property;
          else
            properties[key] = mergeSchema(
              properties[key] as Record<string, unknown>,
              property as unknown as Record<string, unknown>,
              `Slot "${slot.name}", field "${key}"`,
            );
        }
      }
      // Exposure-sensitive keys belong to the selected state's conditional schema. Keeping
      // their union defaults here would reintroduce a hidden value from another template.
      if (stateExposure)
        for (const state of states)
          for (const key of Object.keys(
            templates.get(state.templateId)!.descriptor.dataExposure ?? {},
          ))
            delete properties[key];
      return [
        slot.id,
        {
          type: 'object',
          title: slot.name,
          default: publicDefaults.slots[slot.id],
          properties: {
            stateId: {
              type: 'string',
              title: 'State',
              enum: ['', ...states.map((state) => state.id)],
              default: publicDefaults.slots[slot.id]!.stateId,
              gddType: 'select',
              gddOptions: {
                labels: Object.fromEntries([
                  ['', 'Off'],
                  ...states.map((state) => [state.id, state.name]),
                ]),
              },
            },
            data: {
              type: 'object',
              title: 'Template data',
              properties,
              default: publicDefaults.slots[slot.id]!.data,
            },
          },
          ...(stateExposure
            ? {
                allOf: states.map((state) => ({
                  type: 'object',
                  properties: {},
                  if: {
                    type: 'object',
                    properties: { stateId: { type: 'string', const: state.id } },
                    required: ['stateId'],
                  },
                  // oxlint-disable-next-line unicorn/no-thenable -- Standard JSON Schema conditional keyword.
                  then: {
                    type: 'object',
                    properties: { data: publicStateDataSchema(state, templates) },
                  },
                })),
              }
            : {}),
          additionalProperties: false,
        },
      ];
    }),
  );
  return {
    type: 'object',
    properties: {
      slots: {
        type: 'object',
        title: 'Playout slots',
        properties: slots,
        default: publicDefaults.slots,
        additionalProperties: false,
      },
    },
    default: publicDefaults,
    additionalProperties: false,
  };
}

function packagedTemplatesHaveExposure(template: PackagedComposition): boolean {
  return !!template.descriptor.dataExposure;
}

interface LaneCommandTargets {
  slotId: string;
  name: string;
  targets: Array<{ id: string; label: string }>;
}

/** Match the template/shared mounts the coordinator actually dispatches these commands to. */
function coordinatedCommandTargets(descriptor: CompiledTransitionLogicDescriptor): {
  actions: LaneCommandTargets[];
  loops: LaneCommandTargets[];
} {
  const actions: LaneCommandTargets[] = [];
  const loops: LaneCommandTargets[] = [];
  const layersFor = (graphic: CompiledGraphicDescriptor) => [
    ...graphic.layers,
    ...(graphic.collections ?? []).flatMap((collection) =>
      collection.capacity > 0 ? collection.prototypeLayers : [],
    ),
  ];
  const executableTimer = (
    layer: ReturnType<typeof layersFor>[number] | undefined,
    command: ClockTimerCommand,
  ) =>
    layer?.element.type === 'text' &&
    !!layer.element.clock &&
    layer.element.clock.mode !== 'clock' &&
    (layer.element.clock.source === 'automatic' || command === 'reset' || command === 'restart');
  for (const slot of [...descriptor.definition.slots].sort((a, b) => a.order - b.order)) {
    const actionLabels = new Map<string, Set<string>>();
    const loopLabels = new Map<string, Set<string>>();
    const sharedTimerAliases = new Map<string, Set<string>>();
    const add = (labels: Map<string, Set<string>>, id: string, label: string) =>
      labels.set(id, new Set([...(labels.get(id) ?? []), label]));
    const templates = descriptor.definition.states
      .filter((state) => state.slotId === slot.id)
      .map((state) => ({
        state,
        template: descriptor.templates.find((template) => template.id === state.templateId)!,
      }));
    for (const { state, template } of templates) {
      const layers = layersFor(template.descriptor);
      for (const action of template.descriptor.customActions) {
        const clock = parseClockTimerActionId(action.id);
        if (clock) {
          const sharedLink = template.sharedLayers.find((link) => link.layerId === clock.layerId);
          const instance =
            sharedLink &&
            descriptor.definition.sharedInstances.find(
              (candidate) => candidate.id === sharedLink.instanceId,
            );
          if (instance?.slotId && instance.slotId !== slot.id) continue;
          const layer = sharedLink
            ? layersFor(
                descriptor.sharedInstances.find((shared) => shared.id === sharedLink.instanceId)!
                  .descriptor,
              ).find((candidate) => candidate.id === sharedLink.sourceLayerId)
            : layers.find((candidate) => candidate.id === clock.layerId);
          // Manual Reset/Restart rearm alarms without changing the external value. Start/Pause
          // cannot advance an external feed. Resolve shared proxies to their retained source.
          if (!executableTimer(layer, clock.command)) continue;
          if (sharedLink) {
            const key = JSON.stringify([
              sharedLink.instanceId,
              sharedLink.sourceLayerId,
              clock.command,
            ]);
            sharedTimerAliases.set(
              key,
              new Set([...(sharedTimerAliases.get(key) ?? []), template.id]),
            );
          }
        }
        add(actionLabels, action.id, `${state.name} / ${action.name}`);
      }
      const hidden = new Set(template.sharedLayers.map((layer) => layer.layerId));
      for (const layer of layers)
        if (!hidden.has(layer.id) && layer.loop?.timing)
          add(loopLabels, layer.loop.timing.groupId, `${state.name} / ${layer.loop.name}`);
    }
    for (const instance of descriptor.definition.sharedInstances) {
      const relatedTemplates = templates.filter(
        ({ template }) =>
          (!instance.slotId || instance.slotId === slot.id) &&
          (template.sharedLayers.some((link) => link.instanceId === instance.id) ||
            template.sharedDataBindings.some((link) => link.instanceId === instance.id)),
      );
      if (!relatedTemplates.length) continue;
      const shared = descriptor.sharedInstances.find((shared) => shared.id === instance.id)!;
      const layers = layersFor(shared.descriptor);
      for (const action of shared.descriptor.customActions) {
        const clock = parseClockTimerActionId(action.id);
        if (
          clock &&
          executableTimer(
            layers.find((layer) => layer.id === clock.layerId),
            clock.command,
          ) &&
          relatedTemplates.some(
            ({ template }) =>
              !sharedTimerAliases
                .get(JSON.stringify([instance.id, clock.layerId, clock.command]))
                ?.has(template.id),
          )
        )
          add(
            actionLabels,
            clockTimerActionId(JSON.stringify([instance.id, clock.layerId]), clock.command),
            `${instance.name} / ${action.name}`,
          );
      }
      for (const layer of layers)
        if (layer.loop?.timing)
          add(loopLabels, layer.loop.timing.groupId, `${instance.name} / ${layer.loop.name}`);
    }
    const targetList = (labels: Map<string, Set<string>>): LaneCommandTargets => ({
      slotId: slot.id,
      name: slot.name,
      targets: [...labels].map(([id, names]) => ({ id, label: [...names].join(' · ') })),
    });
    if (actionLabels.size) actions.push(targetList(actionLabels));
    if (loopLabels.size) loops.push(targetList(loopLabels));
  }
  return { actions, loops };
}

function laneCommandSchema(
  lanes: LaneCommandTargets[],
  field: 'actionId' | 'groupId',
  title: string,
  withData = false,
): Record<string, unknown> {
  const first = lanes[0]!;
  const targetSelect = (targets: LaneCommandTargets['targets']) => ({
    type: 'string',
    title,
    enum: [...new Set(targets.map((target) => target.id))],
    default: targets[0]!.id,
    gddType: 'select',
    gddOptions: { labels: Object.fromEntries(targets.map((target) => [target.id, target.label])) },
  });
  return {
    type: 'object',
    properties: {
      slotId: {
        type: 'string',
        title: 'Lane',
        enum: lanes.map((lane) => lane.slotId),
        default: first.slotId,
        gddType: 'select',
        gddOptions: { labels: Object.fromEntries(lanes.map((lane) => [lane.slotId, lane.name])) },
      },
      [field]: targetSelect(lanes.flatMap((lane) => lane.targets)),
      ...(withData ? { data: { type: 'object', properties: {}, additionalProperties: true } } : {}),
    },
    allOf: lanes.map((lane) => ({
      type: 'object',
      properties: {},
      if: {
        type: 'object',
        properties: { slotId: { type: 'string', const: lane.slotId } },
        required: ['slotId'],
      },
      // oxlint-disable-next-line unicorn/no-thenable -- Standard JSON Schema conditional keyword.
      then: { type: 'object', properties: { [field]: targetSelect(lane.targets) } },
    })),
    required: ['slotId', field],
    additionalProperties: false,
  };
}

function operatorReadme(
  descriptor: CompiledTransitionLogicDescriptor,
  commands: ReturnType<typeof coordinatedCommandTargets>,
  publicDefaults?: unknown,
): string {
  const lines = [
    `# ${descriptor.name} — coordinated OGraf graphic`,
    '',
    'This package contains one manifest and one controller for all template states. Load the manifest in an OGraf renderer; do not instantiate its internal templates independently.',
    '',
    `Output: ${descriptor.width} × ${descriptor.height}, ${descriptor.frameRate} fps.`,
    '',
    '## Slots and states',
    '',
  ];
  for (const slot of descriptor.definition.slots) {
    lines.push(`### ${slot.name} (${JSON.stringify(slot.id)})`, '');
    if (slot.admission?.requireOnSlotIds?.length)
      lines.push(
        `- Take requires these lanes fully On: ${slot.admission.requireOnSlotIds.map((id) => JSON.stringify(id)).join(', ')}.`,
      );
    if (slot.admission?.blockWhileActiveSlotIds?.length)
      lines.push(
        `- Take is blocked until these lanes are fully Off: ${slot.admission.blockWhileActiveSlotIds.map((id) => JSON.stringify(id)).join(', ')}.`,
      );
    for (const state of descriptor.definition.states.filter((item) => item.slotId === slot.id))
      lines.push(
        `- ${state.name}: stateId ${JSON.stringify(state.id)}; templateId ${JSON.stringify(state.templateId)}.`,
      );
    lines.push('- Off: stateId "" (an empty string).', '');
  }
  const orderedStates = [...descriptor.definition.slots]
    .sort((left, right) => left.order - right.order)
    .flatMap((slot) => descriptor.definition.states.filter((state) => state.slotId === slot.id));
  const first =
    orderedStates.find(
      (state) => descriptor.dataDefaults?.slots[state.slotId]?.stateId === state.id,
    ) ?? orderedStates[0];
  const slotId = first?.slotId ?? descriptor.definition.slots[0]?.id;
  const stateId = first?.id ?? null;
  const publishedDefaults = publicDefaults as
    { slots?: Record<string, { data?: Record<string, unknown> }> } | undefined;
  // Operator examples may only use the published contract. An absent public
  // default is empty data, never a reason to copy internal template values.
  const data = publishedDefaults?.slots?.[slotId ?? '']?.data ?? {};
  lines.push(
    '## Data and lifecycle',
    '',
    'load prepares resources and stores selections without taking content on air. playAction takes the selected states; stopAction takes every slot out through its authored routes. updateAction updates the selected slot data and transitions on-air slots. Omitted slots retain their selection. Set stateId to an empty string ("") to take a slot out.',
    '',
    'This graphic has one on-air Step. Use playAction({goto:0}) to apply or reapply all selected lanes. A plain playAction({}) advances standard Step navigation: the first Play enters, and another Play after the single on-air Step advances Out. Use stopAction for an explicit Out.',
    '',
    'Whole-graphic Play preflights the complete selected batch before changing output. It prepares all incoming resources, waits for outgoing lanes and their exit barriers, then enters required parents before their dependents; independent lanes may enter together. Conflicting selections or preparation failures reject the batch while preserving working output. skipAnimation skips motion, not preparation or admission checks. Direct custom Take still requires its parent lanes to be fully On; it does not activate them automatically.',
    '',
    'Each new state starts with its template defaults plus its named state preset. Explicit operator data and retained edits for that state take precedence. Provide per-slot data using the following structure:',
    '',
    '```json',
    JSON.stringify({ slots: { [slotId ?? '']: { stateId, data } } }, null, 2),
    '```',
    '',
    '## Custom actions',
    '',
    'Take or update one slot:',
    '',
    '```json',
    JSON.stringify({ id: 'transition.take', payload: { slotId, stateId, data } }, null, 2),
    '```',
    '',
    'Patch live data on the existing on-air instance without a template transition or ticker restart. Omit stateId (or use an empty string) to address the current state; a nonempty stateId is a guard. Off/leaving lanes reject the patch. Normal field bindings, data Rules and configured item/text update effects still apply:',
    '',
    '```json',
    JSON.stringify({ id: 'transition.patch', payload: { slotId, stateId, data: {} } }, null, 2),
    '```',
    '',
    'Take one slot out through its authored route:',
    '',
    '```json',
    JSON.stringify({ id: 'transition.out', payload: { slotId } }, null, 2),
    '```',
    '',
    'Immediately clear one slot (omit slotId to clear all slots):',
    '',
    '```json',
    JSON.stringify({ id: 'transition.clear', payload: { slotId } }, null, 2),
    '```',
    '',
    ...(commands.actions.length
      ? [
          'Run an authored custom action or timer command after taking its matching template on air. The exported controls list the available actions for each lane. Its Rules, Text FX and automatic count-up/count-down timers use the coordinator clock:',
          '',
          '```json',
          JSON.stringify(
            {
              id: 'template.action',
              payload: {
                slotId: commands.actions[0]!.slotId,
                actionId: commands.actions[0]!.targets[0]!.id,
              },
            },
            null,
            2,
          ),
          '```',
          '',
        ]
      : []),
    ...(commands.loops.length
      ? [
          'Control an authored timed loop after taking its matching template on air. Use loop.resume or loop.next with the same lane and group to resume or advance it:',
          '',
          '```json',
          JSON.stringify(
            {
              id: 'loop.pause',
              payload: {
                slotId: commands.loops[0]!.slotId,
                groupId: commands.loops[0]!.targets[0]!.id,
              },
            },
            null,
            2,
          ),
          '```',
          '',
        ]
      : []),
    'Action and loop choices include the available targets across each lane’s template states. Take the matching state on air before sending a command. Commands without any supported targets are omitted from this package’s controls.',
    '',
    'A new request waits for resource readiness. When a transition is running, the latest pending request follows it. Shared component instances persist across template changes.',
    '',
    'Take conditions are enforced before preparation and checked again before entry. Require On lanes must have finished entering; blocking lanes include preparation and their complete exit. A rejected Take does not change occupancy and is not queued for later revival. Establish any required lanes explicitly before taking a dependent. Take out with remains a separate Out/Clear dependency.',
    '',
    '## Animation and rendering',
    '',
    'The coordinator owns transition timing and plays authored per-layer IN and OUT tracks around the first on-air Step. Shaders, Text FX, clocks, masks, effects, data bindings and independent loops remain active. Loop groups support a data-controlled hold and pause/resume/next commands. Rules can run Take, Update, Out and Clear against lanes, respecting timing and dependencies. Template custom actions can trigger Rules and Text FX. Local data-writing actions and animated rule properties run on the shared frame clock, including delayed actions and deterministic replay. Template-specific later-step playback, audio/media cues, timeline/shader clips and custom-action loop activation remain unsupported; export refuses these actions.',
    '',
    'Automatic count-up/count-down timers expose their existing clock:<encoded layer ID>:start, :pause, :reset and :restart actions through template.action. Start continues from the current value; Pause holds it; Reset returns to the initial value and stops; Restart returns to the initial value and runs. Manual count-up/count-down timers expose Reset and Restart to rearm alarms without changing the bound value; Start and Pause are omitted because only external updates advance the feed. Commands reach retained shared timers and every live runtime-collection row without restarting unrelated timers. System clocks keep reading their time source and are omitted from timer controls.',
    '',
    'For non-real-time output, setActionsSchedule records OGraf actions with millisecond timestamps and goToTime evaluates the complete schedule deterministically. Send image/media URLs as absolute URLs or package-relative resource paths from this archive; paths are resolved against main.js, including nested data fields and scheduled actions.',
    '',
    '## Default selections',
    '',
    'Initial controls choose the first compatible state in stable lane order. Lanes requiring another lane On start Off, and conflicting or takeover states stay Off instead of displacing an earlier selection. Data-field defaults remain available while a lane is Off. Custom Take form suggestions are separate: they offer a valid state for the chosen lane even when that lane starts Off; choosing one does not change the initial whole-graphic selection.',
    '',
    '```json',
    JSON.stringify(
      publicDefaults ?? {
        slots: Object.fromEntries(
          Object.entries(descriptor.dataDefaults?.slots ?? {}).map(([id, slot]) => [
            id,
            { ...slot, stateId: slot.stateId ?? '' },
          ]),
        ),
      },
      null,
      2,
    ),
    '```',
    '',
  );
  return lines.join('\n');
}

/** One resource-aware entry module, including nested controls and scheduled/custom payloads. */
export function generateCoordinatedMainJs(
  descriptor: CompiledTransitionLogicDescriptor,
  runtimeSource: string,
  resourcePaths: readonly string[],
  dataPaths: DataResourcePaths = { templates: {}, shared: {} },
): string {
  return `${STUDIO_RUNTIME_NOTICE}
${runtimeSource}
const exportedModuleBaseUrl = import.meta.url;
const exportedResourcePaths = new Set(${JSON.stringify(resourcePaths)});
function exportedResourceValue(value) {
  if (typeof value === 'string' && exportedResourcePaths.has(value)) {
    if (exportedModuleBaseUrl.startsWith('blob:')) {
      const url = globalThis[${JSON.stringify(EXPORTED_RESOURCE_URLS_KEY)}]?.[exportedModuleBaseUrl]?.[value];
      if (!url) throw new Error('Packaged resource is unavailable in the blob module: ' + value);
      return url;
    }
    // Archive entries are literal filenames, so #, ?, and % are not URL syntax.
    return new URL(value.split('/').map(encodeURIComponent).join('/'), exportedModuleBaseUrl).href;
  }
  return value;
}
${tickerFeedResourceRuntimeSource('exportedResourceValue')}
const exportedDataPaths = ${JSON.stringify(dataPaths)};
function exportedDataPath(value, path) {
  if (path.length === 1 && path[0] === ${JSON.stringify(TICKER_FEED_RESOURCE_PATH)}) return exportedTickerFeedResources(value);
  if (Array.isArray(value)) return value.map((item) => exportedDataPath(item, path));
  if (!path.length) return exportedResourceValue(value);
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, path[0])) return value;
  return { ...value, [path[0]]: exportedDataPath(value[path[0]], path.slice(1)) };
}
function exportedTemplateData(data, paths) {
  for (const path of paths ?? []) data = exportedDataPath(data, path);
  return data;
}
function exportedPrepareDescriptor(descriptor) {
  const paint = (value) => {
    if (value?.type === 'shader' && value.inputImage) value.inputImage.source = exportedResourceValue(value.inputImage.source);
    if (value?.type !== 'media') return;
    if (value.source?.kind === 'clip') value.source.src = exportedResourceValue(value.source.src);
    else if (value.source?.kind === 'live' && value.source.fallback) value.source.fallback = exportedResourceValue(value.source.fallback);
  };
  const elementResources = (element) => {
    if (element.type === 'ticker') {
      paint(element.background);
      for (const item of element.items) {
        elementResources(item.element);
        for (const effect of item.effects?.stack ?? []) paint(effect.shader);
      }
    }
    paint(element.fill);
    paint(element.strokePaint);
    if (element.type === 'shader') paint(element);
    if (element.type === 'image' || element.type === 'audio') element.src = exportedResourceValue(element.src);
    if (element.type === 'image-sequence') element.frames = element.frames.map(exportedResourceValue);
  };
  for (const layer of [...descriptor.layers, ...(descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers)]) {
    elementResources(layer.element);
    if (layer.element.type === 'ticker')
      for (const binding of layer.bindings ?? []) {
        if (binding.targetProperty === 'items' && binding.valueMap) {
          binding.valueMap = Object.fromEntries(Object.entries(binding.valueMap).map(([key, value]) => [key, exportedTickerFeedResources(value)]));
          continue;
        }
        const target = /^items\\.([^.]+)\\.src$/.exec(binding.targetProperty);
        if (target && layer.element.items.find((item) => item.id === target[1])?.element.type === 'image' && binding.valueMap)
          binding.valueMap = Object.fromEntries(Object.entries(binding.valueMap).map(([key,value]) => [key, exportedResourceValue(value)]));
      }
    paint(layer.element.fill);
    if (layer.element.type === 'image' || layer.element.type === 'audio') layer.element.src = exportedResourceValue(layer.element.src);
    if (layer.element.type === 'image-sequence') layer.element.frames = layer.element.frames.map(exportedResourceValue);
    if (layer.element.type === 'image')
      for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : []))
        if (binding.targetProperty === 'src' && binding.valueMap)
          binding.valueMap = Object.fromEntries(Object.entries(binding.valueMap).map(([key, value]) => [key, exportedResourceValue(value)]));
  }
  for (const font of descriptor.fonts ?? []) font.source = exportedResourceValue(font.source);
  for (const plugin of descriptor.rendererPlugins ?? []) if (plugin.moduleUrl) plugin.moduleUrl = exportedResourceValue(plugin.moduleUrl);
  for (const cue of descriptor.mediaCues ?? []) for (const source of cue.sources) {
    if (source.kind === 'clip') source.src = exportedResourceValue(source.src);
    else if (source.fallback) source.fallback = exportedResourceValue(source.fallback);
  }
}
const exportedTransitionDescriptor = ${JSON.stringify(descriptor)};
for (const template of exportedTransitionDescriptor.templates) {
  exportedPrepareDescriptor(template.descriptor);
  template.dataDefaults = exportedTemplateData(template.dataDefaults, exportedDataPaths.templates[template.id]);
}
for (const state of exportedTransitionDescriptor.definition.states) {
  if (state.dataDefaults) state.dataDefaults = exportedTemplateData(state.dataDefaults, exportedDataPaths.templates[state.templateId]);
}
for (const instance of exportedTransitionDescriptor.sharedInstances) {
  exportedPrepareDescriptor(instance.descriptor);
  instance.dataDefaults = exportedTemplateData(instance.dataDefaults, exportedDataPaths.shared[instance.id]);
}
for (const slot of Object.values(exportedTransitionDescriptor.dataDefaults?.slots ?? {})) {
  const templateId = exportedTransitionDescriptor.definition.states.find((state) => state.id === slot.stateId)?.templateId;
  slot.data = exportedTemplateData(slot.data, templateId === undefined ? [] : exportedDataPaths.templates[templateId]);
}
class ExportedCoordinatedGraphic extends CoordinatedGraphicElement {
  static transitionDescriptor = exportedTransitionDescriptor;
  resolveExternalTemplateData(templateId, data, current) {
    return this.filterPublicTemplateData(templateId, data, current);
  }
  resolveTemplateData(templateId, data) {
    return exportedTemplateData(data, exportedDataPaths.templates[templateId]);
  }
}
export default ExportedCoordinatedGraphic;
`;
}

/** Compile a template set into one OGraf graphic with a shared transition coordinator. */
export function buildCoordinatedExportArtifactsWithRuntime(
  input: CoordinatedExportInput,
  runtimeSource: string,
  profile?: ExportProfile,
): ExportArtifacts {
  const definition = structuredClone(input.definition);
  const assets = new Map(input.componentAssets.map((asset) => [asset.id, asset]));
  const graphErrors = transitionLogicErrors(definition, {
    templateIds: input.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      input.componentAssets.map((asset) => [
        asset.id,
        asset.layers.filter((layer) => !layer.isGuide).map((layer) => layer.id),
      ]),
    ),
  });
  if (new Set(input.templates.map((template) => template.id)).size !== input.templates.length)
    graphErrors.push('Template IDs must be unique in a coordinated package.');
  if (assets.size !== input.componentAssets.length)
    graphErrors.push('Component asset IDs must be unique in a coordinated package.');
  if (graphErrors.length) throw new Error(graphErrors.join('\n'));
  const referenced = new Set(definition.states.map((state) => state.templateId));
  const templates = input.templates.filter((template) => referenced.has(template.id));
  if (!templates.length)
    throw new Error('Coordinated export requires at least one template state.');
  const sourceCompositions = new Map(
    templates.map((template) => {
      const composition = template.project.compositions.find(
        (item) => item.id === template.project.mainCompositionId,
      );
      if (!composition) throw new Error(`Template "${template.name}" has no main composition.`);
      return [template.id, compositionWithShaderParameterFields(composition)];
    }),
  );
  const first = sourceCompositions.get(templates[0]!.id)!;
  const width = first.crop?.width ?? first.width;
  const height = first.crop?.height ?? first.height;
  const frameRate = first.frameRate;
  const baseProject = {
    ...templates[0]!.project,
    id: input.id,
    name: input.name,
    supportsRealTime: templates.every((template) => template.project.supportsRealTime),
    supportsNonRealTime: templates.every((template) => template.project.supportsNonRealTime),
  };
  const outputProject = profile ? projectForExportProfile(baseProject, profile) : baseProject;
  const projectErrors: string[] = [];
  const packagedTemplates = new Map<string, PackagedComposition>();
  const packagedShared = new Map<string, PackagedComposition>();
  const sharedBindingFields = new Map<string, Map<string, Record<string, string>>>();
  const resources = new Map<string, ExportArtifacts['resources'][number]>();
  function registerResource(resource: ExportArtifacts['resources'][number], label: string): void {
    const previous = resources.get(resource.path);
    if (
      previous &&
      (previous.data !== resource.data ||
        previous.base64 !== resource.base64 ||
        previous.mimeType !== resource.mimeType)
    )
      projectErrors.push(`${label}: packaged resources disagree at "${resource.path}".`);
    else resources.set(resource.path, resource);
  }
  const manifests: OGrafManifest[] = [];
  const fontOrigins = new Map<string, { source: string; label: string }>();
  function compile(
    composition: Composition,
    project: Project,
    namespace: string,
    label: string,
  ): PackagedComposition {
    const validationProject = {
      ...project,
      supportsRealTime: outputProject.supportsRealTime,
      supportsNonRealTime: outputProject.supportsNonRealTime,
    };
    for (const error of validateProject(validationProject).errors)
      projectErrors.push(`${label}: ${error}`);
    for (const error of coordinatedCompositionErrors(composition))
      projectErrors.push(`${label}: ${error}`);
    for (const error of compositionPlayoutActionErrors(composition, definition))
      projectErrors.push(`${label}: ${error}`);
    for (const asset of composition.assets.filter((item) => item.kind === 'font')) {
      const key = JSON.stringify([
        asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
        asset.fontWeight || '100 900',
        asset.fontStyle || 'normal',
      ]);
      const previous = fontOrigins.get(key);
      if (previous && previous.source !== asset.dataUri)
        projectErrors.push(
          `${label}: font "${asset.fontFamily || asset.name}" conflicts with the same family/style/weight in ${previous.label}. Use distinct font family names.`,
        );
      else fontOrigins.set(key, { source: asset.dataUri, label });
    }
    const packaged = packageDescriptorResources(
      composition,
      compileDescriptor(composition),
      namespace,
    );
    const availablePaths = new Set(packaged.resources.map((resource) => resource.path));
    for (const value of resourceValues(packaged))
      if (!availablePaths.has(value) && !/^(https?:|data:)/i.test(value))
        projectErrors.push(
          `${label}: resource "${value}" is not packaged or an absolute HTTP(S)/data URL. Import the resource into the template before exporting.`,
        );
    for (const resource of packaged.resources) registerResource(resource, label);
    manifests.push(assembleManifest(project, packaged.composition, packaged.descriptor));
    return packaged;
  }
  templates.forEach((template, index) => {
    const composition = sourceCompositions.get(template.id)!;
    if (
      (composition.crop?.width ?? composition.width) !== width ||
      (composition.crop?.height ?? composition.height) !== height ||
      composition.frameRate !== frameRate
    )
      projectErrors.push(
        `Template "${template.name}" must use the same output size (${width} × ${height}) and frame rate (${frameRate}) as the other states.`,
      );
    packagedTemplates.set(
      template.id,
      compile(composition, template.project, `templates/${index}`, `Template "${template.name}"`),
    );
  });
  const shared = definition.sharedInstances.map((instance, index) => {
    const asset = assets.get(instance.componentAssetId)!;
    if (asset.context && asset.context.frameRate !== frameRate)
      projectErrors.push(`Shared component "${instance.name}" must use ${frameRate} fps.`);
    const composition = compositionWithShaderParameterFields(
      sharedComposition(asset, instance, first),
    );
    const project = createProject({
      id: `${input.id}-shared-${index}`,
      name: instance.name,
      mainCompositionId: composition.id,
      compositions: [composition],
    });
    const packaged = compile(
      composition,
      project,
      `shared/${index}`,
      `Shared component "${instance.name}"`,
    );
    sharedBindingFields.set(
      instance.id,
      sharedBindingProfiles(
        packaged,
        instance,
        definition,
        sourceCompositions,
        packagedTemplates,
        projectErrors,
      ),
    );
    packagedShared.set(instance.id, packaged);
    return {
      id: instance.id,
      descriptor: packaged.descriptor,
      // Profile-private transport fields deliberately have no defaults: only the selected
      // template supplies them, so mutually exclusive binding profiles never run together.
      dataDefaults: dataDefaults(packaged.composition),
    };
  });
  // A Rules payload belongs to its owner, while its image fields belong to the selected target.
  // Keep the final archive paths global so resolveTemplateData can resolve them after selection.
  for (const [ownerId, owner] of [...packagedTemplates, ...packagedShared]) {
    for (const layer of [
      ...owner.descriptor.layers,
      ...(owner.descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
    ])
      for (const rule of layer.visualRules ?? []) {
        if (!rule.enabled) continue;
        for (const action of rule.actions) {
          if (action.type !== 'playout' || action.data === undefined) continue;
          const targetPaths = definition.states
            .filter(
              (state) =>
                state.slotId === action.slotId &&
                (action.stateId === undefined || state.id === action.stateId),
            )
            .flatMap((state) => {
              const target = packagedTemplates.get(state.templateId);
              return target ? dataResourcePaths(target) : [];
            });
          const paths = [
            ...new Map(targetPaths.map((path) => [JSON.stringify(path), path])).values(),
          ];
          const rewrite = (value: unknown, path: string[]): unknown => {
            if (Array.isArray(value)) return value.map((item) => rewrite(item, path));
            if (!path.length && typeof value === 'string') {
              const uri = owner.packageResourceUri(value);
              if (
                uri &&
                !resources.has(uri) &&
                !owner.resources.some((resource) => resource.path === uri) &&
                !/^(https?:|data:)/i.test(uri)
              )
                throw new Error(
                  `Resource "${uri}" is not packaged or an absolute HTTP(S)/data URL.`,
                );
              return uri;
            }
            if (
              !path.length ||
              !value ||
              typeof value !== 'object' ||
              !Object.hasOwn(value, path[0]!)
            )
              return value;
            const record = value as Record<string, unknown>;
            return { ...record, [path[0]!]: rewrite(record[path[0]!], path.slice(1)) };
          };
          try {
            for (const path of paths)
              action.data = rewrite(action.data, path) as typeof action.data;
          } catch (cause) {
            projectErrors.push(
              `Rules in "${ownerId}", layer "${layer.id}", rule "${rule.name}": ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          }
        }
      }
    for (const resource of owner.resources) registerResource(resource, `Rules in "${ownerId}"`);
  }
  const presetResourceValues: string[] = [];
  const presetValidationBaseline = new Map<string, Set<string>>();
  for (const state of definition.states) {
    if (!state.dataDefaults) continue;
    const owner = packagedTemplates.get(state.templateId)!;
    const source = sourceCompositions.get(state.templateId)!;
    const template = templates.find((item) => item.id === state.templateId)!;
    const fields = new Map(source.dataFields.map((field) => [field.key, field]));
    for (const field of fields.values()) {
      if (Object.hasOwn(state.dataDefaults, field.key))
        state.dataDefaults[field.key] = fieldValueForExport(
          field,
          state.dataDefaults[field.key] as import('@ograf-editor/scene-model').FieldValue,
        );
    }
    for (const key of Object.keys(state.dataDefaults))
      if (!fields.has(key))
        projectErrors.push(`State "${state.name}" preset references unknown data field "${key}".`);
    const validationProject = {
      ...template.project,
      supportsRealTime: outputProject.supportsRealTime,
      supportsNonRealTime: outputProject.supportsNonRealTime,
      compositions: template.project.compositions.map((composition) =>
        composition.id === source.id ? source : composition,
      ),
    };
    if (!presetValidationBaseline.has(template.id))
      presetValidationBaseline.set(template.id, new Set(validateProject(validationProject).errors));
    const baseline = presetValidationBaseline.get(template.id)!;
    const withPreset = {
      ...source,
      dataFields: source.dataFields.map((field) =>
        Object.hasOwn(state.dataDefaults!, field.key)
          ? { ...field, defaultValue: state.dataDefaults![field.key] as typeof field.defaultValue }
          : field,
      ),
    };
    for (const error of validateProject({
      ...validationProject,
      compositions: validationProject.compositions.map((composition) =>
        composition.id === source.id ? withPreset : composition,
      ),
    }).errors)
      if (!baseline.has(error)) projectErrors.push(`State "${state.name}" preset: ${error}`);
    const rewrite = (value: unknown, path: string[]): unknown => {
      if (Array.isArray(value)) return value.map((item) => rewrite(item, path));
      if (!path.length && typeof value === 'string') {
        const uri = owner.packageResourceUri(value);
        if (
          uri &&
          !resources.has(uri) &&
          !owner.resources.some((resource) => resource.path === uri) &&
          !/^(https?:|data:)/i.test(uri)
        )
          throw new Error(`Resource "${uri}" is not packaged or an absolute HTTP(S)/data URL.`);
        if (uri) presetResourceValues.push(uri);
        return uri;
      }
      if (!path.length || !value || typeof value !== 'object' || !Object.hasOwn(value, path[0]!))
        return value;
      const record = value as Record<string, unknown>;
      return { ...record, [path[0]!]: rewrite(record[path[0]!], path.slice(1)) };
    };
    try {
      for (const path of dataResourcePaths(owner))
        state.dataDefaults = rewrite(state.dataDefaults, path) as typeof state.dataDefaults;
    } catch (cause) {
      projectErrors.push(
        `State "${state.name}" preset: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    // A preset can be the only owner of an embedded resource; collect late additions too.
    for (const resource of owner.resources)
      registerResource(resource, `State "${state.name}" preset`);
  }
  const contentAnimations = compileTransitionContentAnimations(
    definition,
    width,
    height,
    frameRate,
  );
  const transitionDescriptor: CompiledTransitionLogicDescriptor = {
    version: 1,
    id: `${input.id}${profile?.graphicIdSuffix ?? ''}`,
    name: input.name,
    width,
    height,
    frameRate,
    definition,
    ...(contentAnimations ? { contentAnimations } : {}),
    templates: templates.map((template) => {
      const composition = sourceCompositions.get(template.id)!;
      const packaged = packagedTemplates.get(template.id)!;
      const placements = sharedPlacements(composition, definition, template.id);
      const sharedLayers = composition.layers.flatMap((layer) => {
        const link = layer.componentLink;
        const instance =
          link &&
          definition.sharedInstances.find(
            (item) =>
              item.componentAssetId === link.componentId &&
              placements.get(item.id) === link.instanceId,
          );
        if (!link || !instance || layer.isGuide) return [];
        if (
          !assets
            .get(instance.componentAssetId)
            ?.layers.some((source) => source.id === link.sourceLayerId && !source.isGuide)
        )
          projectErrors.push(
            `Template "${template.name}": shared layer "${layer.name}" has a missing canonical source.`,
          );
        if (
          composition.runtimeCollections.some((collection) =>
            collection.prototypeLayerIds.includes(layer.id),
          )
        )
          projectErrors.push(
            `Template "${template.name}": shared proxies cannot be runtime collection prototypes.`,
          );
        return [{ layerId: layer.id, instanceId: instance.id, sourceLayerId: link.sourceLayerId }];
      });
      const hiddenIds = new Set(sharedLayers.map((layer) => layer.layerId));
      for (const owner of composition.layers)
        for (const rule of owner.visualRules ?? []) {
          if (!rule.enabled) continue;
          const groupIds = [
            ...(rule.hostGroupId ? [rule.hostGroupId] : []),
            ...rule.actions.flatMap((action) =>
              'targetGroupId' in action && action.targetGroupId ? [action.targetGroupId] : [],
            ),
          ];
          if (
            !groupIds.some((groupId) =>
              composition.layers.some(
                (member) => member.groupId === groupId && hiddenIds.has(member.id),
              ),
            )
          )
            continue;
          const inherited =
            hiddenIds.has(owner.id) &&
            owner.componentLink?.baseline?.visualRules?.some(
              (baseline) =>
                baseline.id === rule.id &&
                ruleExecutionSignature(baseline) === ruleExecutionSignature(rule),
            );
          if (!inherited)
            projectErrors.push(
              `Template "${template.name}", rule "${rule.name}": template-local group rules cannot change retained shared components. Author this rule on the component asset, or select a group of template-local objects.`,
            );
        }
      const sharedDataBindings = definition.sharedInstances.flatMap((instance) => {
        const placement = placements.get(instance.id);
        if (!placement) return [];
        const link = composition.layers.find(
          (layer) =>
            layer.componentLink?.instanceId === placement &&
            layer.componentLink?.componentId === instance.componentAssetId,
        )?.componentLink;
        if (!link) return [];
        const sourceFields = packagedShared.get(instance.id)!.composition.dataFields;
        return [
          {
            instanceId: instance.id,
            fields: Object.fromEntries(
              sourceFields
                .map((field) => {
                  const generated = field.generatedShaderParameter;
                  const localLayer =
                    generated &&
                    composition.layers.find(
                      (layer) =>
                        layer.componentLink?.instanceId === placement &&
                        layer.componentLink?.componentId === instance.componentAssetId &&
                        layer.componentLink?.sourceLayerId === generated.layerId,
                    );
                  const localField =
                    composition.dataFields.find(
                      (candidate) => candidate.id === link.fieldIds?.[field.id],
                    ) ??
                    (generated && localLayer
                      ? composition.dataFields.find(
                          (candidate) =>
                            candidate.generatedShaderParameter?.layerId === localLayer.id &&
                            candidate.generatedShaderParameter.name === generated.name &&
                            (candidate.generatedShaderParameter.paintSlot ?? 'fill') ===
                              (generated.paintSlot ?? 'fill'),
                        )
                      : undefined);
                  return [field.key, localField?.key ?? field.key];
                })
                .concat(
                  Object.entries(sharedBindingFields.get(instance.id)?.get(template.id) ?? {}),
                ),
            ),
          },
        ];
      });
      return {
        id: template.id,
        name: template.name,
        descriptor: packaged.descriptor,
        dataDefaults: dataDefaults(packaged.composition),
        sharedLayers,
        sharedDataBindings,
      };
    }),
    sharedInstances: shared,
  };
  const startupStates = safeTransitionLogicStartupStates(definition);
  transitionDescriptor.dataDefaults = {
    slots: Object.fromEntries(
      definition.slots.map((slot) => {
        const startupStateId = startupStates[slot.id] ?? null;
        const state =
          definition.states.find((item) => item.id === startupStateId) ??
          definition.states.find((item) => item.slotId === slot.id);
        return [
          slot.id,
          {
            stateId: startupStateId,
            data: state
              ? structuredClone({
                  ...transitionDescriptor.templates.find(
                    (template) => template.id === state.templateId,
                  )!.dataDefaults!,
                  ...state.dataDefaults,
                })
              : {},
          },
        ];
      }),
    ),
  };
  const project = outputProject;
  if (!project.supportsRealTime && !project.supportsNonRealTime)
    projectErrors.push(
      'The referenced templates have no common render mode. Choose a coordinated export profile explicitly.',
    );
  const slotIds = definition.slots.map((slot) => slot.id);
  const stateIds = definition.states.map((state) => state.id);
  // Custom-action forms initialize from schema defaults. Keep the initial lane/template pair
  // consistent, including when a set starts with an empty lane, rather than sending empty IDs.
  const defaultState = [...definition.slots]
    .sort((a, b) => a.order - b.order)
    .flatMap((slot) => definition.states.filter((state) => state.slotId === slot.id))
    .at(0)!;
  const slotSelect = {
    type: 'string' as const,
    title: 'Lane',
    enum: slotIds,
    default: defaultState.slotId,
    gddType: 'select',
    gddOptions: {
      labels: Object.fromEntries(definition.slots.map((slot) => [slot.id, slot.name])),
    },
  };
  const stateSelect = {
    type: 'string' as const,
    title: 'Template state',
    description: 'Select a state in this lane. Off takes the lane out.',
    enum: ['', ...stateIds],
    default: defaultState.id,
    gddType: 'select',
    gddOptions: {
      labels: Object.fromEntries([
        ['', 'Off'],
        ...definition.states.map((state) => [
          state.id,
          `${definition.slots.find((slot) => slot.id === state.slotId)!.name} / ${state.name}`,
        ]),
      ]),
    },
  };
  const commands = coordinatedCommandTargets(transitionDescriptor);
  const patchStateSelect = {
    ...stateSelect,
    title: 'On-air template guard',
    description:
      'Current on-air template accepts data without switching templates. An explicit state rejects if another template is on air.',
    default: '',
    gddOptions: { labels: { ...stateSelect.gddOptions.labels, '': 'Current on-air template' } },
  };
  const authoringPrompts = manifestAuthoringPrompts(templates);
  const manifest: OGrafManifest & { v_ografTransitionLogic: { version: 1 } } = {
    $schema: OGRAF_MANIFEST_SCHEMA_URL,
    id: project.id,
    name: input.name,
    main: 'main.js',
    v_ografTransitionLogic: { version: 1 },
    ...(authoringPrompts ? { v_ografStudioAuthoringPrompts: authoringPrompts } : {}),
    version: project.version,
    supportsRealTime: project.supportsRealTime,
    supportsNonRealTime: project.supportsNonRealTime,
    ...(project.description ? { description: project.description } : {}),
    ...(project.author.name ? { author: { ...project.author } } : {}),
    stepCount: 1,
    schema: controlSchema(
      definition,
      packagedTemplates,
      transitionDescriptor.dataDefaults,
      projectErrors,
    ),
    customActions: [
      {
        id: 'transition.patch',
        name: 'Update on-air data in place',
        description:
          'Update live fields without a template transition, retake or ticker restart. Take the lane on air first; normal data Rules and configured field update effects remain active.',
        schema: {
          type: 'object',
          properties: {
            slotId: structuredClone(slotSelect),
            stateId: patchStateSelect,
            data: {
              type: 'object',
              title: 'Changed values',
              properties: {},
              default: {},
              additionalProperties: true,
            },
          },
          required: ['slotId', 'data'],
          additionalProperties: false,
          allOf: definition.slots.map((slot) => {
            const states = definition.states.filter((state) => state.slotId === slot.id);
            return {
              type: 'object',
              properties: {},
              if: {
                type: 'object',
                properties: { slotId: { type: 'string', const: slot.id } },
                required: ['slotId'],
              },
              // oxlint-disable-next-line unicorn/no-thenable -- Standard JSON Schema conditional keyword.
              then: {
                type: 'object',
                properties: {
                  stateId: {
                    ...patchStateSelect,
                    enum: ['', ...states.map((state) => state.id)],
                    gddOptions: {
                      labels: Object.fromEntries([
                        ['', 'Current on-air template'],
                        ...states.map((state) => [state.id, `${slot.name} / ${state.name}`]),
                      ]),
                    },
                  },
                },
                // An admission/dependency lane can have no template states. JSON Schema
                // requires allOf to be nonempty; its lane selector above still permits only
                // the current-template guard, and stateful lanes retain their exposure checks.
                ...(states.length
                  ? {
                      allOf: states.map((state) => {
                        const dataSchema = publicStatePatchSchema(state, packagedTemplates);
                        return {
                          type: 'object',
                          properties: {},
                          if: {
                            type: 'object',
                            properties: { stateId: { type: 'string', const: state.id } },
                            required: ['stateId'],
                          },
                          // oxlint-disable-next-line unicorn/no-thenable -- Standard JSON Schema conditional keyword.
                          then: { type: 'object', properties: { data: dataSchema } },
                        };
                      }),
                    }
                  : {}),
              },
            };
          }),
        },
      },
      {
        id: 'transition.take',
        name: 'Take / update a slot',
        schema: {
          type: 'object',
          properties: {
            slotId: structuredClone(slotSelect),
            stateId: stateSelect,
            data: { type: 'object', properties: {}, additionalProperties: true },
          },
          allOf: definition.slots.map((slot) => {
            const states = definition.states.filter((state) => state.slotId === slot.id);
            return {
              type: 'object',
              properties: {},
              if: {
                type: 'object',
                properties: { slotId: { type: 'string', const: slot.id } },
                required: ['slotId'],
              },
              // oxlint-disable-next-line unicorn/no-thenable -- Standard JSON Schema conditional keyword.
              then: {
                type: 'object',
                properties: {
                  stateId: {
                    ...stateSelect,
                    enum: ['', ...states.map((state) => state.id)],
                    default: states[0]?.id ?? '',
                    gddOptions: {
                      labels: Object.fromEntries([
                        ['', 'Off'],
                        ...states.map((state) => [state.id, `${slot.name} / ${state.name}`]),
                      ]),
                    },
                  },
                },
                ...(states.some((state) =>
                  packagedTemplatesHaveExposure(packagedTemplates.get(state.templateId)!),
                )
                  ? {
                      allOf: states.map((state) => ({
                        type: 'object',
                        properties: {},
                        if: {
                          type: 'object',
                          properties: { stateId: { type: 'string', const: state.id } },
                          required: ['stateId'],
                        },
                        // oxlint-disable-next-line unicorn/no-thenable -- Standard JSON Schema conditional keyword.
                        then: {
                          type: 'object',
                          properties: { data: publicStateDataSchema(state, packagedTemplates) },
                        },
                      })),
                    }
                  : {}),
              },
            };
          }),
          required: ['slotId', 'stateId'],
          additionalProperties: false,
        },
      },
      {
        id: 'transition.out',
        name: 'Take a slot out',
        schema: {
          type: 'object',
          properties: { slotId: structuredClone(slotSelect) },
          required: ['slotId'],
          additionalProperties: false,
        },
      },
      {
        id: 'transition.clear',
        name: 'Clear slots immediately',
        description:
          'Clear the selected lane immediately. API callers can omit slotId to clear all lanes.',
        schema: {
          type: 'object',
          properties: { slotId: structuredClone(slotSelect) },
          additionalProperties: false,
        },
      },
      ...(commands.actions.length
        ? [
            {
              id: 'template.action',
              name: 'Run an on-air template action',
              description: 'Take the matching template on air before running its action.',
              schema: laneCommandSchema(commands.actions, 'actionId', 'Action', true),
            },
          ]
        : []),
      ...(commands.loops.length
        ? (['pause', 'resume', 'next'] as const).map((action) => ({
            id: `loop.${action}`,
            name: `${action === 'next' ? 'Advance' : action === 'pause' ? 'Pause' : 'Resume'} a loop group`,
            description: 'Take the matching template on air before controlling its loop group.',
            schema: laneCommandSchema(commands.loops, 'groupId', 'Loop group'),
          }))
        : []),
    ],
    actionDurations: [
      { type: 'playAction', duration: -1 },
      { type: 'updateAction', duration: -1 },
      { type: 'stopAction', duration: -1 },
      { type: 'customAction', customActionId: 'transition.take', duration: -1 },
      { type: 'customAction', customActionId: 'transition.patch', duration: 0 },
      { type: 'customAction', customActionId: 'transition.out', duration: -1 },
      { type: 'customAction', customActionId: 'transition.clear', duration: 0 },
      ...(commands.actions.length
        ? [{ type: 'customAction' as const, customActionId: 'template.action', duration: -1 }]
        : []),
      ...(commands.loops.length
        ? (['pause', 'resume', 'next'] as const).map((action) => ({
            type: 'customAction' as const,
            customActionId: `loop.${action}`,
            duration: 0,
          }))
        : []),
    ],
    renderRequirements: [
      {
        resolution: { width: { exact: width }, height: { exact: height } },
        frameRate: { exact: frameRate },
        accessToPublicInternet: {
          exact:
            presetResourceValues.some((value) => /^https?:/i.test(value)) ||
            [...packagedTemplates.values(), ...packagedShared.values()].some((packaged) =>
              resourceValues(packaged).some((value) => /^https?:/i.test(value)),
            ),
        },
        ...(manifests.some((item) =>
          item.renderRequirements?.some((requirement) => requirement.engine?.length),
        )
          ? { engine: [{ type: 'ZeroDensityHTML', version: { min: '1.0' } }] }
          : {}),
      },
    ],
  };
  resources.set('README.md', {
    path: 'README.md',
    data: operatorReadme(transitionDescriptor, commands, manifest.schema?.default),
    base64: false,
    mimeType: 'text/markdown',
  });
  const manifestErrors = validateManifest(manifest).errors;
  const result: ExportArtifacts = {
    nodosInputContract: buildNodosInputContract(
      {
        ...createComposition(),
        dataFields: [createFieldDefinition('object', { key: 'slots', defaultValue: {} })],
      },
      [...packagedTemplates.values(), ...packagedShared.values()].map((item) => item.composition),
    ),
    transitionDescriptor,
    offlinePreviewStateSchemas: Object.fromEntries(
      definition.slots.map((slot) => [
        slot.id,
        Object.fromEntries(
          definition.states
            .filter((state) => state.slotId === slot.id)
            .map((state) => [state.id, publicStateDataSchema(state, packagedTemplates)]),
        ),
      ]),
    ),
    manifest,
    manifestFileName: `${manifest.id}.ograf.json`,
    mainJs: generateCoordinatedMainJs(transitionDescriptor, runtimeSource, [...resources.keys()], {
      templates: Object.fromEntries(
        [...packagedTemplates].map(([id, packaged]) => [id, dataResourcePaths(packaged)]),
      ),
      shared: Object.fromEntries(
        [...packagedShared].map(([id, packaged]) => [id, dataResourcePaths(packaged)]),
      ),
    }),
    resources: [...resources.values()],
    projectErrors,
    manifestErrors,
    errors: [],
    valid: false,
    ...(profile ? { profile } : {}),
  };
  projectErrors.push(...validatePackageLayout(result));
  result.errors = [...projectErrors, ...manifestErrors];
  result.valid = result.errors.length === 0;
  return result;
}
