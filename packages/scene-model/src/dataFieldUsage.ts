import type { Project } from './types';

export interface DataFieldReference {
  kind: 'binding' | 'rule' | 'modifier' | 'collection' | 'loop-timing' | 'connection' | 'function';
  ownerId: string;
  layerId?: string;
  targetProperty?: string;
  enabled?: boolean;
  access?: 'read' | 'write';
  /** Authored flags, not proof that a transition, mask or runtime rule cannot use this layer. */
  isVisible?: boolean;
  isGuide?: boolean;
  isMaskOnly?: boolean;
}

export interface DataFieldUsage {
  compositionId: string;
  fieldId: string;
  fieldKey: string;
  status: 'referenced' | 'unreferenced' | 'hidden-bindings-only' | 'guide-bindings-only';
  references: DataFieldReference[];
}

/**
 * Advisory top-level field-reference audit. Inspect the resolved composition, never retained
 * component baselines or reusable definitions: those snapshots are not runtime consumers.
 * This does not establish pixel visibility or dynamic reachability.
 */
export function inspectDataFieldUsage(project: Project): {
  fields: DataFieldUsage[];
  warnings: string[];
} {
  const fields: DataFieldUsage[] = [];
  const warnings: string[] = [];
  for (const composition of project.compositions) {
    const references = new Map<string, DataFieldReference[]>();
    const add = (fieldId: string | undefined, reference: DataFieldReference) => {
      if (!fieldId) return;
      const uses = references.get(fieldId) ?? [];
      uses.push(reference);
      references.set(fieldId, uses);
    };
    for (const layer of composition.layers) {
      const layerReference = (kind: DataFieldReference['kind'], ownerId = layer.id) => ({
        kind,
        ownerId,
        layerId: layer.id,
        isVisible: layer.isVisible,
        isGuide: layer.isGuide,
        isMaskOnly: layer.isMaskOnly,
      });
      for (const binding of layer.bindings)
        add(binding.fieldId, {
          ...layerReference('binding'),
          targetProperty: binding.targetProperty,
        });
      for (const rule of layer.visualRules) {
        const reference = { ...layerReference('rule', rule.id), enabled: rule.enabled };
        if (!rule.trigger || rule.trigger === 'data') {
          add(rule.fieldId, reference);
          add(rule.compareFieldId, reference);
        }
        for (const condition of rule.conditions ?? []) {
          add(condition.fieldId, reference);
          add(condition.compareFieldId, reference);
        }
        for (const action of rule.actions)
          if (action.type === 'set-data') add(action.fieldId, reference);
      }
      for (const modifier of layer.modifiers ?? [])
        if (modifier.type === 'hide-empty' && modifier.params.source.kind === 'field')
          add(modifier.params.source.fieldId, {
            ...layerReference('modifier', modifier.id),
            enabled: modifier.enabled,
          });
      if (layer.loop?.timing)
        add(layer.loop.timing.holdFieldId, layerReference('loop-timing', layer.loop.id));
    }
    for (const collection of composition.runtimeCollections)
      add(collection.fieldId, { kind: 'collection', ownerId: collection.id });
    for (const connection of composition.dataConnections)
      for (const mapping of connection.mappings)
        add(mapping.fieldId, {
          kind: 'connection',
          ownerId: connection.id,
          enabled: connection.enabled,
        });
    for (const definition of Array.isArray(composition.functions) ? composition.functions : []) {
      if (!definition) continue;
      for (const [alias, fieldId] of Object.entries(definition.inputs ?? {}))
        add(fieldId, {
          kind: 'function',
          ownerId: definition.id,
          targetProperty: alias,
          access: 'read',
          enabled: definition.enabled,
        });
      for (const [alias, fieldId] of Object.entries(definition.outputs ?? {}))
        add(fieldId, {
          kind: 'function',
          ownerId: definition.id,
          targetProperty: alias,
          access: 'write',
          enabled: definition.enabled,
        });
    }
    for (const field of composition.dataFields) {
      const uses = references.get(field.id) ?? [];
      const bindingOnly = uses.length > 0 && uses.every((use) => use.kind === 'binding');
      const status: DataFieldUsage['status'] = !uses.length
        ? 'unreferenced'
        : bindingOnly && uses.every((use) => use.isGuide)
          ? 'guide-bindings-only'
          : bindingOnly && uses.every((use) => !use.isVisible && !use.isMaskOnly)
            ? 'hidden-bindings-only'
            : 'referenced';
      fields.push({
        compositionId: composition.id,
        fieldId: field.id,
        fieldKey: field.key,
        status,
        references: uses,
      });
      const owner = `Composition "${composition.name}": data field "${field.key}"`;
      if (status === 'unreferenced')
        warnings.push(`${owner} has no runtime reference in the resolved composition.`);
      else if (status === 'guide-bindings-only')
        warnings.push(`${owner} binds only to guide layers, which are excluded from export.`);
      else if (status === 'hidden-bindings-only')
        warnings.push(
          `${owner} binds only to authored-hidden layers. Verify a runtime rule, transition or geometry dependency uses them before treating the control as functional.`,
        );
    }
  }
  return { fields, warnings };
}
