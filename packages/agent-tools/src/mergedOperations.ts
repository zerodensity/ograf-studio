import * as z from 'zod/v4';
import type { Composition } from '@ograf-editor/scene-model';
import { authoringOperationSchema } from './schemas';

/**
 * Earlier operation names that a listed operation now covers, and four that only help a person in
 * the editor. All are still accepted, so an older skill or script keeps working; none is listed.
 */
export const UNLISTED_OPERATION_TYPES: ReadonlySet<string> = new Set([
  // set_data_field, set_data_connection, set_custom_action, set_media_cue, set_runtime_collection
  'add_data_field',
  'update_data_field',
  'add_data_connection',
  'update_data_connection',
  'add_custom_action',
  'update_custom_action',
  'add_media_cue',
  'update_media_cue',
  'create_runtime_collection',
  'update_runtime_collection',
  // create_recipe
  'create_lower_third',
  'create_bug',
  'create_ticker',
  'create_scoreboard',
  'create_clock',
  'create_countdown',
  // set_timeline_group, set_lifecycle_keyframe
  'create_timeline_group',
  'rename_timeline_group',
  'set_timeline_group_color',
  'ungroup_timeline_group',
  'rename_lifecycle_keyframe',
  'move_lifecycle_keyframe',
  // update_layer
  'rename_layer',
  'set_layer_flags',
  'set_layer_semantics',
  // The fuller operation stays: set_layer_bindings, set_property_key, add_effect, add_modifier.
  'set_layer_binding',
  'move_property_key',
  'set_property_key_easing',
  'duplicate_effect',
  'duplicate_modifier',
  // The setter removes with an empty value.
  'remove_layer_loop',
  'remove_tiling_pattern',
  'unbind_design_token',
  'remove_style_pack',
  // save_component with componentId, remove_plugin
  'update_component_from_layers',
  'remove_renderer_plugin',
  'remove_animation_preset_plugin',
  // Editor aids an agent cannot see, and an approval that is a person's to give.
  'add_canvas_guide',
  'update_canvas_guide',
  'remove_canvas_guide',
  'set_review_approval',
]);

type Operation = Record<string, unknown>;

const present = (operation: Operation, ...keys: string[]): string[] =>
  keys.filter((key) => operation[key] !== undefined);

const pick = (operation: Operation, ...keys: string[]): Operation =>
  Object.fromEntries(present(operation, ...keys).map((key) => [key, operation[key]]));

const LAYER = ['compositionId', 'layerId', 'layerName'] as const;

/** Operations that take `layerIds` or `layerNamePattern` and apply to each of those layers. */
const SEVERAL_LAYER_OPERATIONS = new Set([
  'update_element',
  'update_transform',
  'update_layer',
  'set_layer_motion',
  'set_property_track',
]);

/** Matches a whole layer name; `*` stands for any run of characters. */
export function wildcardNameMatcher(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/** One copy of the operation per addressed layer, or undefined when it addresses one layer. */
function perLayer(operation: Operation, composition: Composition): Operation[] | undefined {
  const { layerIds, layerNamePattern, ...single } = operation;
  if (layerIds === undefined && layerNamePattern === undefined) return undefined;
  if (
    (layerIds !== undefined && layerNamePattern !== undefined) ||
    single.layerId !== undefined ||
    single.layerName !== undefined
  )
    throw new Error('pass one of layerId, layerName, layerIds or layerNamePattern.');
  if (single.type === 'update_layer' && single.name !== undefined)
    throw new Error('a name applies to one layer; pass layerId or layerName with it.');
  const ids =
    (layerIds as string[] | undefined) ??
    composition.layers
      .filter((layer) => wildcardNameMatcher(String(layerNamePattern)).test(layer.name))
      .map((layer) => layer.id);
  if (ids.length === 0)
    throw new Error(`layerNamePattern ${JSON.stringify(layerNamePattern)} matched no layers.`);
  return ids.map((layerId) => ({ ...single, layerId }));
}

/**
 * The earlier operations that do what a covering operation asks, read against the project as it
 * stands when this operation's turn comes. Undefined for an operation the engine applies as written.
 */
function coveredOperations(
  operation: Operation,
  composition: Composition,
): Operation[] | undefined {
  if (SEVERAL_LAYER_OPERATIONS.has(String(operation.type))) {
    const each = perLayer(operation, composition);
    if (each) return each;
  }
  const { type, ...rest } = operation;
  switch (type) {
    case 'set_data_field': {
      if (rest.fieldId !== undefined || rest.fieldKey !== undefined)
        return [{ ...rest, type: 'update_data_field' }];
      return composition.dataFields.some((field) => field.key === rest.key)
        ? [{ ...rest, type: 'update_data_field', fieldKey: rest.key }]
        : [{ ...rest, type: 'add_data_field' }];
    }
    case 'set_data_connection': {
      const { connectionId, connection, ...common } = rest;
      return connectionId === undefined
        ? [{ ...common, type: 'add_data_connection', connection }]
        : [{ ...common, type: 'update_data_connection', connectionId, patch: connection }];
    }
    case 'set_custom_action': {
      if (composition.customActions.some((action) => action.actionId === rest.actionId))
        return [{ ...rest, type: 'update_custom_action' }];
      if (rest.nextActionId !== undefined)
        throw new Error(`custom action not found, so it cannot be renamed: ${rest.actionId}`);
      return [{ ...rest, type: 'add_custom_action' }];
    }
    case 'set_media_cue': {
      const { cueId, cue, ...common } = rest;
      return cueId === undefined
        ? [{ ...common, type: 'add_media_cue', cue }]
        : [{ ...common, type: 'update_media_cue', cueId, patch: cue }];
    }
    case 'set_runtime_collection':
      return [
        {
          ...rest,
          type:
            rest.collectionId === undefined
              ? 'create_runtime_collection'
              : 'update_runtime_collection',
        },
      ];
    case 'create_recipe': {
      const { recipe, ...recipeArguments } = rest;
      return [{ ...recipeArguments, type: `create_${String(recipe).replace('-', '_')}` }];
    }
    case 'set_timeline_group': {
      const common = pick(rest, 'compositionId');
      if (rest.groupId === undefined)
        return [
          { ...common, ...pick(rest, 'layerIds', 'name', 'color'), type: 'create_timeline_group' },
        ];
      const group = { ...common, groupId: rest.groupId };
      if (Array.isArray(rest.layerIds)) {
        if (rest.layerIds.length > 0)
          throw new Error(
            'a timeline group keeps its members; pass layerIds: [] to ungroup it, then create the new group.',
          );
        return [{ ...group, type: 'ungroup_timeline_group' }];
      }
      const changes = [
        ...(rest.name === undefined
          ? []
          : [{ ...group, type: 'rename_timeline_group', name: rest.name }]),
        ...(rest.color === undefined
          ? []
          : [{ ...group, type: 'set_timeline_group_color', color: rest.color }]),
      ];
      if (changes.length === 0) throw new Error('pass name, color, or layerIds: [] for the group.');
      return changes;
    }
    case 'set_lifecycle_keyframe': {
      const keyframe = pick(rest, 'compositionId', 'keyframeId');
      const changes = [
        ...(rest.name === undefined
          ? []
          : [{ ...keyframe, type: 'rename_lifecycle_keyframe', name: rest.name }]),
        ...(rest.frame === undefined
          ? []
          : [{ ...keyframe, type: 'move_lifecycle_keyframe', frame: rest.frame }]),
      ];
      if (changes.length === 0) throw new Error('pass frame or name for the keyframe.');
      return changes;
    }
    case 'update_layer': {
      const layer = pick(rest, ...LAYER);
      const flags = pick(rest, 'isVisible', 'isGuide', 'isMaskOnly', 'blendMode');
      // The new name comes last, so a layerName selector still finds the layer for the rest.
      const changes = [
        ...(Object.keys(flags).length === 0
          ? []
          : [{ ...layer, ...flags, type: 'set_layer_flags' }]),
        ...(rest.semantics === undefined
          ? []
          : [{ ...layer, type: 'set_layer_semantics', patch: rest.semantics }]),
        ...(rest.name === undefined ? [] : [{ ...layer, type: 'rename_layer', name: rest.name }]),
      ];
      if (changes.length === 0)
        throw new Error('pass name, isVisible, isGuide, isMaskOnly, blendMode or semantics.');
      return changes;
    }
    case 'remove_plugin': {
      const { kind, ...plugin } = rest;
      return [
        {
          ...plugin,
          type: kind === 'renderer' ? 'remove_renderer_plugin' : 'remove_animation_preset_plugin',
        },
      ];
    }
    case 'set_layer_loop': {
      if (rest.remove !== true) return undefined;
      const others = present(
        rest,
        'name',
        'activation',
        'durationFrames',
        'phaseOffsetFrames',
        'repeatCount',
        'timing',
      );
      if (others.length > 0) throw new Error(`remove: true takes no ${others.join(', ')}.`);
      return [{ ...pick(rest, ...LAYER), type: 'remove_layer_loop' }];
    }
    case 'set_tiling_pattern': {
      if (rest.patch !== null) return undefined;
      const named = composition.patterns.filter((pattern) => pattern.name === rest.patternName);
      const patternId = rest.patternId ?? (named.length === 1 ? named[0]!.id : undefined);
      if (
        patternId === undefined ||
        (rest.patternId !== undefined && rest.patternName !== undefined)
      )
        throw new Error(
          'patch: null removes one pattern; pass its patternId or its unique patternName.',
        );
      return [{ ...pick(rest, 'compositionId'), type: 'remove_tiling_pattern', patternId }];
    }
    case 'bind_design_token': {
      if (rest.tokenId !== null) return undefined;
      if (rest.tokenKey !== undefined) throw new Error('tokenId: null unbinds; omit tokenKey.');
      return [{ ...pick(rest, ...LAYER, 'targetProperty'), type: 'unbind_design_token' }];
    }
    case 'apply_style_pack':
      return rest.stylePack === null
        ? [{ ...pick(rest, 'compositionId'), type: 'remove_style_pack' }]
        : undefined;
    case 'save_component': {
      if (rest.componentId === undefined) {
        if (rest.name === undefined) throw new Error('a new component needs a name.');
        return undefined;
      }
      const component = pick(rest, 'compositionId', 'componentId');
      return [
        { ...component, type: 'update_component_from_layers', layerIds: rest.layerIds },
        ...(rest.name === undefined
          ? []
          : [{ ...component, type: 'rename_component', name: rest.name }]),
      ];
    }
    default:
      return undefined;
  }
}

/**
 * Replaces a covering operation with the earlier operations that carry it out, each checked
 * against that operation's own rules. Returns undefined when the operation applies as written.
 */
export function expandMergedOperation(
  operation: Operation,
  composition: Composition,
): Operation[] | undefined {
  const covered = coveredOperations(operation, composition);
  return covered?.map((step) => {
    const parsed = authoringOperationSchema.safeParse(step);
    if (!parsed.success) throw new Error(`${operation.type}: ${z.prettifyError(parsed.error)}`);
    return parsed.data as Operation;
  });
}

type JsonSchema = Record<string, unknown>;

/** Follows a reference into the schema's own definitions; a plain schema is returned as it is. */
function resolved(root: JsonSchema, node: JsonSchema | undefined): JsonSchema {
  let current = node ?? {};
  while (typeof current.$ref === 'string') {
    const [, group, name] = current.$ref.split('/');
    current = (root[group!] as Record<string, JsonSchema> | undefined)?.[name!] ?? {};
  }
  return current;
}

function unlisted(root: JsonSchema, variant: JsonSchema): boolean {
  const type = resolved(
    root,
    (resolved(root, variant).properties as Record<string, JsonSchema> | undefined)?.type,
  );
  const names = type.const !== undefined ? [type.const] : ((type.enum as unknown[]) ?? []);
  return names.length > 0 && names.every((name) => UNLISTED_OPERATION_TYPES.has(String(name)));
}

/** Drops definitions that nothing refers to any more. */
function withoutUnusedDefinitions(schema: JsonSchema): JsonSchema {
  for (const key of ['$defs', 'definitions']) {
    const definitions = schema[key] as Record<string, unknown> | undefined;
    if (!definitions) continue;
    for (;;) {
      const { [key]: _definitions, ...body } = schema;
      const text = JSON.stringify([body, definitions]);
      const unused = Object.keys(definitions).filter(
        (name) => !text.includes(`"#/${key}/${name}"`),
      );
      if (unused.length === 0) break;
      for (const name of unused) delete definitions[name];
    }
  }
  return schema;
}

/** The operations an agent is shown: the accepted ones without the earlier names. */
export function listedOperationsSchema(inputSchema: JsonSchema): JsonSchema {
  const schema = structuredClone(inputSchema);
  const operations = resolved(
    schema,
    (schema.properties as Record<string, JsonSchema> | undefined)?.operations,
  );
  const items = resolved(schema, operations.items as JsonSchema | undefined);
  for (const union of ['oneOf', 'anyOf'])
    if (Array.isArray(items[union]))
      items[union] = (items[union] as JsonSchema[]).filter((variant) => !unlisted(schema, variant));
  return withoutUnusedDefinitions(schema);
}
