import type { Element, LayerTransform, TextElement } from './types';
import type { ExpressionRect } from './expressions';
import { editablePathBounds } from './pathEditing';

/** Renderer geometry with optional local stroke scaling from text fitting. */
export interface ExpressionTextMeasurement extends ExpressionRect {
  strokeScaleX?: number;
  strokeScaleY?: number;
}

/** Local source geometry before transforms, masks and effects. Text needs renderer font metrics. */
export function expressionSourceRect(
  element: Element,
  transform: LayerTransform,
  includeExtents = false,
  measureText?: (element: TextElement, transform: LayerTransform) => ExpressionTextMeasurement,
): ExpressionRect {
  let rect: ExpressionRect = {
    left: 0,
    top: 0,
    width: Math.max(0, transform.width),
    height: Math.max(0, transform.height),
  };
  let scaleX = 1,
    scaleY = 1;
  if (element.type === 'text') {
    if (!element.content) return { left: 0, top: 0, width: 0, height: 0 };
    if (measureText) {
      const measured = measureText(element, transform);
      rect = measured;
      scaleX = measured.strokeScaleX ?? 1;
      scaleY = measured.strokeScaleY ?? 1;
    }
  } else if (element.type === 'path') {
    const bounds = editablePathBounds(element);
    scaleX = transform.width / Math.max(1, element.viewBoxWidth);
    scaleY = transform.height / Math.max(1, element.viewBoxHeight);
    rect = {
      left: bounds.x * scaleX,
      top: bounds.y * scaleY,
      width: bounds.width * scaleX,
      height: bounds.height * scaleY,
    };
  }
  const stroke = includeExtents && 'strokeWidth' in element ? Math.max(0, element.strokeWidth) : 0;
  return {
    left: rect.left - (stroke * scaleX) / 2,
    top: rect.top - (stroke * scaleY) / 2,
    width: rect.width + stroke * scaleX,
    height: rect.height + stroke * scaleY,
  };
}
