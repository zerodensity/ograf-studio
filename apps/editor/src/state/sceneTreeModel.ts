import type { ProjectSetSceneNode } from './projectSet';

export interface VisibleSceneTreeNode {
  node: ProjectSetSceneNode;
  depth: number;
  parentId: string | null;
  position: number;
  siblingCount: number;
}

/** Keeps matching branches and their ancestors; matching folders retain their descendants. */
export function filterSceneTree(
  root: ProjectSetSceneNode,
  query: string,
): ProjectSetSceneNode | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return root;
  const visit = (node: ProjectSetSceneNode): ProjectSetSceneNode | null => {
    if (`${node.label} ${node.kind} ${node.referencePath ?? ''}`.toLowerCase().includes(needle))
      return node;
    const children = node.children
      .map(visit)
      .filter((child): child is ProjectSetSceneNode => !!child);
    return children.length ? { ...node, children } : null;
  };
  return visit(root);
}

export function visibleSceneTreeNodes(
  root: ProjectSetSceneNode,
  expanded: ReadonlySet<string>,
  expandAll = false,
): VisibleSceneTreeNode[] {
  const result: VisibleSceneTreeNode[] = [];
  const visit = (
    node: ProjectSetSceneNode,
    depth: number,
    parentId: string | null,
    position: number,
    siblingCount: number,
  ) => {
    result.push({ node, depth, parentId, position, siblingCount });
    if (expandAll || expanded.has(node.id))
      node.children.forEach((child, index) =>
        visit(child, depth + 1, node.id, index + 1, node.children.length),
      );
  };
  visit(root, 0, null, 1, 1);
  return result;
}

export function findSceneTreePath(
  root: ProjectSetSceneNode,
  matches: (node: ProjectSetSceneNode) => boolean,
): ProjectSetSceneNode[] | null {
  if (matches(root)) return [root];
  for (const child of root.children) {
    const path = findSceneTreePath(child, matches);
    if (path) return [root, ...path];
  }
  return null;
}
