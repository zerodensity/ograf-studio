import type { FieldDefinition, FieldValue } from './types';
import { createId } from './id';

export function valueAtSourcePath(value: unknown, sourcePath: readonly string[] = []): unknown {
  let current = value;
  for (const segment of sourcePath) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function fieldDefinitionAtPath(
  field: FieldDefinition,
  sourcePath: readonly string[],
  options: { fromArrayItem?: boolean } = {},
): FieldDefinition | undefined {
  let current = options.fromArrayItem ? (field.items ?? undefined) : field;
  if (!current) return undefined;
  for (const segment of sourcePath) {
    if (current.type !== 'object') return undefined;
    current = current.properties.find((property) => property.key === segment);
    if (!current) return undefined;
  }
  return current;
}

export interface FieldLeafPath {
  path: string[];
  label: string;
  type: FieldDefinition['type'];
}

export function listFieldLeafPaths(
  field: FieldDefinition,
  options: { fromArrayItem?: boolean } = {},
): FieldLeafPath[] {
  const root = options.fromArrayItem ? field.items : field;
  if (!root) return [];
  const result: FieldLeafPath[] = [];
  const visit = (node: FieldDefinition, path: string[], labels: string[]) => {
    if (node.type === 'object') {
      for (const property of node.properties) {
        visit(property, [...path, property.key], [...labels, property.label || property.key]);
      }
      return;
    }
    if (node.type === 'array') return;
    result.push({ path, label: labels.join(' / ') || node.label || node.key, type: node.type });
  };
  visit(root, [], []);
  return result;
}

export function cloneFieldValue(value: FieldValue): FieldValue {
  return structuredClone(value);
}

/** Deep field-schema clone with a fresh ID for the root and every nested property/item node. */
export function cloneFieldDefinitionWithFreshIds(
  source: FieldDefinition,
  rootId = createId('field'),
): FieldDefinition {
  const cloneNode = (node: FieldDefinition, id = createId('field')): FieldDefinition => ({
    ...structuredClone(node),
    id,
    properties: node.properties.map((property) => cloneNode(property)),
    items: node.items ? cloneNode(node.items) : null,
  });
  return cloneNode(source, rootId);
}
