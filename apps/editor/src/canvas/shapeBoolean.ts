import paper from 'paper';
import {
  convertLayerToPath,
  getLayerTransformAtFrame,
  parseEditablePath,
  type Layer,
  type Paint,
} from '@ograf-editor/scene-model';

export type ShapeBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';
/** Boolean operations use the selected shapes' geometry at the current frame, in back-to-front order.
 * Sources are retained unchanged, so existing animation and references remain intact. */
export function combineShapePaths(
  layers: Layer[],
  frame: number,
  operation: ShapeBooleanOperation,
) {
  if (layers.length < 2) throw new Error('Select at least two shape layers.');
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  try {
    const paths = layers.map((source) => {
      if (source.parentId || source.groupId)
        throw new Error('Ungroup and unparent shapes before combining them.');
      if (!['rectangle', 'ellipse', 'path'].includes(source.element.type))
        throw new Error('Shape operations support rectangles, ellipses and closed paths.');
      const layer = structuredClone(source);
      convertLayerToPath(layer, frame);
      if (layer.element.type !== 'path') throw new Error('Could not convert shape to a path.');
      if (layer.element.stretchInsets)
        throw new Error('Disable Preserve design before combining a path.');
      if (parseEditablePath(layer.element.d).some((contour) => !contour.closed))
        throw new Error('Close all paths before combining shapes.');
      const t = getLayerTransformAtFrame(source, frame);
      if (
        t.width <= 0 ||
        t.height <= 0 ||
        layer.element.viewBoxWidth <= 0 ||
        layer.element.viewBoxHeight <= 0
      )
        throw new Error('Shapes must have positive dimensions.');
      const path = new scope.CompoundPath({ pathData: layer.element.d, insert: false });
      path.fillRule = layer.element.fillRule;
      path.scale(
        t.width / layer.element.viewBoxWidth,
        t.height / layer.element.viewBoxHeight,
        new scope.Point(0, 0),
      );
      path.rotate(
        t.rotation,
        new scope.Point(t.width * t.transformOriginX, t.height * t.transformOriginY),
      );
      path.translate(new scope.Point(t.x, t.y));
      return path;
    });
    let result: paper.PathItem = paths[0]!;
    for (const next of paths.slice(1)) {
      const previous = result;
      result =
        operation === 'union'
          ? previous.unite(next, { insert: false })
          : operation === 'subtract'
            ? previous.subtract(next, { insert: false })
            : operation === 'intersect'
              ? previous.intersect(next, { insert: false })
              : previous.exclude(next, { insert: false });
      previous.remove();
      next.remove();
    }
    const box = result.bounds;
    if (result.isEmpty() || box.width < 1e-6 || box.height < 1e-6)
      throw new Error('The selected operation produces an empty shape.');
    const x = box.x,
      y = box.y,
      width = box.width,
      height = box.height;
    result.translate(new scope.Point(-x, -y));
    const d = result.pathData;
    parseEditablePath(d); // Ensure the resulting ordinary Studio path remains editable and exportable.
    const sourceElement = layers[0]!.element;
    const fill: Paint =
      sourceElement.type === 'rectangle' ||
      sourceElement.type === 'ellipse' ||
      sourceElement.type === 'path'
        ? structuredClone(sourceElement.fill)
        : '#3b3f4a';
    return { x, y, width, height, d, closed: true, fill };
  } finally {
    scope.project.remove();
  }
}
