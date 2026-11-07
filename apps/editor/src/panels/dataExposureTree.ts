import type { Composition, FieldDefinition, Layer } from '@ograf-editor/scene-model';

export type ExposureFieldPath = readonly ({ kind: 'property'; id: string } | { kind: 'items' })[];

interface ExposureNodeBase {
  id: string;
  label: string;
  detail?: string;
  children: ExposureTreeNode[];
}

export interface ExposureFieldNode extends ExposureNodeBase {
  kind: 'field';
  rootFieldId: string;
  path: ExposureFieldPath;
  keyPath: string;
  field: FieldDefinition;
  authoredExposed: boolean;
  effectiveExposed: boolean;
  blockedBy?: string;
  blockedReason?: 'parent' | 'items';
  layerId?: string;
}

export interface ExposureBranchNode extends ExposureNodeBase {
  kind: 'group' | 'layer';
  layerId?: string;
}

export type ExposureTreeNode = ExposureFieldNode | ExposureBranchNode;
export type ExposureFieldPatch = Partial<
  Pick<FieldDefinition, 'exposeToOgraf' | 'properties' | 'items'>
>;

function fieldNode(
  field: FieldDefinition,
  rootFieldId: string,
  path: ExposureFieldPath,
  keyPath: string,
  ancestorBlock?: string,
): ExposureFieldNode {
  const label = field.label || field.key || 'Items';
  const authoredExposed = field.exposeToOgraf !== false;
  const itemsBlock =
    field.type === 'array' && field.items?.exposeToOgraf === false
      ? field.items.label || 'Items'
      : undefined;
  const blockedBy = ancestorBlock || (authoredExposed ? itemsBlock : undefined);
  const childBlock = ancestorBlock || (!authoredExposed ? label : undefined);
  const node: ExposureFieldNode = {
    id: `expose:field:${encodeURIComponent(rootFieldId)}:${path
      .map((segment) =>
        segment.kind === 'items' ? 'items' : `property:${encodeURIComponent(segment.id)}`,
      )
      .join('/')}`,
    kind: 'field',
    label,
    rootFieldId,
    path,
    keyPath,
    field,
    authoredExposed,
    effectiveExposed: authoredExposed && !ancestorBlock && !itemsBlock,
    ...(blockedBy
      ? { blockedBy, blockedReason: ancestorBlock ? ('parent' as const) : ('items' as const) }
      : {}),
    children: [],
  };
  if (field.type === 'object')
    node.children = field.properties.map((child) =>
      fieldNode(
        child,
        rootFieldId,
        [...path, { kind: 'property', id: child.id }],
        `${keyPath}.${child.key}`,
        childBlock,
      ),
    );
  else if (field.type === 'array' && field.items)
    node.children = [
      fieldNode(field.items, rootFieldId, [...path, { kind: 'items' }], `${keyPath}[]`, childBlock),
    ];
  return node;
}

/** Show every field once, beside its shader owner or its first bound object. */
export function buildDataExposureTree(composition: Composition): ExposureTreeNode[] {
  const byId = new Map(composition.layers.map((layer) => [layer.id, layer]));
  const fieldsByLayer = new Map<string, ExposureFieldNode[]>();
  const templateFields: ExposureFieldNode[] = [];
  for (const field of composition.dataFields) {
    const consumers = composition.layers.filter((layer) =>
      layer.bindings.some((binding) => binding.fieldId === field.id),
    );
    const owner = byId.get(field.generatedShaderParameter?.layerId ?? '') ?? consumers[0];
    const node = fieldNode(field, field.id, [], field.key);
    if (!owner) {
      templateFields.push(node);
      continue;
    }
    node.layerId = owner.id;
    node.detail =
      consumers.length > 1
        ? `Used by ${consumers.length} objects: ${consumers.map((layer) => layer.name).join(', ')}`
        : field.generatedShaderParameter
          ? `Shader parameter · ${field.generatedShaderParameter.name}`
          : undefined;
    fieldsByLayer.set(owner.id, [...(fieldsByLayer.get(owner.id) ?? []), node]);
  }

  const hasSafeParentChain = (layer: Layer): boolean => {
    const seen = new Set([layer.id]);
    let parentId = layer.parentId;
    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) return false;
      seen.add(parentId);
      parentId = byId.get(parentId)!.parentId;
    }
    return true;
  };
  const needed = new Set<string>();
  for (const layerId of fieldsByLayer.keys()) {
    let current = byId.get(layerId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      needed.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  const layers = [...composition.layers].reverse().filter((layer) => needed.has(layer.id));
  const nodes = new Map<string, ExposureBranchNode>(
    layers.map((layer) => [
      layer.id,
      {
        id: `expose:layer:${layer.id}`,
        kind: 'layer',
        label: layer.name,
        detail: layer.element.type,
        layerId: layer.id,
        children: fieldsByLayer.get(layer.id) ?? [],
      },
    ]),
  );
  const roots: ExposureTreeNode[] = [];
  for (const layer of layers) {
    const node = nodes.get(layer.id)!;
    const parent = layer.parentId ? nodes.get(layer.parentId) : undefined;
    if (parent && hasSafeParentChain(layer)) parent.children.push(node);
    else roots.push(node);
  }

  const groupMembers = new Map<string, Layer[]>();
  for (const layer of composition.layers)
    if (layer.groupId)
      groupMembers.set(layer.groupId, [...(groupMembers.get(layer.groupId) ?? []), layer]);
  const groupSiblings = (
    siblings: ExposureTreeNode[],
    parentGroupId?: string | null,
  ): ExposureTreeNode[] => {
    const result: ExposureTreeNode[] = [];
    const groups = new Map<string, ExposureBranchNode>();
    for (const node of siblings) {
      if (node.kind !== 'layer') {
        result.push(node);
        continue;
      }
      const layer = byId.get(node.layerId!)!;
      node.children = groupSiblings(node.children, layer.groupId || parentGroupId);
      if (!layer.groupId || layer.groupId === parentGroupId) {
        result.push(node);
        continue;
      }
      let group = groups.get(layer.groupId);
      if (!group) {
        const members = groupMembers.get(layer.groupId)!;
        group = {
          id: `expose:group:${layer.groupId}:${node.id}`,
          kind: 'group',
          label:
            members
              .slice(0, 2)
              .map((member) => member.name)
              .join(', ') + (members.length > 2 ? ` +${members.length - 2}` : ''),
          detail: 'Group',
          children: [],
        };
        groups.set(layer.groupId, group);
        result.push(group);
      }
      group.children.push(node);
    }
    return result;
  };
  const result = groupSiblings(roots);
  if (templateFields.length)
    result.push({
      id: 'expose:template-controls',
      kind: 'group',
      label: 'Template controls',
      children: templateFields,
    });
  return result;
}

export function flattenExposureFields(nodes: readonly ExposureTreeNode[]): ExposureFieldNode[] {
  return nodes.flatMap((node) => [
    ...(node.kind === 'field' ? [node] : []),
    ...flattenExposureFields(node.children),
  ]);
}

/** Only change the addressed exposure switch; parent/child policies remain independent. */
export function exposureFieldPatch(
  root: FieldDefinition,
  path: ExposureFieldPath,
  exposed: boolean,
): ExposureFieldPatch {
  const [segment, ...rest] = path;
  if (!segment) return { exposeToOgraf: exposed };
  if (segment.kind === 'items')
    return root.items
      ? { items: { ...root.items, ...exposureFieldPatch(root.items, rest, exposed) } }
      : {};
  return {
    properties: root.properties.map((property) =>
      property.id === segment.id
        ? { ...property, ...exposureFieldPatch(property, rest, exposed) }
        : property,
    ),
  };
}
