import type { FieldDefinition, Layer } from '@ograf-editor/scene-model';

export type InlineTextEditTarget =
  { type: 'authored' } | { type: 'bound'; fieldId: string; label: string };

export interface InlineTextCaretPoint {
  x: number;
  y: number;
}

/** Resolve where an inline canvas text edit should be committed without breaking data bindings. */
export function inlineTextEditTarget(
  layer: Layer,
  fields: FieldDefinition[],
): InlineTextEditTarget | null {
  if (layer.element.type !== 'text' || layer.element.clock || layer.isLocked) return null;
  const binding = layer.bindings.find((candidate) => candidate.targetProperty === 'content');
  if (!binding) return { type: 'authored' };
  const field = fields.find((candidate) => candidate.id === binding.fieldId);
  if (!field) return { type: 'authored' };
  return { type: 'bound', fieldId: field.id, label: field.label || field.key };
}

export function inlineTextValue(element: HTMLElement): string {
  return element.innerText.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

function distanceToVerticalEdge(point: InlineTextCaretPoint, x: number, rect: DOMRect): number {
  const verticalDistance =
    point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
  return (point.x - x) ** 2 + verticalDistance ** 2;
}

/**
 * Place the caret at the rendered character boundary closest to a client-space pointer position.
 * Browser point-to-caret APIs can resolve the canvas or its transform overlay instead of the text,
 * so inline editing measures the text itself and does not depend on the original pointer target.
 */
export function placeInlineTextCaret(element: HTMLElement, point?: InlineTextCaretPoint): void {
  const document = element.ownerDocument;
  const selection = document.getSelection();
  if (!selection) return;
  selection.removeAllRanges();

  let best: { node: Text; offset: number; distance: number } | null = null;
  if (point) {
    const showText = document.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
    const walker = document.createTreeWalker(element, showText);
    const isRtl = document.defaultView?.getComputedStyle(element).direction === 'rtl';
    let measuredCharacters = 0;
    let current = walker.nextNode();
    while (current && measuredCharacters < 10_000) {
      const textNode = current as Text;
      for (let index = 0; index < textNode.length && measuredCharacters < 10_000; index += 1) {
        measuredCharacters += 1;
        const characterRange = document.createRange();
        characterRange.setStart(textNode, index);
        characterRange.setEnd(textNode, index + 1);
        for (const rect of characterRange.getClientRects()) {
          if (rect.width === 0 && rect.height === 0) continue;
          const candidates = isRtl
            ? [
                { x: rect.left, offset: index + 1 },
                { x: rect.right, offset: index },
              ]
            : [
                { x: rect.left, offset: index },
                { x: rect.right, offset: index + 1 },
              ];
          for (const candidate of candidates) {
            const distance = distanceToVerticalEdge(point, candidate.x, rect);
            if (!best || distance < best.distance) {
              best = { node: textNode, offset: candidate.offset, distance };
            }
          }
        }
      }
      current = walker.nextNode();
    }
  }

  const range = document.createRange();
  if (best) range.setStart(best.node, best.offset);
  else {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  range.collapse(true);
  selection.addRange(range);
}
