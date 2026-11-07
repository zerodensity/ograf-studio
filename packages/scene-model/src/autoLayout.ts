import type { LayerAutoLayout, LayerTransform } from './types';

export const DEFAULT_LAYER_AUTO_LAYOUT: LayerAutoLayout = {
  direction: 'none',
  gap: 0,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  align: 'start',
  hugWidth: false,
  hugHeight: false,
  minWidth: 0,
  maxWidth: 0,
  collapseHidden: true,
};

export function normalizeLayerAutoLayout(
  value: Partial<LayerAutoLayout> | null | undefined,
): LayerAutoLayout {
  const number = (input: number | undefined) =>
    Number.isFinite(input) ? Math.max(0, Math.round(input!)) : 0;
  return {
    direction: ['horizontal', 'vertical'].includes(value?.direction ?? '')
      ? value!.direction!
      : 'none',
    gap: number(value?.gap),
    paddingTop: number(value?.paddingTop),
    paddingRight: number(value?.paddingRight),
    paddingBottom: number(value?.paddingBottom),
    paddingLeft: number(value?.paddingLeft),
    align: ['center', 'end', 'stretch'].includes(value?.align ?? '') ? value!.align! : 'start',
    hugWidth: value?.hugWidth ?? false,
    hugHeight: value?.hugHeight ?? false,
    minWidth: number(value?.minWidth),
    maxWidth: number(value?.maxWidth),
    collapseHidden: value?.collapseHidden ?? true,
  };
}

export interface AutoLayoutNode {
  id: string;
  parentId: string | null;
  isVisible: boolean;
  autoLayout: LayerAutoLayout;
}

/** Mutates sampled transforms so editor and runtime can share one deterministic flow solver. */
export function applyAutoLayoutTransforms(
  nodes: AutoLayoutNode[],
  transforms: Map<string, LayerTransform>,
  measuredSizes: Map<string, { width: number; height: number }> = new Map(),
): void {
  for (const [id, size] of measuredSizes) {
    const pose = transforms.get(id);
    if (!pose) continue;
    if (size.width > 0) pose.width = size.width;
    if (size.height > 0) pose.height = size.height;
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, AutoLayoutNode[]>();
  for (const node of nodes) {
    if (!node.parentId || !nodeById.has(node.parentId)) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const translated = (parentId: string, dx: number, dy: number) => {
    for (const child of children.get(parentId) ?? []) {
      const pose = transforms.get(child.id);
      if (!pose) continue;
      pose.x += dx;
      pose.y += dy;
      translated(child.id, dx, dy);
    }
  };
  const visiting = new Set<string>();
  const complete = new Set<string>();
  const solve = (node: AutoLayoutNode) => {
    if (complete.has(node.id) || visiting.has(node.id)) return;
    visiting.add(node.id);
    for (const child of children.get(node.id) ?? []) solve(child);
    const layout = node.autoLayout;
    const parent = transforms.get(node.id);
    if (parent && layout.direction !== 'none') {
      const items = (children.get(node.id) ?? []).filter(
        (child) => !layout.collapseHidden || child.isVisible,
      );
      const poses = items.flatMap((item) => {
        const pose = transforms.get(item.id);
        return pose ? [{ item, pose }] : [];
      });
      const horizontal = layout.direction === 'horizontal';
      const mainSize = poses.reduce(
        (sum, { pose }) => sum + (horizontal ? pose.width : pose.height),
        0,
      );
      const crossSize = poses.reduce(
        (max, { pose }) => Math.max(max, horizontal ? pose.height : pose.width),
        0,
      );
      const gapSize = Math.max(0, poses.length - 1) * layout.gap;
      if (layout.hugWidth) {
        const desired = Math.max(
          1,
          horizontal
            ? layout.paddingLeft + mainSize + gapSize + layout.paddingRight
            : layout.paddingLeft + crossSize + layout.paddingRight,
        );
        parent.width = Math.max(
          layout.minWidth || 1,
          layout.maxWidth > 0 ? Math.min(layout.maxWidth, desired) : desired,
        );
      }
      if (layout.hugHeight) {
        parent.height = Math.max(
          1,
          horizontal
            ? layout.paddingTop + crossSize + layout.paddingBottom
            : layout.paddingTop + mainSize + gapSize + layout.paddingBottom,
        );
      }
      const innerCross = horizontal
        ? Math.max(0, parent.height - layout.paddingTop - layout.paddingBottom)
        : Math.max(0, parent.width - layout.paddingLeft - layout.paddingRight);
      let cursor = horizontal ? parent.x + layout.paddingLeft : parent.y + layout.paddingTop;
      for (const { item, pose } of poses) {
        const previousX = pose.x;
        const previousY = pose.y;
        if (horizontal) {
          pose.x = cursor;
          if (layout.align === 'stretch') pose.height = Math.max(1, innerCross);
          pose.y =
            parent.y +
            layout.paddingTop +
            (layout.align === 'center'
              ? (innerCross - pose.height) / 2
              : layout.align === 'end'
                ? innerCross - pose.height
                : 0);
          cursor += pose.width + layout.gap;
        } else {
          pose.y = cursor;
          if (layout.align === 'stretch') pose.width = Math.max(1, innerCross);
          pose.x =
            parent.x +
            layout.paddingLeft +
            (layout.align === 'center'
              ? (innerCross - pose.width) / 2
              : layout.align === 'end'
                ? innerCross - pose.width
                : 0);
          cursor += pose.height + layout.gap;
        }
        translated(item.id, pose.x - previousX, pose.y - previousY);
      }
    }
    visiting.delete(node.id);
    complete.add(node.id);
  };
  for (const node of nodes) solve(node);
}
